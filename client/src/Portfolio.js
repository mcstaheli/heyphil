import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Portfolio.css';
import './ProjectDetail.css';
import { summarizeLedger, computeTimelineMetrics, formatDate } from './projectMetrics';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';

// Stores which projects are EXCLUDED, not which are included - so a
// project created after the filter was last touched still shows up by
// default instead of silently disappearing until someone remembers to
// add it back in.
const FILTER_STORAGE_KEY = 'heyphil-portfolio-excluded-projects';

function loadExcludedIds() {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function formatMoney(n) {
  return (Number(n) || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  });
}

// Same convention as LedgerModule: 'expense' (Budget) means spending MORE
// than expected is bad; 'income' (Value) means delivering LESS is bad.
function deltaClass(delta, polarity) {
  if (!delta) return '';
  const isBad = polarity === 'expense' ? delta > 0 : delta < 0;
  return isBad ? 'over' : 'under';
}

function hasLeafItems(items) {
  return (items || []).some((i) => !i.isHeading);
}

// Nulls (no data entered yet for that project) always sort to the bottom
// regardless of direction - an incomplete row competing for the top of a
// "worst offenders" sort would be misleading.
function compareWithNullsLast(a, b, dir) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return dir === 'asc' ? a - b : b - a;
}

function Portfolio() {
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [excludedIds, setExcludedIds] = useState(loadExcludedIds);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterSearch, setFilterSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    try {
      localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify([...excludedIds]));
    } catch {
      // Private browsing / storage disabled - filter just won't persist.
    }
  }, [excludedIds]);

  useEffect(() => {
    const token = localStorage.getItem('authToken');
    fetch(`${API_BASE_URL}/api/projects`, {
      credentials: 'include',
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
        return res.json();
      })
      .then((data) => setProjects(data.projects || []))
      .catch((err) => {
        console.error('Failed to load portfolio:', err);
        setError('Could not load portfolio data - please try again.');
      });
  }, []);

  const rows = useMemo(() => {
    if (!projects) return [];
    return projects.map((p) => {
      const budgetLocks = p.budget_locks || [];
      const valueLocks = p.value_locks || [];
      const latestBudgetLock = budgetLocks.length ? budgetLocks[budgetLocks.length - 1] : null;
      const latestValueLock = valueLocks.length ? valueLocks[valueLocks.length - 1] : null;

      const hasBudget = hasLeafItems(p.budget);
      const hasValue = hasLeafItems(p.value);
      const budget = hasBudget ? summarizeLedger(p.budget, latestBudgetLock) : null;
      const value = hasValue ? summarizeLedger(p.value, latestValueLock) : null;

      const hasTimeline = (p.timeline || []).some((t) => t.type === 'milestone' && t.date);
      const timeline = hasTimeline ? computeTimelineMetrics(p.timeline, p.timeline_locks) : null;

      return {
        id: p.id,
        name: p.title || 'Untitled Project',
        stage: p.status || 'Unknown',
        hasBudget,
        budget,
        hasValue,
        value,
        hasTimeline,
        daysRemaining: hasTimeline ? timeline.daysRemaining : null,
        finalLiveMilestone: hasTimeline ? timeline.finalLiveMilestone : null,
        slippageDays: hasTimeline && timeline.finalComparison ? timeline.finalComparison.slippageDays : null,
        pctComplete: hasTimeline ? timeline.pctComplete : null
      };
    });
  }, [projects]);

  const visibleRows = useMemo(
    () => rows.filter((r) => !excludedIds.has(r.id)),
    [rows, excludedIds]
  );

  const totals = useMemo(() => {
    const withBudget = visibleRows.filter((r) => r.hasBudget);
    const withValue = visibleRows.filter((r) => r.hasValue);
    const withTimeline = visibleRows.filter((r) => r.hasTimeline);
    const withBaseline = withTimeline.filter((r) => r.slippageDays !== null);

    const budgetExpected = withBudget.reduce((s, r) => s + r.budget.totalExpected, 0);
    const budgetActual = withBudget.reduce((s, r) => s + r.budget.totalActual, 0);
    const valueExpected = withValue.reduce((s, r) => s + r.value.totalExpected, 0);
    const valueActual = withValue.reduce((s, r) => s + r.value.totalActual, 0);

    return {
      total: visibleRows.length,
      withBudget: withBudget.length,
      withValue: withValue.length,
      withTimeline: withTimeline.length,
      budgetExpected,
      budgetActual,
      budgetDelta: budgetActual - budgetExpected,
      valueExpected,
      valueActual,
      valueDelta: valueActual - valueExpected,
      withBaseline: withBaseline.length,
      behind: withBaseline.filter((r) => r.slippageDays > 0).length,
      overdue: withTimeline.filter((r) => r.daysRemaining !== null && r.daysRemaining < 0).length
    };
  }, [visibleRows]);

  const sortedRows = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const getValue = (r) => {
      switch (sortKey) {
        case 'name': return r.name.toLowerCase();
        case 'stage': return r.stage.toLowerCase();
        case 'budgetDelta': return r.budget ? r.budget.delta : null;
        case 'valueDelta': return r.value ? r.value.delta : null;
        case 'daysRemaining': return r.daysRemaining;
        case 'slippage': return r.slippageDays;
        case 'pctComplete': return r.pctComplete;
        default: return null;
      }
    };
    return [...visibleRows].sort((a, b) => {
      const av = getValue(a);
      const bv = getValue(b);
      if (sortKey === 'name' || sortKey === 'stage') {
        return av < bv ? -1 * dir : av > bv ? 1 * dir : 0;
      }
      return compareWithNullsLast(av, bv, sortDir);
    });
  }, [visibleRows, sortKey, sortDir]);

  const handleSort = (key) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' || key === 'stage' ? 'asc' : 'desc');
    }
  };

  const sortArrow = (key) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  const toggleExcluded = (id) => {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const showAllProjects = () => setExcludedIds(new Set());
  const hideAllProjects = () => setExcludedIds(new Set(rows.map((r) => r.id)));

  const modalRows = useMemo(() => {
    const q = filterSearch.trim().toLowerCase();
    const list = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, filterSearch]);

  if (error) {
    return (
      <div className="portfolio-page">
        <div className="portfolio-header">
          <h1>Portfolio</h1>
        </div>
        <div className="portfolio-content">
          <div className="loading">{error}</div>
        </div>
      </div>
    );
  }

  if (!projects) {
    return (
      <div className="portfolio-page">
        <div className="portfolio-header">
          <h1>Portfolio</h1>
        </div>
        <div className="portfolio-content">
          <div className="loading">Loading portfolio...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="portfolio-page">
      <div className="portfolio-header">
        <h1>Portfolio</h1>
        <div className="portfolio-header-sub">
          {totals.total} of {rows.length} active projects shown
        </div>
      </div>

      <div className="portfolio-content">
        <div className="detail-section">
          <h2 className="section-heading">Value</h2>
          <div className="hero-tile-row">
            <div className="hero-tile-wrapper">
              <div className="hero-tile-label">Total Value Expected</div>
              <div className="hero-tile">
                <div className="hero-tile-value">{formatMoney(totals.valueExpected)}</div>
              </div>
            </div>
            <div className="hero-tile-wrapper">
              <div className="hero-tile-label">Total Actual Value</div>
              <div className="hero-tile">
                <div className="hero-tile-value">{formatMoney(totals.valueActual)}</div>
              </div>
            </div>
            <div className="hero-tile-wrapper">
              <div className="hero-tile-label">Δ $</div>
              <div className="hero-tile">
                <div className={`hero-tile-value ${deltaClass(totals.valueDelta, 'income')}`}>
                  {formatMoney(totals.valueDelta)}
                </div>
              </div>
            </div>
            <div className="hero-tile-wrapper">
              <div className="hero-tile-label">Projects w/ Value Data</div>
              <div className="hero-tile">
                <div className="hero-tile-value">{totals.withValue} of {totals.total}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="detail-section">
          <h2 className="section-heading">Budget</h2>
          <div className="hero-tile-row">
            <div className="hero-tile-wrapper">
              <div className="hero-tile-label">Total Budget</div>
              <div className="hero-tile">
                <div className="hero-tile-value">{formatMoney(totals.budgetExpected)}</div>
              </div>
            </div>
            <div className="hero-tile-wrapper">
              <div className="hero-tile-label">Total Actual</div>
              <div className="hero-tile">
                <div className="hero-tile-value">{formatMoney(totals.budgetActual)}</div>
              </div>
            </div>
            <div className="hero-tile-wrapper">
              <div className="hero-tile-label">Δ $</div>
              <div className="hero-tile">
                <div className={`hero-tile-value ${deltaClass(totals.budgetDelta, 'expense')}`}>
                  {formatMoney(totals.budgetDelta)}
                </div>
              </div>
            </div>
            <div className="hero-tile-wrapper">
              <div className="hero-tile-label">Projects w/ Budget Data</div>
              <div className="hero-tile">
                <div className="hero-tile-value">{totals.withBudget} of {totals.total}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="detail-section">
          <h2 className="section-heading">Timeline</h2>
          <div className="hero-tile-row">
            <div className="hero-tile-wrapper">
              <div className="hero-tile-label">Projects w/ Milestones</div>
              <div className="hero-tile">
                <div className="hero-tile-value">{totals.withTimeline} of {totals.total}</div>
              </div>
            </div>
            <div className="hero-tile-wrapper">
              <div className="hero-tile-label">Behind Schedule</div>
              <div className="hero-tile">
                <div className={`hero-tile-value ${totals.behind > 0 ? 'over' : ''}`}>
                  {totals.withBaseline ? `${totals.behind} of ${totals.withBaseline}` : '—'}
                </div>
              </div>
            </div>
            <div className="hero-tile-wrapper">
              <div className="hero-tile-label">Overdue Final Milestone</div>
              <div className="hero-tile">
                <div className={`hero-tile-value ${totals.overdue > 0 ? 'over' : ''}`}>
                  {totals.overdue}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="detail-section">
          <div className="portfolio-projects-heading">
            <h2 className="section-heading">Projects</h2>
            <button type="button" className="btn-secondary" onClick={() => setFilterOpen(true)}>
              🔎 Filter Projects{excludedIds.size > 0 ? ` (${excludedIds.size} hidden)` : ''}
            </button>
          </div>
          <table className="budget-table portfolio-table">
            <thead>
              <tr>
                <th className="portfolio-col-name" onClick={() => handleSort('name')}>Project{sortArrow('name')}</th>
                <th onClick={() => handleSort('stage')}>Stage{sortArrow('stage')}</th>
                <th onClick={() => handleSort('budgetDelta')}>Budget Δ{sortArrow('budgetDelta')}</th>
                <th onClick={() => handleSort('valueDelta')}>Value Δ{sortArrow('valueDelta')}</th>
                <th onClick={() => handleSort('daysRemaining')}>Days Remaining{sortArrow('daysRemaining')}</th>
                <th onClick={() => handleSort('slippage')}>Slippage{sortArrow('slippage')}</th>
                <th onClick={() => handleSort('pctComplete')}>% Complete{sortArrow('pctComplete')}</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => (
                <tr key={r.id} className="portfolio-row" onClick={() => navigate(`/labs/board/projects/${r.id}`)}>
                  <td className="portfolio-col-name">{r.name}</td>
                  <td>{r.stage}</td>
                  <td className={r.budget ? deltaClass(r.budget.delta, 'expense') : ''}>
                    {r.budget ? formatMoney(r.budget.delta) : '—'}
                  </td>
                  <td className={r.value ? deltaClass(r.value.delta, 'income') : ''}>
                    {r.value ? formatMoney(r.value.delta) : '—'}
                  </td>
                  <td>
                    {r.daysRemaining === null
                      ? '—'
                      : r.daysRemaining < 0
                        ? `${Math.abs(r.daysRemaining)}d overdue`
                        : `${r.daysRemaining}d${r.finalLiveMilestone ? ` (${formatDate(r.finalLiveMilestone.date)})` : ''}`}
                  </td>
                  <td className={r.slippageDays !== null ? deltaClass(r.slippageDays, 'expense') : ''}>
                    {r.slippageDays === null ? '—' : `${r.slippageDays > 0 ? '+' : ''}${r.slippageDays}d`}
                  </td>
                  <td>{r.pctComplete === null ? '—' : `${r.pctComplete}%`}</td>
                </tr>
              ))}
              {sortedRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="budget-empty">
                    {rows.length === 0 ? 'No projects yet.' : 'No projects match the current filter.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {filterOpen && (
        <div className="modal-overlay" onClick={() => setFilterOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Filter Projects</h2>
              <button type="button" className="modal-icon-btn" onClick={() => setFilterOpen(false)} title="Close">
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="portfolio-filter-toolbar">
                <input
                  type="text"
                  className="budget-lock-name-input"
                  placeholder="Search projects..."
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  autoFocus
                />
                <div className="portfolio-filter-actions">
                  <button type="button" className="btn-secondary" onClick={showAllProjects}>Select All</button>
                  <button type="button" className="btn-secondary" onClick={hideAllProjects}>Deselect All</button>
                </div>
              </div>
              <div className="portfolio-filter-list">
                {modalRows.map((r) => (
                  <label key={r.id} className="portfolio-filter-item">
                    <input
                      type="checkbox"
                      checked={!excludedIds.has(r.id)}
                      onChange={() => toggleExcluded(r.id)}
                    />
                    <span className="portfolio-filter-item-name">{r.name}</span>
                    <span className="portfolio-filter-item-stage">{r.stage}</span>
                  </label>
                ))}
                {modalRows.length === 0 && (
                  <div className="budget-empty">No projects match your search.</div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <div className="modal-actions">
                <button type="button" className="btn-primary" onClick={() => setFilterOpen(false)}>Done</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Portfolio;
