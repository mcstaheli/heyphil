import React, { useState, useEffect, useCallback } from 'react';
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
  const [lineItems, setLineItems] = useState([]);
  const [entries, setEntries] = useState({});
  const [lenders, setLenders] = useState([]);
  const [debtEntries, setDebtEntries] = useState({});
  const [summary, setSummary] = useState([]);
  const [anchorDrafts, setAnchorDrafts] = useState({});
  const [newLineItem, setNewLineItem] = useState({});
  const [newLenderName, setNewLenderName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
      const [divRes, liRes, entRes, lenRes, debtRes, sumRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/cashflow/divisions`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE_URL}/api/cashflow/line-items?status=active`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE_URL}/api/cashflow/entries?startWeek=${startWeek}&endWeek=${endWeek}`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE_URL}/api/cashflow/lenders`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE_URL}/api/cashflow/debt-entries?startWeek=${startWeek}&endWeek=${endWeek}`, { headers: getAuthHeaders() }),
        fetch(`${API_BASE_URL}/api/cashflow/summary?weeks=${weeksKey}`, { headers: getAuthHeaders() }),
      ]);
      if (![divRes, liRes, entRes, lenRes, debtRes, sumRes].every((r) => r.ok)) {
        throw new Error('Failed to load cashflow data');
      }
      const [divData, liData, entData, lenData, debtData, sumData] = await Promise.all([
        divRes.json(), liRes.json(), entRes.json(), lenRes.json(), debtRes.json(), sumRes.json(),
      ]);
      setDivisions(divData);
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

  const addLineItem = async (divisionId) => {
    const draft = newLineItem[divisionId] || {};
    const name = (draft.name || '').trim();
    if (!name) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/cashflow/line-items`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ divisionId, name, category: draft.category || 'operations' }),
      });
      if (res.ok) {
        const item = await res.json();
        setLineItems((prev) => [...prev, item]);
        setNewLineItem((prev) => ({ ...prev, [divisionId]: { name: '', category: 'operations' } }));
      }
    } catch {
      setError('Failed to add line item');
    }
  };

  const retireLineItem = async (id) => {
    try {
      await fetch(`${API_BASE_URL}/api/cashflow/line-items/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status: 'retired' }),
      });
      setLineItems((prev) => prev.filter((li) => li.id !== id));
    } catch {
      setError('Failed to retire line item');
    }
  };

  const addLender = async () => {
    const name = newLenderName.trim();
    if (!name) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/cashflow/lenders`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const lender = await res.json();
        setLenders((prev) => [...prev, lender]);
        setNewLenderName('');
      }
    } catch {
      setError('Failed to add lender');
    }
  };

  const retireLender = async (id) => {
    try {
      await fetch(`${API_BASE_URL}/api/cashflow/lenders/${id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status: 'retired' }),
      });
      setLenders((prev) => prev.filter((l) => l.id !== id));
    } catch {
      setError('Failed to retire lender');
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

  const activeLenders = lenders.filter((l) => l.status === 'active');
  const summaryByWeek = Object.fromEntries(summary.map((s) => [s.weekEnding, s]));

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
              {divisions.map((division) => {
                const items = lineItems.filter((li) => li.division_id === division.id);
                const draft = newLineItem[division.id] || { name: '', category: 'operations' };
                return (
                  <React.Fragment key={division.id}>
                    <tr className="cashflow-division-row">
                      <td colSpan={weeks.length + 1}>{division.name}</td>
                    </tr>
                    {items.map((item) => (
                      <tr key={item.id}>
                        <td className="cashflow-row-label">
                          {item.name}
                          <button className="cashflow-retire-btn" title="Retire" onClick={() => retireLineItem(item.id)}>×</button>
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
                    <tr className="cashflow-add-row">
                      <td colSpan={weeks.length + 1}>
                        <input
                          className="cashflow-add-input"
                          placeholder={`+ Add ${division.name} line item`}
                          value={draft.name}
                          onChange={(e) => setNewLineItem((prev) => ({ ...prev, [division.id]: { ...draft, name: e.target.value } }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') addLineItem(division.id); }}
                        />
                        <select
                          className="cashflow-category-select"
                          value={draft.category}
                          onChange={(e) => setNewLineItem((prev) => ({ ...prev, [division.id]: { ...draft, category: e.target.value } }))}
                        >
                          <option value="operations">Operations</option>
                          <option value="investment">Investment</option>
                        </select>
                        <button className="btn-secondary" onClick={() => addLineItem(division.id)}>Add</button>
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })}

              <tr className="cashflow-division-row">
                <td colSpan={weeks.length + 1}>Debt</td>
              </tr>
              {activeLenders.map((lender) => (
                <tr key={lender.id}>
                  <td className="cashflow-row-label">
                    {lender.name}
                    <button className="cashflow-retire-btn" title="Retire" onClick={() => retireLender(lender.id)}>×</button>
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
