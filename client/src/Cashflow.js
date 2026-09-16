import React, { useState, useEffect, useCallback, useRef } from 'react';
import './Cashflow.css';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';
const MONTHS_SHOWN = 12;

function getAuthHeaders() {
  const token = localStorage.getItem('authToken');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

// For a full timestamp (has a real time-of-day, e.g. parsed from the
// server's period_start), toISOString() is safe - it's just re-serializing
// the same instant. It is NOT safe for a local-midnight Date (see
// formatPeriod below): converting local midnight to UTC rolls back a day
// in any timezone ahead of UTC.
function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

// 1st of the month containing `date` - the default right-hand edge of the
// month window.
function firstOfMonth(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return d;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  return d;
}

// Renders a firstOfMonth/addMonths result as YYYY-MM-01 using its LOCAL
// year/month fields, never toISOString() - that converts through UTC and
// silently rolls back a day for anyone in a timezone ahead of UTC, which
// then fails the server's strict period-format check.
function formatPeriod(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function formatMoney(n) {
  const v = Number(n) || 0;
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatMonthLabel(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function Cashflow() {
  const [accessChecked, setAccessChecked] = useState(false);
  const [hasAccess, setHasAccess] = useState(false);

  const [windowEnd, setWindowEnd] = useState(() => firstOfMonth(new Date()));
  const periods = Array.from({ length: MONTHS_SHOWN }, (_, i) =>
    formatPeriod(addMonths(windowEnd, -(MONTHS_SHOWN - 1 - i)))
  );
  const periodsKey = periods.join(',');

  const [divisions, setDivisions] = useState([]);
  const [sections, setSections] = useState([]);
  const [lineItems, setLineItems] = useState([]);
  const [entries, setEntries] = useState({});
  const [summary, setSummary] = useState([]);
  const [anchorDrafts, setAnchorDrafts] = useState({});

  const [newDivisionName, setNewDivisionName] = useState('');
  const [newSectionName, setNewSectionName] = useState({}); // divisionId -> string
  const [newItemName, setNewItemName] = useState({}); // sectionId -> string
  const [newChildName, setNewChildName] = useState({}); // parent itemId -> string
  const [addingSectionFor, setAddingSectionFor] = useState(null); // divisionId whose compact "+" is expanded
  const [addingItemFor, setAddingItemFor] = useState(null); // sectionId whose compact "+" is expanded
  const [addingChildFor, setAddingChildFor] = useState(null); // parent itemId whose compact "+" is expanded
  const [collapsedDivisions, setCollapsedDivisions] = useState(() => new Set());
  const [collapsedSections, setCollapsedSections] = useState(() => new Set());
  const [collapsedItems, setCollapsedItems] = useState(() => new Set());
  const [modalConfirm, setModalConfirm] = useState(null); // { message, confirmLabel, onConfirm } while a confirm modal is open

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Captured on focus so a rejected rename can revert to the pre-edit value
  // without a full reload (keyed "division-<id>" / "section-<id>").
  const originalNames = useRef({});

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/access/cashflow`, { headers: getAuthHeaders() });
        const data = await res.json();
        setHasAccess(!!data.hasAccess);
      } catch {
        setHasAccess(false);
      } finally {
        setAccessChecked(true);
      }
    })();
  }, []);

  const applySummary = (sumData) => {
    setSummary(sumData);
    setAnchorDrafts(Object.fromEntries(sumData.map((s) => [s.periodStart, s.startingCash])));
  };

  const loadSummaryOnly = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/cashflow/summary?periods=${periodsKey}`, { headers: getAuthHeaders() });
      if (res.ok) applySummary(await res.json());
    } catch {
      // non-fatal: grid still usable without a fresh rollup
    }
  }, [periodsKey]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const startPeriod = periods[0];
      const endPeriod = periods[periods.length - 1];
      const [divRes, secRes, liRes, entRes, sumRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/cashflow/divisions`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE_URL}/api/cashflow/sections`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE_URL}/api/cashflow/line-items`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE_URL}/api/cashflow/entries?startPeriod=${startPeriod}&endPeriod=${endPeriod}`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE_URL}/api/cashflow/summary?periods=${periodsKey}`, { headers: getAuthHeaders() }),
      ]);
      if (![divRes, secRes, liRes, entRes, sumRes].every((r) => r.ok)) {
        throw new Error('Failed to load cashflow data');
      }
      const [divData, secData, liData, entData, sumData] = await Promise.all([
        divRes.json(), secRes.json(), liRes.json(), entRes.json(), sumRes.json(),
      ]);
      setDivisions(divData);
      setSections(secData);
      setLineItems(liData);
      setEntries(Object.fromEntries(entData.map((e) => [`${e.line_item_id}_${toISODate(new Date(e.period_start))}`, Number(e.amount)])));
      applySummary(sumData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodsKey]);

  useEffect(() => {
    if (hasAccess) loadAll();
  }, [hasAccess, loadAll]);

  // ---------- entries / anchor ----------

  const saveEntry = async (lineItemId, period, amount) => {
    try {
      await fetch(`${API_BASE_URL}/api/cashflow/entries`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ entries: [{ lineItemId, periodStart: period, amount }] }),
      });
      loadSummaryOnly();
    } catch {
      setError('Failed to save entry');
    }
  };

  const setAnchor = async (period, value) => {
    try {
      await fetch(`${API_BASE_URL}/api/cashflow/anchor`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ periodStart: period, startingCash: value }),
      });
      loadSummaryOnly();
    } catch {
      setError('Failed to set starting cash');
    }
  };

  // ---------- departments ----------

  const addDivision = async () => {
    const name = newDivisionName.trim();
    if (!name) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/cashflow/divisions`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return setError(body.error || 'Failed to add department');
      }
      const division = await res.json();
      setDivisions((prev) => [...prev, division]);
      setNewDivisionName('');
    } catch {
      setError('Failed to add department');
    }
  };

  const renameDivision = (id, name) => setDivisions((prev) => prev.map((d) => (d.id === id ? { ...d, name } : d)));

  const saveDivisionName = async (id, name) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/cashflow/divisions/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Failed to rename department');
        const original = originalNames.current[`division-${id}`];
        if (original !== undefined) {
          setDivisions((prev) => prev.map((d) => (d.id === id ? { ...d, name: original } : d)));
        }
        return;
      }
      const updated = await res.json();
      setDivisions((prev) => prev.map((d) => (d.id === id ? { ...d, name: updated.name } : d)));
    } catch {
      setError('Failed to rename department');
    }
  };

  const deleteDivision = async (id) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/cashflow/divisions/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) return setError('Failed to remove department');
      setDivisions((prev) => prev.filter((d) => d.id !== id));
      setSections((prev) => prev.filter((s) => s.division_id !== id));
      loadSummaryOnly();
    } catch {
      setError('Failed to remove department');
    }
  };

  // ---------- sections ----------

  const addSection = async (divisionId) => {
    const name = (newSectionName[divisionId] || '').trim();
    if (!name) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/cashflow/sections`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ divisionId, name }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return setError(body.error || 'Failed to add section');
      }
      const section = await res.json();
      setSections((prev) => [...prev, section]);
      setNewSectionName((prev) => ({ ...prev, [divisionId]: '' }));
    } catch {
      setError('Failed to add section');
    }
  };

  const renameSection = (id, name) => setSections((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));

  const saveSectionName = async (id, name) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/cashflow/sections/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Failed to rename section');
        const original = originalNames.current[`section-${id}`];
        if (original !== undefined) {
          setSections((prev) => prev.map((s) => (s.id === id ? { ...s, name: original } : s)));
        }
        return;
      }
      const updated = await res.json();
      setSections((prev) => prev.map((s) => (s.id === id ? { ...s, name: updated.name } : s)));
    } catch {
      setError('Failed to rename section');
    }
  };

  const deleteSection = async (id) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/cashflow/sections/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) return setError('Failed to remove section');
      setSections((prev) => prev.filter((s) => s.id !== id));
      setLineItems((prev) => prev.filter((li) => li.section_id !== id));
      loadSummaryOnly();
    } catch {
      setError('Failed to remove section');
    }
  };

  // ---------- line items ----------

  const addLineItem = async (sectionId) => {
    const name = (newItemName[sectionId] || '').trim();
    if (!name) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/cashflow/line-items`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ sectionId, name }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return setError(body.error || 'Failed to add line item');
      }
      const item = await res.json();
      setLineItems((prev) => [...prev, item]);
      setNewItemName((prev) => ({ ...prev, [sectionId]: '' }));
    } catch {
      setError('Failed to add line item');
    }
  };

  const renameLineItem = (id, name) => setLineItems((prev) => prev.map((li) => (li.id === id ? { ...li, name } : li)));

  const saveLineItemName = async (id, name) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/cashflow/line-items/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Failed to rename line item');
        const original = originalNames.current[`item-${id}`];
        if (original !== undefined) {
          setLineItems((prev) => prev.map((li) => (li.id === id ? { ...li, name: original } : li)));
        }
        return;
      }
      const updated = await res.json();
      setLineItems((prev) => prev.map((li) => (li.id === id ? { ...li, name: updated.name } : li)));
    } catch {
      setError('Failed to rename line item');
    }
  };

  const deleteLineItem = async (id) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/cashflow/line-items/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) return setError('Failed to remove line item');
      // The server cascades the delete through the whole nested subtree,
      // not just this one row - local state has to match, or a deleted
      // descendant's stale cached entry keeps silently counting toward
      // section/division totals until the next full reload.
      setLineItems((prev) => {
        const removedIds = new Set([id]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const li of prev) {
            if (!removedIds.has(li.id) && removedIds.has(li.parent_item_id)) {
              removedIds.add(li.id);
              grew = true;
            }
          }
        }
        setEntries((prevEntries) => {
          const next = { ...prevEntries };
          for (const key of Object.keys(next)) {
            if (removedIds.has(Number(key.split('_')[0]))) delete next[key];
          }
          return next;
        });
        return prev.filter((li) => !removedIds.has(li.id));
      });
      loadSummaryOnly();
    } catch {
      setError('Failed to remove line item');
    }
  };

  const toggleItemCollapsed = (id) => setCollapsedItems((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const addNestedItem = async (parentItemId) => {
    const name = (newChildName[parentItemId] || '').trim();
    if (!name) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/cashflow/line-items`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ parentItemId, name }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return setError(body.error || 'Failed to add nested item');
      }
      const item = await res.json();
      setLineItems((prev) => [...prev, item]);
      setNewChildName((prev) => ({ ...prev, [parentItemId]: '' }));
      // The parent's own entries were cleared server-side the moment it
      // gained a child - drop any locally cached values too, so the grid
      // doesn't keep showing a stale number until the next full reload.
      setEntries((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          if (key.startsWith(`${parentItemId}_`)) delete next[key];
        }
        return next;
      });
      loadSummaryOnly();
    } catch {
      setError('Failed to add nested item');
    }
  };

  // Nesting auto-clears the parent's own entries server-side (a parent is
  // always a computed total, never also a manual value). Warn first only
  // when we can see - from the currently loaded/visible months - that this
  // item actually has something to lose; this can miss a value in a month
  // outside the visible window, but the server-side clear is authoritative
  // either way, so nothing is silently lost, just possibly un-warned-about.
  const openAddChild = (item) => {
    const hasVisibleValue = periods.some((p) => itemTotal(item.id, p) !== 0);
    const open = () => setAddingChildFor(item.id);
    if (hasVisibleValue) {
      setModalConfirm({
        message: `"${item.name}" has a value entered in the visible months. Nesting an item under it will clear that value so it can show a computed total instead. Continue?`,
        confirmLabel: 'Continue',
        onConfirm: open,
      });
    } else {
      open();
    }
  };

  if (!accessChecked) {
    return (
      <div className="app-container">
        <div className="cashflow-loading">Loading…</div>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="app-container">
        <header className="app-header">
          <h1>💰 Cashflow</h1>
        </header>
        <div className="cashflow-denied">You don't have access to this app.</div>
      </div>
    );
  }

  const summaryByPeriod = Object.fromEntries(summary.map((s) => [s.periodStart, s]));

  // A real delete, cascading to children and their entries server-side -
  // not a status flip. A hidden-but-still-counted row was a real bug (a
  // total that no longer matches anything visible, or anything real);
  // removed means gone, with no lingering effect on any total. Deletion is
  // irreversible (cascades to children and their entries), so it's always
  // gated behind the confirm modal rather than firing on click.
  const removeButton = (entity, onRemove) => (
    <button
      className="cashflow-retire-btn"
      title="Remove"
      onClick={() => setModalConfirm({
        message: `Remove "${entity.name}"? This permanently deletes it and everything under it.`,
        confirmLabel: 'Remove',
        onConfirm: () => onRemove(entity.id),
      })}
    >×</button>
  );

  // Inline "+" trigger sits to the left of the parent's own name (Studio,
  // General) instead of a separate always-visible row - clicking it opens
  // a compact input, in the row right after the parent's children, only
  // while adding.
  const inlineAddTrigger = (onOpen, title) => (
    <button className="cashflow-inline-add" onClick={onOpen} title={title}>+</button>
  );

  const collapseToggle = (collapsed, onToggle) => (
    <button
      className="cashflow-collapse-toggle"
      onClick={onToggle}
      title={collapsed ? 'Expand' : 'Collapse'}
    >
      {collapsed ? '▸' : '▾'}
    </button>
  );

  const toggleDivisionCollapsed = (id) => setCollapsedDivisions((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleSectionCollapsed = (id) => setCollapsedSections((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const compactAddRow = ({ value, onChange, onSubmit, onClose, placeholder, colSpan, indentPx }) => (
    <tr className="cashflow-add-row-compact">
      <td colSpan={colSpan} style={indentPx ? { paddingLeft: indentPx } : undefined}>
        <input
          autoFocus
          className="cashflow-add-input-compact"
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { onSubmit(); onClose(); }
            if (e.key === 'Escape') onClose();
          }}
          onBlur={onClose}
        />
      </td>
    </tr>
  );

  // Number(...) matters here: entries[key] holds a raw string right after
  // typing (input onChange stores e.target.value verbatim, only converted
  // to a number on blur/save) - without this coercion, `sum + itemTotal(...)`
  // silently falls back to string concatenation the moment one operand is a
  // string, corrupting every section/division total downstream.
  const itemTotal = (itemId, period) => Number(entries[`${itemId}_${period}`]) || 0;
  const sectionTotal = (sectionId, period) =>
    lineItems.filter((li) => li.section_id === sectionId).reduce((sum, li) => sum + itemTotal(li.id, period), 0);
  const divisionTotal = (divisionId, period) =>
    sections.filter((s) => s.division_id === divisionId).reduce((sum, s) => sum + sectionTotal(s.id, period), 0);

  const topLevelItems = (sectionId) =>
    lineItems.filter((li) => li.section_id === sectionId && li.status === 'active' && li.parent_item_id === null);
  const itemChildren = (itemId) =>
    lineItems.filter((li) => li.parent_item_id === itemId && li.status === 'active');
  // A leaf shows its own raw entry; a parent (has nested items) is always a
  // computed total - the server clears a parent's own entries the moment
  // it gains a child, so this is purely a display concern, not a second
  // source of truth for sectionTotal/divisionTotal (those already sum every
  // leaf's raw entry directly, at whatever depth it lives).
  const itemDisplayTotal = (itemId, period) => {
    const children = itemChildren(itemId);
    if (children.length === 0) return itemTotal(itemId, period);
    return children.reduce((sum, child) => sum + itemDisplayTotal(child.id, period), 0);
  };

  // Unlimited nesting depth: an item with no children is a manual entry
  // row like today; the moment it has a child it becomes bold and shows a
  // computed total instead, recursing into its own children the same way.
  const renderItemRow = (item, depth) => {
    const children = itemChildren(item.id);
    const isParent = children.length > 0;
    const collapsed = collapsedItems.has(item.id);
    const indentPx = 36 + depth * 16;
    return (
      <React.Fragment key={item.id}>
        <tr className={isParent ? 'cashflow-item-parent-row' : undefined}>
          <td className="cashflow-row-label cashflow-item-label" style={{ paddingLeft: indentPx }}>
            {isParent && collapseToggle(collapsed, () => toggleItemCollapsed(item.id))}
            {inlineAddTrigger(() => openAddChild(item), `Add nested item to ${item.name}`)}
            <input
              className="cashflow-header-input cashflow-item-input"
              value={item.name}
              onFocus={() => { originalNames.current[`item-${item.id}`] = item.name; }}
              onChange={(e) => renameLineItem(item.id, e.target.value)}
              onBlur={(e) => saveLineItemName(item.id, e.target.value)}
            />
            {removeButton(item, deleteLineItem)}
          </td>
          {periods.map((p) => (
            <td key={p}>
              {isParent ? (
                formatMoney(itemDisplayTotal(item.id, p))
              ) : (
                <input
                  type="number"
                  className="cashflow-cell-input"
                  value={entries[`${item.id}_${p}`] ?? ''}
                  onChange={(e) => setEntries((prev) => ({ ...prev, [`${item.id}_${p}`]: e.target.value }))}
                  onBlur={(e) => saveEntry(item.id, p, Number(e.target.value) || 0)}
                />
              )}
            </td>
          ))}
        </tr>
        {!collapsed && children.map((child) => renderItemRow(child, depth + 1))}
        {!collapsed && addingChildFor === item.id && compactAddRow({
          value: newChildName[item.id] || '',
          onChange: (e) => setNewChildName((prev) => ({ ...prev, [item.id]: e.target.value })),
          onSubmit: () => addNestedItem(item.id),
          onClose: () => setAddingChildFor(null),
          placeholder: `Add item to ${item.name}`,
          colSpan: periods.length + 1,
          indentPx: 36 + (depth + 1) * 16,
        })}
      </React.Fragment>
    );
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>💰 Cashflow</h1>
        <div className="cashflow-period-nav">
          <button className="btn-secondary" onClick={() => setWindowEnd((w) => addMonths(w, -MONTHS_SHOWN))}>← Prev</button>
          <button className="btn-secondary" onClick={() => setWindowEnd(firstOfMonth(new Date()))}>Today</button>
          <button className="btn-secondary" onClick={() => setWindowEnd((w) => addMonths(w, MONTHS_SHOWN))}>Next →</button>
        </div>
      </header>

      {error && <div className="cashflow-error">{error}</div>}

      <div className="cashflow-add-department">
        <input
          className="cashflow-add-input"
          placeholder="+ Add Department"
          value={newDivisionName}
          onChange={(e) => setNewDivisionName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addDivision(); }}
        />
        <button className="btn-secondary" onClick={addDivision}>Add Department</button>
      </div>

      {loading ? (
        <div className="cashflow-loading">Loading…</div>
      ) : (
        <div className="cashflow-scroll">
          <table className="cashflow-grid">
            <thead>
              <tr>
                <th className="cashflow-row-label">Month</th>
                {periods.map((p) => (
                  <th key={p}>{formatMonthLabel(p)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {divisions.filter((d) => d.status === 'active').map((division) => {
                const divisionSections = sections.filter((s) => s.division_id === division.id && s.status === 'active');
                return (
                  <React.Fragment key={division.id}>
                    <tr className="cashflow-division-row">
                      <td className="cashflow-row-label">
                        {collapseToggle(collapsedDivisions.has(division.id), () => toggleDivisionCollapsed(division.id))}
                        {inlineAddTrigger(() => setAddingSectionFor(division.id), `Add section to ${division.name}`)}
                        <input
                          className="cashflow-header-input cashflow-division-input"
                          value={division.name}
                          onFocus={() => { originalNames.current[`division-${division.id}`] = division.name; }}
                          onChange={(e) => renameDivision(division.id, e.target.value)}
                          onBlur={(e) => saveDivisionName(division.id, e.target.value)}
                        />
                        {removeButton(division, deleteDivision)}
                      </td>
                      {periods.map((p) => (
                        <td key={p}>{formatMoney(divisionTotal(division.id, p))}</td>
                      ))}
                    </tr>

                    {!collapsedDivisions.has(division.id) && divisionSections.map((section) => (
                        <React.Fragment key={section.id}>
                          <tr className="cashflow-section-row">
                            <td className="cashflow-row-label">
                              {collapseToggle(collapsedSections.has(section.id), () => toggleSectionCollapsed(section.id))}
                              {inlineAddTrigger(() => setAddingItemFor(section.id), `Add item to ${section.name}`)}
                              <input
                                className="cashflow-header-input cashflow-section-input"
                                value={section.name}
                                onFocus={() => { originalNames.current[`section-${section.id}`] = section.name; }}
                                onChange={(e) => renameSection(section.id, e.target.value)}
                                onBlur={(e) => saveSectionName(section.id, e.target.value)}
                              />
                              {removeButton(section, deleteSection)}
                            </td>
                            {periods.map((p) => (
                              <td key={p}>{formatMoney(sectionTotal(section.id, p))}</td>
                            ))}
                          </tr>

                          {!collapsedSections.has(section.id) && topLevelItems(section.id).map((item) => renderItemRow(item, 0))}

                          {!collapsedSections.has(section.id) && addingItemFor === section.id && compactAddRow({
                            value: newItemName[section.id] || '',
                            onChange: (e) => setNewItemName((prev) => ({ ...prev, [section.id]: e.target.value })),
                            onSubmit: () => addLineItem(section.id),
                            onClose: () => setAddingItemFor(null),
                            placeholder: `Add item to ${section.name}`,
                            colSpan: periods.length + 1,
                            indentPx: 36,
                          })}
                        </React.Fragment>
                      ))}

                    {!collapsedDivisions.has(division.id) && addingSectionFor === division.id && compactAddRow({
                      value: newSectionName[division.id] || '',
                      onChange: (e) => setNewSectionName((prev) => ({ ...prev, [division.id]: e.target.value })),
                      onSubmit: () => addSection(division.id),
                      onClose: () => setAddingSectionFor(null),
                      placeholder: `Add section to ${division.name}`,
                      colSpan: periods.length + 1,
                    })}
                  </React.Fragment>
                );
              })}

              <tr className="cashflow-summary-row">
                <td className="cashflow-row-label">Starting cash</td>
                {periods.map((p) => (
                  <td key={p}>
                    <input
                      type="number"
                      className="cashflow-cell-input cashflow-anchor-input"
                      value={anchorDrafts[p] ?? ''}
                      onChange={(e) => setAnchorDrafts((prev) => ({ ...prev, [p]: e.target.value }))}
                      onBlur={(e) => setAnchor(p, Number(e.target.value) || 0)}
                      title="Override starting cash for this month"
                    />
                  </td>
                ))}
              </tr>
              <tr className="cashflow-summary-row">
                <td className="cashflow-row-label">Contribution</td>
                {periods.map((p) => (
                  <td key={p}>{formatMoney(summaryByPeriod[p]?.contribution)}</td>
                ))}
              </tr>
              <tr className="cashflow-summary-row cashflow-ending-row">
                <td className="cashflow-row-label">Ending cash</td>
                {periods.map((p) => (
                  <td key={p}>{formatMoney(summaryByPeriod[p]?.endingCash)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {modalConfirm && (
        <div className="cashflow-modal-overlay" onClick={() => setModalConfirm(null)}>
          <div className="cashflow-modal" onClick={(e) => e.stopPropagation()}>
            <p>{modalConfirm.message}</p>
            <div className="cashflow-modal-actions">
              <button className="btn-secondary" onClick={() => setModalConfirm(null)}>Cancel</button>
              <button
                className="cashflow-modal-confirm"
                onClick={() => { modalConfirm.onConfirm(); setModalConfirm(null); }}
              >{modalConfirm.confirmLabel}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Cashflow;
