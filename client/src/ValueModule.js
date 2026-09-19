import React, { useState } from 'react';

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
// where formatMoney's $ would be redundant with the Expected/Actual headers.
function formatNumber(n) {
  const num = Number(n);
  return Number.isFinite(num) ? num.toLocaleString('en-US') : '';
}

// Includes the time - two locks made the same day (easy to do while
// getting a plan set up) would otherwise show as identical options.
function formatDateTime(iso) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}

// Naming a lock is optional - unnamed ones just fall back to their timestamp.
function lockLabel(lock) {
  return lock.name ? lock.name : `Locked ${formatDateTime(lock.lockedAt)}`;
}

// A row with no amount starts a new heading; every line item after it,
// up to the next heading, is summed into it. Re-pasting an updated value
// plan carries over `actual` for any item name that matches an existing
// one exactly, so re-pasting doesn't wipe out actuals already entered
// against that line.
function parseValuePaste(text, existingItems) {
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

    const id = `v_${crypto.randomUUID()}`;

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

function sumLeaf(items, field) {
  return items.filter((i) => !i.isHeading).reduce((sum, i) => sum + (Number(i[field]) || 0), 0);
}

// The one place the expected/actual/delta math lives, so a future formula
// change (e.g. rounding) can't drift between the hero tiles and wherever
// else ends up needing the same numbers. `lock` is whichever lock the
// caller wants compared against (the module's own version picker can
// point this at any past lock, not just the latest) - pass null/undefined
// to compare the live value against itself (no baseline yet).
function summarizeValue(items, lock) {
  const totalExpected = lock ? sumLeaf(lock.items, 'amount') : sumLeaf(items, 'amount');
  const totalActual = sumLeaf(items, 'actual');
  const delta = totalActual - totalExpected;
  const deltaPct = totalExpected ? (delta / totalExpected) * 100 : null;
  return { totalExpected, totalActual, delta, deltaPct };
}

// Inverted from Budget's version of this: there, a positive delta means
// spending MORE than planned (bad, red) and negative means under (good,
// green). Here, a positive delta means actual value came in ABOVE
// expected (good, green) and negative means it fell short (bad, red) -
// same 'over'/'under' CSS classes (red/green), just mapped to the
// opposite sign since more value is the good direction, not the bad one.
function deltaClass(delta) {
  if (delta > 0) return 'under';
  if (delta < 0) return 'over';
  return '';
}

// Annual expected value to Philo vs. actual - functionally identical to
// BudgetModule (paste-from-Excel, heading rollups, named locks, history
// view), just a second, independent set of line items and its own
// value/value_locks columns rather than budget/budget_locks.
function ValueModule({ projectId, value, valueLocks, onValueChange, onLocksChange, expanded, onToggleExpanded }) {
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

  const items = value || [];
  const locks = valueLocks || [];
  const latestLock = locks.length ? locks[locks.length - 1] : null;
  const activeLock = selectedLockId ? locks.find((l) => l.id === selectedLockId) || latestLock : latestLock;
  // Picking anything but the latest lock switches the table into a
  // read-only "look back at history" report - editing an old snapshot
  // makes no sense, and the default/latest view stays the live draft you
  // actually work in day to day.
  const isViewingHistory = !!activeLock && activeLock.id !== latestLock?.id;

  // In history mode, the row list comes from the LOCK's own items - not
  // the live value - so a line item deleted since that lock still shows
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

  const { totalExpected, totalActual, delta, deltaPct } = summarizeValue(items, activeLock);
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
    onValueChange(nextItems);
    try {
      const res = await fetch(`${API_BASE_URL}/api/projects/${projectId}/value`, {
        method: 'PUT',
        credentials: 'include',
        headers: authHeaders(),
        body: JSON.stringify({ items: nextItems })
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
    } catch (error) {
      console.error('Failed to save value:', error);
      onValueChange(previousItems);
      window.alert('Could not save that value change - please try again.');
    }
  };

  const handlePasteApply = () => {
    const parsed = parseValuePaste(pasteText, items);
    if (parsed.length === 0) return;
    if (items.length > 0 && !window.confirm(
      'Replace the current value plan with this paste? Actuals are kept for any item name that matches exactly; new or renamed items start at $0 actual.'
    )) {
      return;
    }
    saveItems(parsed);
    setPasteText('');
    setPasteOpen(false);
  };

  const handleFieldChange = (id, field, rawValue) => {
    onValueChange(items.map((item) => (item.id === id ? { ...item, [field]: rawValue } : item)));
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
    const id = `v_${crypto.randomUUID()}`;
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
      const res = await fetch(`${API_BASE_URL}/api/projects/${projectId}/value/lock`, {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(),
        body: JSON.stringify({ items, name: lockNameDraft })
      });
      if (!res.ok) throw new Error(`Lock failed: ${res.status}`);
      const data = await res.json();
      onLocksChange(data.valueLocks || []);
      setSelectedLockId(null);
      setLockPromptOpen(false);
      setLockNameDraft('');
    } catch (error) {
      console.error('Failed to lock value:', error);
      window.alert('Could not lock the value plan - please try again.');
    } finally {
      setLocking(false);
    }
  };

  return (
    <div className="value-module">
      <div className="hero-row-with-toggle">
        <div className="hero-tile-row">
          <div className="hero-tile-wrapper">
            <div className="hero-tile-label">Total Value Expected</div>
            <div className="hero-tile">
              <div className="hero-tile-value">{formatMoney(totalExpected)}</div>
            </div>
          </div>
          <div className="hero-tile-wrapper">
            <div className="hero-tile-label">Total Actual Value</div>
            <div className="hero-tile">
              <div className="hero-tile-value">{formatMoney(totalActual)}</div>
            </div>
          </div>
          <div className="hero-tile-wrapper">
            <div className="hero-tile-label">Δ $</div>
            <div className="hero-tile">
              <div className={`hero-tile-value ${deltaClass(delta)}`}>{deltaDollarText}</div>
            </div>
          </div>
          <div className="hero-tile-wrapper">
            <div className="hero-tile-label">Δ %</div>
            <div className="hero-tile">
              <div className={`hero-tile-value ${deltaClass(delta)}`}>{deltaPctText}</div>
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
              {activeLock ? `Vs. ${lockLabel(activeLock)}` : 'No value locked yet'}
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
              🔒 Lock Value
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
                placeholder={`e.g. "FY26 Plan" (defaults to ${formatDateTime(new Date().toISOString())})`}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleLock(); }}
              />
              <div className="budget-paste-actions">
                <button type="button" className="btn-secondary" onClick={() => { setLockPromptOpen(false); setLockNameDraft(''); }}>
                  Cancel
                </button>
                <button type="button" className="btn-primary" onClick={handleLock} disabled={locking}>
                  🔒 Lock Value
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
                placeholder={'Recurring Revenue\nClient A Renewal\t120000\nClient B Expansion\t45000\nNew Business\nClient C New Deal\t80000'}
              />
              <div className="budget-paste-actions">
                <button type="button" className="btn-secondary" onClick={() => { setPasteOpen(false); setPasteText(''); }}>
                  Cancel
                </button>
                <button type="button" className="btn-primary" onClick={handlePasteApply} disabled={!pasteText.trim()}>
                  Replace Value
                </button>
              </div>
            </div>
          )}

          <table className="budget-table">
            <thead>
              <tr>
                <th>Line Item</th>
                <th>Expected</th>
                <th>Actual</th>
                <th>Δ $</th>
                <th>Δ %</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {displayItems.length === 0 && (
                <tr><td colSpan={6} className="budget-empty">
                  {isViewingHistory ? 'This locked snapshot has no line items.' : 'No value line items yet. Paste from Excel or add a row below.'}
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
                    <td className={deltaClass(rowDelta)}>{formatMoney(rowDelta)}</td>
                    <td className={deltaClass(rowDelta)}>{item.amount ? `${rowDeltaPct.toFixed(1)}%` : '—'}</td>
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
                  <td className={deltaClass(delta)}>{deltaDollarText}</td>
                  <td className={deltaClass(delta)}>{deltaPctText}</td>
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

export default ValueModule;
