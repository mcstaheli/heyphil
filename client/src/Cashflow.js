import React, { useState, useEffect, useCallback, useRef } from 'react';
import './Cashflow.css';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';
const WEEKS_SHOWN = 8;

function getAuthHeaders() {
  const token = localStorage.getItem('authToken');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

// Most recent Sunday on/before `date` - the default right-hand edge of the
// week window. "Week ending Sunday" is a starting convention, not fixed;
// nothing else in the app assumes this day-of-week.
function mostRecentSunday(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatMoney(n) {
  const v = Number(n) || 0;
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatWeekLabel(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function Cashflow() {
  const [accessChecked, setAccessChecked] = useState(false);
  const [hasAccess, setHasAccess] = useState(false);

  const [windowEnd, setWindowEnd] = useState(() => mostRecentSunday(new Date()));
  const weeks = Array.from({ length: WEEKS_SHOWN }, (_, i) =>
    toISODate(addDays(windowEnd, -(WEEKS_SHOWN - 1 - i) * 7))
  );
  const weeksKey = weeks.join(',');

  const [divisions, setDivisions] = useState([]);
  const [sections, setSections] = useState([]);
  const [lineItems, setLineItems] = useState([]);
  const [entries, setEntries] = useState({});
  const [lenders, setLenders] = useState([]);
  const [debtEntries, setDebtEntries] = useState({});
  const [summary, setSummary] = useState([]);
  const [anchorDrafts, setAnchorDrafts] = useState({});

  const [newDivisionName, setNewDivisionName] = useState('');
  const [newSectionName, setNewSectionName] = useState({}); // divisionId -> string
  const [newItemName, setNewItemName] = useState({}); // sectionId -> string
  const [newLenderName, setNewLenderName] = useState('');
  const [addingSectionFor, setAddingSectionFor] = useState(null); // divisionId whose compact "+" is expanded
  const [addingItemFor, setAddingItemFor] = useState(null); // sectionId whose compact "+" is expanded

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
    setAnchorDrafts(Object.fromEntries(sumData.map((s) => [s.weekEnding, s.startingCash])));
  };

  const loadSummaryOnly = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/cashflow/summary?weeks=${weeksKey}`, { headers: getAuthHeaders() });
      if (res.ok) applySummary(await res.json());
    } catch {
      // non-fatal: grid still usable without a fresh rollup
    }
  }, [weeksKey]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const startWeek = weeks[0];
      const endWeek = weeks[weeks.length - 1];
      const [divRes, secRes, liRes, entRes, lenRes, debtRes, sumRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/cashflow/divisions`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE_URL}/api/cashflow/sections`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE_URL}/api/cashflow/line-items`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE_URL}/api/cashflow/entries?startWeek=${startWeek}&endWeek=${endWeek}`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE_URL}/api/cashflow/lenders`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE_URL}/api/cashflow/debt-entries?startWeek=${startWeek}&endWeek=${endWeek}`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE_URL}/api/cashflow/summary?weeks=${weeksKey}`, { headers: getAuthHeaders() }),
      ]);
      if (![divRes, secRes, liRes, entRes, lenRes, debtRes, sumRes].every((r) => r.ok)) {
        throw new Error('Failed to load cashflow data');
      }
      const [divData, secData, liData, entData, lenData, debtData, sumData] = await Promise.all([
        divRes.json(), secRes.json(), liRes.json(), entRes.json(), lenRes.json(), debtRes.json(), sumRes.json(),
      ]);
      setDivisions(divData);
      setSections(secData);
      setLineItems(liData);
      setEntries(Object.fromEntries(entData.map((e) => [`${e.line_item_id}_${toISODate(new Date(e.week_ending))}`, Number(e.amount)])));
      setLenders(lenData);
      setDebtEntries(Object.fromEntries(debtData.map((d) => [`${d.lender_id}_${toISODate(new Date(d.week_ending))}`, Number(d.amount)])));
      applySummary(sumData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeksKey]);

  useEffect(() => {
    if (hasAccess) loadAll();
  }, [hasAccess, loadAll]);

  // ---------- entries / debt / anchor ----------

  const saveEntry = async (lineItemId, week, amount) => {
    try {
      await fetch(`${API_BASE_URL}/api/cashflow/entries`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ entries: [{ lineItemId, weekEnding: week, amount }] }),
      });
      loadSummaryOnly();
    } catch {
      setError('Failed to save entry');
    }
  };

  const saveDebtEntry = async (lenderId, week, amount) => {
    try {
      await fetch(`${API_BASE_URL}/api/cashflow/debt-entries`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ lenderId, weekEnding: week, amount }),
      });
      loadSummaryOnly();
    } catch {
      setError('Failed to save debt entry');
    }
  };

  const setAnchor = async (week, value) => {
    try {
      await fetch(`${API_BASE_URL}/api/cashflow/anchor`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ weekEnding: week, startingCash: value }),
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

  const setDivisionStatus = async (id, status) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/cashflow/divisions/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status }),
      });
      if (!res.ok) return setError('Failed to update department');
      setDivisions((prev) => prev.map((d) => (d.id === id ? { ...d, status } : d)));
    } catch {
      setError('Failed to update department');
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

  const setSectionStatus = async (id, status) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/cashflow/sections/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status }),
      });
      if (!res.ok) return setError('Failed to update section');
      setSections((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));
    } catch {
      setError('Failed to update section');
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

  const setLineItemStatus = async (id, status) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/cashflow/line-items/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status }),
      });
      if (!res.ok) return setError('Failed to update line item');
      setLineItems((prev) => prev.map((li) => (li.id === id ? { ...li, status } : li)));
    } catch {
      setError('Failed to update line item');
    }
  };

  // ---------- lenders ----------

  const addLender = async () => {
    const name = newLenderName.trim();
    if (!name) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/cashflow/lenders`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return setError(body.error || 'Failed to add lender');
      }
      const lender = await res.json();
      setLenders((prev) => [...prev, lender]);
      setNewLenderName('');
    } catch {
      setError('Failed to add lender');
    }
  };

  const setLenderStatus = async (id, status) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/cashflow/lenders/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status }),
      });
      if (!res.ok) return setError('Failed to update lender');
      setLenders((prev) => prev.map((l) => (l.id === id ? { ...l, status } : l)));
    } catch {
      setError('Failed to update lender');
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

  const summaryByWeek = Object.fromEntries(summary.map((s) => [s.weekEnding, s]));

  // Removing a department/section/item/lender retires it server-side (so its
  // historical entries keep counting toward Contribution/Ending cash below,
  // same as real accounting - closing a department doesn't erase what it
  // already spent) but it's filtered out of the active view entirely below,
  // so from here it just looks removed.
  const removeButton = (entity, onRemove) => (
    <button className="cashflow-retire-btn" title="Remove" onClick={() => onRemove(entity.id, 'retired')}>×</button>
  );

  // Compact "+"-to-expand control used for Add Section / Add Item, which
  // are repeated per row and were previously a full input+button each -
  // this keeps the sheet's footprint small until you actually want to add
  // something.
  const compactAdd = ({ isOpen, onOpen, onClose, placeholder, value, onChange, onSubmit }) =>
    isOpen ? (
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
    ) : (
      <button className="cashflow-add-plus" onClick={onOpen} title={placeholder}>+</button>
    );

  const itemTotal = (itemId, week) => entries[`${itemId}_${week}`] || 0;
  const sectionTotal = (sectionId, week) =>
    lineItems.filter((li) => li.section_id === sectionId).reduce((sum, li) => sum + itemTotal(li.id, week), 0);
  const divisionTotal = (divisionId, week) =>
    sections.filter((s) => s.division_id === divisionId).reduce((sum, s) => sum + sectionTotal(s.id, week), 0);

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>💰 Cashflow</h1>
        <div className="cashflow-week-nav">
          <button className="btn-secondary" onClick={() => setWindowEnd((w) => addDays(w, -7 * WEEKS_SHOWN))}>← Prev</button>
          <button className="btn-secondary" onClick={() => setWindowEnd(mostRecentSunday(new Date()))}>Today</button>
          <button className="btn-secondary" onClick={() => setWindowEnd((w) => addDays(w, 7 * WEEKS_SHOWN))}>Next →</button>
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
                <th className="cashflow-row-label">Week ending</th>
                {weeks.map((w) => (
                  <th key={w}>{formatWeekLabel(w)}</th>
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
                        <input
                          className="cashflow-header-input cashflow-division-input"
                          value={division.name}
                          onFocus={() => { originalNames.current[`division-${division.id}`] = division.name; }}
                          onChange={(e) => renameDivision(division.id, e.target.value)}
                          onBlur={(e) => saveDivisionName(division.id, e.target.value)}
                        />
                        {removeButton(division, setDivisionStatus)}
                      </td>
                      {weeks.map((w) => (
                        <td key={w}>{formatMoney(divisionTotal(division.id, w))}</td>
                      ))}
                    </tr>

                    {divisionSections.map((section) => {
                      const sectionItems = lineItems.filter((li) => li.section_id === section.id && li.status === 'active');
                      return (
                        <React.Fragment key={section.id}>
                          <tr className="cashflow-section-row">
                            <td className="cashflow-row-label">
                              <input
                                className="cashflow-header-input cashflow-section-input"
                                value={section.name}
                                onFocus={() => { originalNames.current[`section-${section.id}`] = section.name; }}
                                onChange={(e) => renameSection(section.id, e.target.value)}
                                onBlur={(e) => saveSectionName(section.id, e.target.value)}
                              />
                              {removeButton(section, setSectionStatus)}
                            </td>
                            {weeks.map((w) => (
                              <td key={w}>{formatMoney(sectionTotal(section.id, w))}</td>
                            ))}
                          </tr>

                          {sectionItems.map((item) => (
                            <tr key={item.id}>
                              <td className="cashflow-row-label cashflow-item-label">
                                {item.name}
                                {removeButton(item, setLineItemStatus)}
                              </td>
                              {weeks.map((w) => {
                                const key = `${item.id}_${w}`;
                                return (
                                  <td key={w}>
                                    <input
                                      type="number"
                                      className="cashflow-cell-input"
                                      value={entries[key] ?? ''}
                                      onChange={(e) => setEntries((prev) => ({ ...prev, [key]: e.target.value }))}
                                      onBlur={(e) => saveEntry(item.id, w, Number(e.target.value) || 0)}
                                    />
                                  </td>
                                );
                              })}
                            </tr>
                          ))}

                          <tr className="cashflow-add-row-compact">
                            <td className="cashflow-item-label" colSpan={weeks.length + 1}>
                              {compactAdd({
                                isOpen: addingItemFor === section.id,
                                onOpen: () => setAddingItemFor(section.id),
                                onClose: () => setAddingItemFor(null),
                                placeholder: `Add item to ${section.name}`,
                                value: newItemName[section.id] || '',
                                onChange: (e) => setNewItemName((prev) => ({ ...prev, [section.id]: e.target.value })),
                                onSubmit: () => addLineItem(section.id),
                              })}
                            </td>
                          </tr>
                        </React.Fragment>
                      );
                    })}

                    <tr className="cashflow-add-row-compact">
                      <td colSpan={weeks.length + 1}>
                        {compactAdd({
                          isOpen: addingSectionFor === division.id,
                          onOpen: () => setAddingSectionFor(division.id),
                          onClose: () => setAddingSectionFor(null),
                          placeholder: `Add section to ${division.name}`,
                          value: newSectionName[division.id] || '',
                          onChange: (e) => setNewSectionName((prev) => ({ ...prev, [division.id]: e.target.value })),
                          onSubmit: () => addSection(division.id),
                        })}
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}

              <tr className="cashflow-division-row">
                <td colSpan={weeks.length + 1}>Debt</td>
              </tr>
              {lenders.filter((l) => l.status === 'active').map((lender) => (
                <tr key={lender.id}>
                  <td className="cashflow-row-label cashflow-item-label">
                    {lender.name}
                    {removeButton(lender, setLenderStatus)}
                  </td>
                  {weeks.map((w) => {
                    const key = `${lender.id}_${w}`;
                    return (
                      <td key={w}>
                        <input
                          type="number"
                          className="cashflow-cell-input"
                          value={debtEntries[key] ?? ''}
                          onChange={(e) => setDebtEntries((prev) => ({ ...prev, [key]: e.target.value }))}
                          onBlur={(e) => saveDebtEntry(lender.id, w, Number(e.target.value) || 0)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="cashflow-add-row">
                <td colSpan={weeks.length + 1}>
                  <input
                    className="cashflow-add-input"
                    placeholder="+ Add lender"
                    value={newLenderName}
                    onChange={(e) => setNewLenderName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addLender(); }}
                  />
                  <button className="btn-secondary" onClick={addLender}>Add</button>
                </td>
              </tr>

              <tr className="cashflow-summary-row">
                <td className="cashflow-row-label">Starting cash</td>
                {weeks.map((w) => (
                  <td key={w}>
                    <input
                      type="number"
                      className="cashflow-cell-input cashflow-anchor-input"
                      value={anchorDrafts[w] ?? ''}
                      onChange={(e) => setAnchorDrafts((prev) => ({ ...prev, [w]: e.target.value }))}
                      onBlur={(e) => setAnchor(w, Number(e.target.value) || 0)}
                      title="Override starting cash for this week"
                    />
                  </td>
                ))}
              </tr>
              <tr className="cashflow-summary-row">
                <td className="cashflow-row-label">Contribution</td>
                {weeks.map((w) => (
                  <td key={w}>{formatMoney(summaryByWeek[w]?.contribution)}</td>
                ))}
              </tr>
              <tr className="cashflow-summary-row">
                <td className="cashflow-row-label">Debt shift</td>
                {weeks.map((w) => (
                  <td key={w}>{formatMoney(summaryByWeek[w]?.debtShift)}</td>
                ))}
              </tr>
              <tr className="cashflow-summary-row cashflow-ending-row">
                <td className="cashflow-row-label">Ending cash</td>
                {weeks.map((w) => (
                  <td key={w}>{formatMoney(summaryByWeek[w]?.endingCash)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default Cashflow;
