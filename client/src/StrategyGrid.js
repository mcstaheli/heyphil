import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Portfolio.css';
import './ProjectDetail.css';
import './StrategyGrid.css';
import { ORIGINATION_STAGE_ORDER } from './boardStages';
import { formatCompactMoney } from './formatMoney';
import {
  MONTHS_SPLIT,
  YIELD_SPLIT,
  computeYield,
  isOutOfMandate,
  isFlagged,
  percentCapitalInLeftHalf
} from './strategyGridMath';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';

const CHART_WIDTH = 900;
const CHART_HEIGHT = 560;
const MARGIN = { top: 24, right: 24, bottom: 56, left: 64 };
const PLOT_WIDTH = CHART_WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;

function niceStep(max, targetTicks = 6) {
  const raw = max / targetTicks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const residual = raw / magnitude;
  let step;
  if (residual > 5) step = 10 * magnitude;
  else if (residual > 2) step = 5 * magnitude;
  else if (residual > 1) step = 2 * magnitude;
  else step = magnitude;
  return step;
}

function StrategyGrid() {
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState(null);
  const [projectTypeColors, setProjectTypeColors] = useState({});
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem('authToken');
    fetch(`${API_BASE_URL}/api/origination/board`, {
      credentials: 'include',
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setProjects(data.cards || []);
        setProjectTypeColors(data.projectTypeColors || {});
      })
      .catch((err) => {
        console.error('Failed to load strategy grid:', err);
        setError('Could not load grid data - please try again.');
      });
  }, []);

  // Only the origination pipeline is in scope here - the Studio board is a
  // separate system with no annual-value/capital-committed/months-to-
  // first-cash fields of its own.
  const originationCards = useMemo(
    () => (projects || []).filter((c) => ORIGINATION_STAGE_ORDER.includes(c.column)),
    [projects]
  );

  const points = useMemo(() => {
    return originationCards
      // Finite and non-negative - a card can't take a negative number of
      // months to first cash, and NaN/Infinity from any upstream bad data
      // has nowhere sensible to plot.
      .filter((c) => Number.isFinite(c.capitalCommitted) && c.capitalCommitted > 0
        && Number.isFinite(c.monthsToFirstCash) && c.monthsToFirstCash >= 0)
      .map((c) => {
        const yieldRatio = computeYield(c.annualValue, c.capitalCommitted) || 0;
        return {
          id: c.id,
          title: c.title,
          stage: c.column,
          projectType: c.projectType,
          annualValue: c.annualValue || 0,
          capitalCommitted: c.capitalCommitted,
          monthsToFirstCash: c.monthsToFirstCash,
          yieldRatio,
          outOfMandate: isOutOfMandate(c.monthsToFirstCash, yieldRatio),
          flagged: isFlagged(c.monthsToFirstCash, c.column)
        };
      });
  }, [originationCards]);

  const headline = useMemo(() => percentCapitalInLeftHalf(points), [points]);
  const flaggedPoints = useMemo(() => points.filter((p) => p.flagged), [points]);

  const scales = useMemo(() => {
    const months = points.map((p) => p.monthsToFirstCash);
    const yields = points.map((p) => p.yieldRatio);
    const capitals = points.map((p) => p.capitalCommitted);

    const xMax = Math.max(48, ...(months.length ? months : [0])) * 1.15;
    const yMin = Math.min(0, ...(yields.length ? yields : [0])) * 1.15;
    const yMax = Math.max(YIELD_SPLIT * 2.5, ...(yields.length ? yields : [0])) * 1.15;
    const capMin = Math.min(...(capitals.length ? capitals : [0]));
    const capMax = Math.max(...(capitals.length ? capitals : [1]));

    const xScale = (months_) => MARGIN.left + (months_ / xMax) * PLOT_WIDTH;
    const yScale = (yieldRatio) => MARGIN.top + PLOT_HEIGHT - ((yieldRatio - yMin) / (yMax - yMin)) * PLOT_HEIGHT;
    const rScale = (capital) => {
      if (capMax === capMin) return 10;
      const t = (capital - capMin) / (capMax - capMin);
      return 6 + Math.sqrt(t) * 20;
    };

    return { xMax, yMin, yMax, xScale, yScale, rScale };
  }, [points]);

  const xTicks = useMemo(() => {
    const step = niceStep(scales.xMax);
    const ticks = [];
    for (let v = 0; v <= scales.xMax; v += step) ticks.push(Math.round(v));
    // Float accumulation (v += step) can leave the split value fractionally
    // off an exact match - same epsilon check as the y-axis below, so a
    // future shared tick-builder can't reintroduce a duplicate split tick.
    if (!ticks.some((t) => Math.abs(t - MONTHS_SPLIT) < 0.0001) && MONTHS_SPLIT <= scales.xMax) {
      ticks.push(MONTHS_SPLIT);
    }
    return ticks;
  }, [scales.xMax]);

  const yTicks = useMemo(() => {
    const step = niceStep((scales.yMax - scales.yMin) * 100) / 100;
    const ticks = [];
    for (let v = Math.ceil(scales.yMin / step) * step; v <= scales.yMax; v += step) {
      ticks.push(Math.round(v * 1000) / 1000);
    }
    if (!ticks.some((t) => Math.abs(t - YIELD_SPLIT) < 0.0001)) ticks.push(YIELD_SPLIT);
    return ticks;
  }, [scales.yMin, scales.yMax]);

  if (error) {
    return (
      <div className="portfolio-page">
        <div className="portfolio-header"><h1>Strategy Grid</h1></div>
        <div className="portfolio-content"><div className="loading">{error}</div></div>
      </div>
    );
  }

  if (!projects) {
    return (
      <div className="portfolio-page">
        <div className="portfolio-header"><h1>Strategy Grid</h1></div>
        <div className="portfolio-content"><div className="loading">Loading strategy grid...</div></div>
      </div>
    );
  }

  const splitX = scales.xScale(MONTHS_SPLIT);
  const splitY = scales.yScale(YIELD_SPLIT);

  return (
    <div className="portfolio-page">
      <div className="portfolio-header">
        <h1>Strategy Grid</h1>
        <div className="portfolio-header-sub">
          {points.length} of {originationCards.length} origination projects plotted
          (need capital committed and months to first cash entered)
        </div>
      </div>

      <div className="portfolio-content">
        <div className="detail-section">
          <div className="hero-tile-row">
            <div className="hero-tile-wrapper">
              <div className="hero-tile-label">Capital in Left Half (&le;{MONTHS_SPLIT}mo)</div>
              <div className="hero-tile">
                <div className="hero-tile-value">{headline === null ? '—' : `${headline.toFixed(0)}%`}</div>
              </div>
            </div>
            <div className="hero-tile-wrapper">
              <div className="hero-tile-label">Flagged (Right Side, Not Assets)</div>
              <div className="hero-tile">
                <div className={`hero-tile-value ${flaggedPoints.length > 0 ? 'over' : ''}`}>{flaggedPoints.length}</div>
              </div>
            </div>
            <div className="hero-tile-wrapper">
              <div className="hero-tile-label">Out of Mandate</div>
              <div className="hero-tile">
                <div className={`hero-tile-value ${points.some(p => p.outOfMandate) ? 'over' : ''}`}>
                  {points.filter((p) => p.outOfMandate).length}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="detail-section">
          <h2 className="section-heading">Months to First Cash &times; Cash Yield</h2>
          <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="strategy-grid-svg">
            {/* Out-of-mandate quadrant shading + watermark */}
            <rect
              x={splitX}
              y={MARGIN.top}
              width={MARGIN.left + PLOT_WIDTH - splitX}
              height={splitY - MARGIN.top}
              className="quadrant-out-of-mandate"
            />
            <text
              x={splitX + (MARGIN.left + PLOT_WIDTH - splitX) / 2}
              y={MARGIN.top + (splitY - MARGIN.top) / 2}
              className="quadrant-x-mark"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              &#10005;
            </text>
            <text
              x={splitX + (MARGIN.left + PLOT_WIDTH - splitX) / 2}
              y={splitY - 12}
              className="quadrant-label"
              textAnchor="middle"
            >
              OUT OF MANDATE
            </text>

            {/* Axes */}
            <line x1={MARGIN.left} y1={MARGIN.top} x2={MARGIN.left} y2={MARGIN.top + PLOT_HEIGHT} className="axis-line" />
            <line x1={MARGIN.left} y1={MARGIN.top + PLOT_HEIGHT} x2={MARGIN.left + PLOT_WIDTH} y2={MARGIN.top + PLOT_HEIGHT} className="axis-line" />

            {/* Split lines */}
            <line x1={splitX} y1={MARGIN.top} x2={splitX} y2={MARGIN.top + PLOT_HEIGHT} className="split-line" />
            <line x1={MARGIN.left} y1={splitY} x2={MARGIN.left + PLOT_WIDTH} y2={splitY} className="split-line" />

            {/* X ticks */}
            {xTicks.map((t) => (
              <g key={`x-${t}`}>
                <line x1={scales.xScale(t)} y1={MARGIN.top + PLOT_HEIGHT} x2={scales.xScale(t)} y2={MARGIN.top + PLOT_HEIGHT + 6} className="tick-line" />
                <text x={scales.xScale(t)} y={MARGIN.top + PLOT_HEIGHT + 20} className="tick-label" textAnchor="middle">{t}mo</text>
              </g>
            ))}
            <text x={MARGIN.left + PLOT_WIDTH / 2} y={CHART_HEIGHT - 8} className="axis-title" textAnchor="middle">
              Months to First Cash
            </text>

            {/* Y ticks */}
            {yTicks.map((t) => (
              <g key={`y-${t}`}>
                <line x1={MARGIN.left - 6} y1={scales.yScale(t)} x2={MARGIN.left} y2={scales.yScale(t)} className="tick-line" />
                <text x={MARGIN.left - 10} y={scales.yScale(t) + 4} className="tick-label" textAnchor="end">{(t * 100).toFixed(0)}%</text>
              </g>
            ))}
            <text
              x={-(MARGIN.top + PLOT_HEIGHT / 2)}
              y={16}
              className="axis-title"
              textAnchor="middle"
              transform="rotate(-90)"
            >
              Cash Yield (Annual Value / Capital Committed)
            </text>

            {/* Points */}
            {points.map((p) => {
              const cx = scales.xScale(p.monthsToFirstCash);
              const cy = scales.yScale(p.yieldRatio);
              const r = scales.rScale(p.capitalCommitted);
              const color = projectTypeColors[p.projectType] || '#999';
              return (
                <g
                  key={p.id}
                  className="grid-point"
                  onClick={() => navigate(`/labs/board/projects/${p.id}`)}
                >
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill={color}
                    fillOpacity={0.75}
                    className={p.flagged ? 'point-flagged' : ''}
                  />
                  <text x={cx + r + 4} y={cy + 4} className="point-label">
                    {p.title}{p.flagged ? ' ⚠️' : ''}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {flaggedPoints.length > 0 && (
          <div className="detail-section">
            <h2 className="section-heading">⚠️ Flagged — Right Side but Not Assets</h2>
            <table className="budget-table portfolio-table">
              <thead>
                <tr>
                  <th className="portfolio-col-name">Project</th>
                  <th>Stage</th>
                  <th>Months to First Cash</th>
                  <th>Cash Yield</th>
                  <th>Capital Committed</th>
                </tr>
              </thead>
              <tbody>
                {flaggedPoints.map((p) => (
                  <tr key={p.id} className="portfolio-row" onClick={() => navigate(`/labs/board/projects/${p.id}`)}>
                    <td className="portfolio-col-name">{p.title}</td>
                    <td>{p.stage}</td>
                    <td>{p.monthsToFirstCash}mo</td>
                    <td>{(p.yieldRatio * 100).toFixed(1)}%</td>
                    <td>{formatCompactMoney(p.capitalCommitted)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default StrategyGrid;
