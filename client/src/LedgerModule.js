import React, { useState } from 'react';
import { formatDateTime, lockLabel, summarizeLedger } from './projectMetrics';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';

function parseAmount(raw) {
  const cleaned = String(raw ?? '').replace(/[^0-9.-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(n) {
  return (Number(n) || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  });
}

// Plain comma grouping, no currency symbol - for the editable table cells,
// where formatMoney's $ would be redundant with the column headers.
function formatNumber(n) {
  const num = Number(n);
  return Number.isFinite(num) ? num.toLocaleString('en-US') : '';
}

// A row with no amount starts a new heading; every line item after it,
// up to the next heading, is summed into it. Re-pasting an updated
// ledger carries over `actual` for any item name that matches an
// existing one exactly, so re-pasting doesn't wipe out actuals already
// entered against that line.
function parseLedgerPaste(text, existingItems, idPrefix) {
  const existingByName = new Map(
    existingItems.filter((i) => !i.isHeading).map((i) => [i.name.trim().toLowerCase(), i])
  );
  const items = [];
  let currentHeadingId = null;

  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;

    const tabIndex = rawLine.indexOf('\t');
    const name = (tabIndex === -1 ? rawLine : rawLine.slice(0, tabIndex)).trim();
    const amountRaw = tabIndex === -1 ? '' : rawLine.slice(tabIndex + 1).trim();
    if (!name) continue;

    const id = `${idPrefix}_${crypto.randomUUID()}`;

    if (!amountRaw) {
      currentHeadingId = id;
      items.push({ id, name, isHeading: true, parentId: null, amount: null, actual: null });
    } else {
      const existing = existingByName.get(name.trim().toLowerCase());
      items.push({
        id: existing ? existing.id : id,
        name,
        isHeading: false,
        parentId: currentHeadingId,
        amount: parseAmount(amountRaw),
        actual: existing ? existing.actual : 0
      });
    }
  }
  return items;
}

// Headings never carry their own number - it's always the sum of the
// items filed under them, recomputed on every render.
function computeHeadingTotals(items) {
  const childrenByParent = {};
  items.forEach((item) => {
    if (!item.isHeading && item.parentId) {
      (childrenByParent[item.parentId] = childrenByParent[item.parentId] || []).push(item);
    }
  });
  return items.map((item) => {
    if (!item.isHeading) return item;
    const kids = childrenByParent[item.id] || [];
    return {
      ...item,
      amount: kids.reduce((sum, k) => sum + (Number(k.amount) || 0), 0),
      actual: kids.reduce((sum, k) => sum + (Number(k.actual) || 0), 0)
    };
  });
}

// Budget and Value read the same delta sign in opposite directions:
// spending MORE than budgeted is bad (config.deltaPolarity: 'expense'),
// but achieving MORE value than expected is good ('income'). Same
// red/green CSS classes either way, just mapped to whichever sign is
// actually the bad one for this ledger.
function deltaClass(delta, polarity) {
  if (delta === 0) return '';
  const isBad = polarity === 'expense' ? delta > 0 : delta < 0;
  return isBad ? 'over' : 'under';
}

// Shared implementation behind BudgetModule and ValueModule - same paste-
// from-Excel, heading rollups, named locks, and history view for both;
// everything that differs between "track spend against a budget" and
// "track value against an expectation" (labels, copy, API path, delta
// polarity) lives in the `config` object each of those two thin wrappers
// passes in, not here.
function LedgerModule({ projectId, config, items: liveItems, locks: allLocks, onItemsChange, onLocksChange, expanded, onToggleExpanded }) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [selectedLockId, setSelectedLockId] = useState(null);
  const [locking, setLocking] = useState(false);
  const [lockPromptOpen, setLockPromptOpen] = useState(false);
  const [lockNameDraft, setLockNameDraft] = useState('');
  // Which single Expected/Actual cell is mid-edit, so it can show its raw
  // typed value while every other cell shows the comma-formatted display -
  // formatting the cell being typed into would fight the cursor.
  const [editingCell, setEditingCell] = useState(null);

  const items = liveItems || [];
  const locks = allLocks || [];
  const latestLock = locks.length ? locks[locks.length - 1] : null;
  const activeLock = selectedLockId ? locks.find((l) => l.id === selectedLockId) || latestLock : latestLock;
  // Picking anything but the latest lock switches the table into a
  // read-only "look back at history" report - editing an old snapshot
  // makes no sense, and the default/latest view stays the live draft you
  // actually work in day to day.
  const isViewingHistory = !!activeLock && activeLock.id !== latestLock?.id;

  // In history mode, the row list comes from the LOCK's own items - not
  // the live items - so a line item deleted since that lock still shows
  // (it existed at the time) and one added since doesn't (it didn't).
  // Expected amounts are the frozen locked values; actuals stay live/
  // today's, same as everywhere else, since actuals were never
  // snapshotted - only the expected baseline is.
  const displayItems = isViewingHistory
    ? computeHeadingTotals(activeLock.items.map((lockedItem) => (
      lockedItem.isHeading
        ? { ...lockedItem, amount: null, actual: null }
        : { ...lockedItem, actual: items.find((i) => i.id === lockedItem.id)?.actual ?? 0 }
    )))
    : computeHeadingTotals(items);

  const { totalExpected, totalActual, delta, deltaPct } = summarizeLedger(items, activeLock);
  const deltaDollarText = (totalExpected === 0 && totalActual === 0) ? '—' : `${delta > 0 ? '+' : ''}${formatMoney(delta)}`;
  const deltaPctText = totalExpected === 0 ? '—' : `${delta > 0 ? '+' : ''}${deltaPct.toFixed(1)}%`;

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('authToken')}`
  });

  // Optimistic, but reverts the UI and warns if the save didn't actually
  // land - otherwise an edit can look saved on screen while the DB (and
  // anything locked from it) never saw it.
  const saveItems = async (nextItems) => {
    const previousItems = items;
    onItemsChange(nextItems);
    try {
      const res = await fetch(`${API_BASE_URL}/api/projects/${projectId}/${config.apiField}`, {
        method: 'PUT',
        credentials: 'include',
        headers: authHeaders(),
        body: JSON.stringify({ items: nextItems })
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
    } catch (error) {
      console.error(`Failed to save ${config.errorNoun}:`, error);
      onItemsChange(previousItems);
      window.alert(config.saveFailAlert);
    }
  };

  const handlePasteApply = () => {
    const parsed = parseLedgerPaste(pasteText, items, config.idPrefix);
    if (parsed.length === 0) return;
    if (items.length > 0 && !window.confirm(config.replaceConfirmText)) {
      return;
    }
    saveItems(parsed);
    setPasteText('');
    setPasteOpen(false);
  };

  const handleFieldChange = (id, field, rawValue) => {
    onItemsChange(items.map((item) => (item.id === id ? { ...item, [field]: rawValue } : item)));
  };

  const handleFieldBlur = (id, field) => {
    const isNumeric = field === 'amount' || field === 'actual';
    saveItems(items.map((item) => {
      if (item.id !== id) return item;
      return isNumeric ? { ...item, [field]: parseAmount(item[field]) } : item;
    }));
    setEditingCell(null);
  };

  const handleDelete = (item) => {
    const childCount = item.isHeading ? items.filter((i) => i.parentId === item.id).length : 0;
    const msg = childCount > 0
      ? `Delete "${item.name}" and its ${childCount} line item${childCount === 1 ? '' : 's'}?`
      : `Delete "${item.name || 'this line item'}"?`;
    if (!window.confirm(msg)) return;
    saveItems(items.filter((i) => i.id !== item.id && i.parentId !== item.id));
  };

  const handleAddRow = (isHeading) => {
    const id = `${config.idPrefix}_${crypto.randomUUID()}`;
    saveItems([...items, {
      id,
      name: '',
      isHeading,
      parentId: null,
      amount: isHeading ? null : 0,
      actual: isHeading ? null : 0
    }]);
  };

  // Sends the items currently on screen rather than relying on the
  // server's last-saved copy, so a lock always freezes exactly what the
  // user sees - not whatever a still-in-flight edit's save left behind.
  // The naming prompt below is the confirmation step - no window.confirm.
  const handleLock = async () => {
    setLocking(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/projects/${projectId}/${config.apiField}/lock`, {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(),
        body: JSON.stringify({ items, name: lockNameDraft })
      });
      if (!res.ok) throw new Error(`Lock failed: ${res.status}`);
      const data = await res.json();
      onLocksChange(data.locks || []);
      setSelectedLockId(null);
      setLockPromptOpen(false);
      setLockNameDraft('');
    } catch (error) {
      console.error(`Failed to lock ${config.errorNoun}:`, error);
      window.alert(config.lockFailAlert);
    } finally {
      setLocking(false);
    }
  };

  return (
    <div className="budget-module">
      <div className="hero-row-with-toggle">
        <div className="hero-tile-row">
          <div className="hero-tile-wrapper">
            <div className="hero-tile-label">{config.heroTotalLabel}</div>
            <div className="hero-tile">
              <div className="hero-tile-value">{formatMoney(totalExpected)}</div>
            </div>
          </div>
          <div className="hero-tile-wrapper">
            <div className="hero-tile-label">{config.heroActualLabel}</div>
            <div className="hero-tile">
              <div className="hero-tile-value">{formatMoney(totalActual)}</div>
            </div>
          </div>
          <div className="hero-tile-wrapper">
            <div className="hero-tile-label">Δ $</div>
            <div className="hero-tile">
              <div className={`hero-tile-value ${deltaClass(delta, config.deltaPolarity)}`}>{deltaDollarText}</div>
            </div>
          </div>
          <div className="hero-tile-wrapper">
            <div className="hero-tile-label">Δ %</div>
            <div className="hero-tile">
              <div className={`hero-tile-value ${deltaClass(delta, config.deltaPolarity)}`}>{deltaPctText}</div>
            </div>
          </div>
        </div>
        <button
          type="button"
          className="module-expand-btn"
          onClick={onToggleExpanded}
          title={expanded ? 'Collapse details' : 'Expand details'}
        >
          {expanded ? '▾' : '▸'}
        </button>
      </div>

      {expanded && (
        <>
          <div className="budget-module-header">
            <div className="budget-hero-label">
              {activeLock ? `Vs. ${lockLabel(activeLock)}` : config.noLockText}
            </div>
            <div className="budget-module-actions">
              {locks.length > 0 && (
                <select
                  className="budget-lock-picker"
                  value={activeLock ? activeLock.id : ''}
                  onChange={(e) => setSelectedLockId(e.target.value)}
                >
                  {locks.slice().reverse().map((lock) => (
                    <option key={lock.id} value={lock.id}>{lockLabel(lock)}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
          <div className="budget-detail-actions">
            <button type="button" className="btn-secondary" onClick={() => setPasteOpen((o) => !o)}>
              📋 Paste from Excel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => setLockPromptOpen((o) => !o)}
              disabled={locking || items.filter((i) => !i.isHeading).length === 0}
            >
              {config.lockButtonLabel}
            </button>
          </div>

          {lockPromptOpen && (
            <div className="budget-paste-box">
              <p>Name this locked baseline (optional) - helps tell it apart from other locks later. Past locks stay saved and can still be viewed.</p>
              <input
                type="text"
                className="budget-lock-name-input"
                value={lockNameDraft}
                onChange={(e) => setLockNameDraft(e.target.value)}
                placeholder={`e.g. "${config.lockNamePlaceholderExample}" (defaults to ${formatDateTime(new Date().toISOString())})`}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleLock(); }}
              />
              <div className="budget-paste-actions">
                <button type="button" className="btn-secondary" onClick={() => { setLockPromptOpen(false); setLockNameDraft(''); }}>
                  Cancel
                </button>
                <button type="button" className="btn-primary" onClick={handleLock} disabled={locking}>
                  {config.lockButtonLabel}
                </button>
              </div>
            </div>
          )}

          {pasteOpen && (
            <div className="budget-paste-box">
              <p>
                Paste two columns - item name, then amount - tab-separated, straight from Excel or Sheets.
                A row with no amount becomes a heading; every item under it, up to the next heading, gets summed into it.
              </p>
              <textarea
                rows={6}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={config.pasteExample}
              />
              <div className="budget-paste-actions">
                <button type="button" className="btn-secondary" onClick={() => { setPasteOpen(false); setPasteText(''); }}>
                  Cancel
                </button>
                <button type="button" className="btn-primary" onClick={handlePasteApply} disabled={!pasteText.trim()}>
                  {config.replaceButtonLabel}
                </button>
              </div>
            </div>
          )}

          <table className="budget-table">
            <thead>
              <tr>
                <th>Line Item</th>
                <th>{config.columnAmountLabel}</th>
                <th>Actual</th>
                <th>Δ $</th>
                <th>Δ %</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {displayItems.length === 0 && (
                <tr><td colSpan={6} className="budget-empty">
                  {isViewingHistory ? 'This locked snapshot has no line items.' : config.noItemsText}
                </td></tr>
              )}
              {displayItems.map((item) => {
                const rowDelta = (Number(item.actual) || 0) - (Number(item.amount) || 0);
                const rowDeltaPct = item.amount ? (rowDelta / item.amount) * 100 : 0;
                return (
                  <tr key={item.id} className={item.isHeading ? 'budget-row-heading' : 'budget-row-item'}>
                    <td>
                      {isViewingHistory ? item.name : (
                        <input
                          type="text"
                          value={item.name}
                          placeholder={item.isHeading ? 'Heading' : 'Line item'}
                          onChange={(e) => handleFieldChange(item.id, 'name', e.target.value)}
                          onBlur={() => handleFieldBlur(item.id, 'name')}
                        />
                      )}
                    </td>
                    <td>
                      {isViewingHistory || item.isHeading ? formatMoney(item.amount) : (
                        <input
                          type="text"
                          value={
                            editingCell?.id === item.id && editingCell?.field === 'amount'
                              ? item.amount ?? ''
                              : formatNumber(item.amount)
                          }
                          onFocus={() => setEditingCell({ id: item.id, field: 'amount' })}
                          onChange={(e) => handleFieldChange(item.id, 'amount', e.target.value)}
                          onBlur={() => handleFieldBlur(item.id, 'amount')}
                        />
                      )}
                    </td>
                    <td>
                      {isViewingHistory || item.isHeading ? formatMoney(item.actual) : (
                        <input
                          type="text"
                          value={
                            editingCell?.id === item.id && editingCell?.field === 'actual'
                              ? item.actual ?? ''
                              : formatNumber(item.actual)
                          }
                          onFocus={() => setEditingCell({ id: item.id, field: 'actual' })}
                          onChange={(e) => handleFieldChange(item.id, 'actual', e.target.value)}
                          onBlur={() => handleFieldBlur(item.id, 'actual')}
                        />
                      )}
                    </td>
                    <td className={deltaClass(rowDelta, config.deltaPolarity)}>{formatMoney(rowDelta)}</td>
                    <td className={deltaClass(rowDelta, config.deltaPolarity)}>{item.amount ? `${rowDeltaPct.toFixed(1)}%` : '—'}</td>
                    <td>
                      {!isViewingHistory && (
                        <button type="button" className="budget-row-delete" onClick={() => handleDelete(item)} title="Delete">×</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {displayItems.length > 0 && (
              <tfoot>
                <tr className="budget-row-total">
                  <td>Total{activeLock ? ' (vs. locked)' : ''}</td>
                  <td>{formatMoney(totalExpected)}</td>
                  <td>{formatMoney(totalActual)}</td>
                  <td className={deltaClass(delta, config.deltaPolarity)}>{deltaDollarText}</td>
                  <td className={deltaClass(delta, config.deltaPolarity)}>{deltaPctText}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>

          {isViewingHistory ? (
            <p className="budget-history-note">
              Viewing a locked snapshot - read-only. Pick "{lockLabel(latestLock)}" above to go back to editing.
            </p>
          ) : (
            <div className="budget-add-row">
              <button type="button" className="btn-secondary" onClick={() => handleAddRow(false)}>+ Line Item</button>
              <button type="button" className="btn-secondary" onClick={() => handleAddRow(true)}>+ Heading</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export const BUDGET_LEDGER_CONFIG = {
  apiField: 'budget',
  idPrefix: 'b',
  heroTotalLabel: 'Total Budget',
  heroActualLabel: 'Total Actual',
  columnAmountLabel: 'Budget',
  lockButtonLabel: '🔒 Lock Budget',
  noLockText: 'No budget locked yet',
  noItemsText: 'No budget line items yet. Paste from Excel or add a row below.',
  lockNamePlaceholderExample: 'Q3 Baseline',
  pasteExample: 'Site Work\nGrading\t50000\nUtilities\t22000\nSoft Costs\nArchitecture\t40000',
  replaceButtonLabel: 'Replace Budget',
  replaceConfirmText: 'Replace the current budget with this paste? Actuals are kept for any item name that matches exactly; new or renamed items start at $0 actual.',
  saveFailAlert: 'Could not save that budget change - please try again.',
  lockFailAlert: 'Could not lock the budget - please try again.',
  errorNoun: 'budget',
  // Spending MORE than budgeted is bad -> positive delta is red.
  deltaPolarity: 'expense'
};

export const VALUE_LEDGER_CONFIG = {
  apiField: 'value',
  idPrefix: 'v',
  heroTotalLabel: 'Total Value Expected',
  heroActualLabel: 'Total Actual Value',
  columnAmountLabel: 'Expected',
  lockButtonLabel: '🔒 Lock Value',
  noLockText: 'No value locked yet',
  noItemsText: 'No value line items yet. Paste from Excel or add a row below.',
  lockNamePlaceholderExample: 'FY26 Plan',
  pasteExample: 'Recurring Revenue\nClient A Renewal\t120000\nClient B Expansion\t45000\nNew Business\nClient C New Deal\t80000',
  replaceButtonLabel: 'Replace Value',
  replaceConfirmText: 'Replace the current value plan with this paste? Actuals are kept for any item name that matches exactly; new or renamed items start at $0 actual.',
  saveFailAlert: 'Could not save that value change - please try again.',
  lockFailAlert: 'Could not lock the value plan - please try again.',
  errorNoun: 'value',
  // Achieving MORE value than expected is good -> positive delta is green.
  deltaPolarity: 'income'
};

export default LedgerModule;
