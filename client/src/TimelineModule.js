import React, { useState } from 'react';
import CustomTimeline from './CustomTimeline';
import { formatDate, formatDateTime, lockLabel, computeTimelineMetrics } from './projectMetrics';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';

function deltaClass(days) {
  if (days > 0) return 'over';
  if (days < 0) return 'under';
  return '';
}

function TimelineModule({ projectId, tasks, timelineLocks, people, onLocksChange, expanded, onToggleExpanded }) {
  const [locking, setLocking] = useState(false);
  const [selectedLockId, setSelectedLockId] = useState(null);
  const [lockPromptOpen, setLockPromptOpen] = useState(false);
  const [lockNameDraft, setLockNameDraft] = useState('');

  const liveTasks = tasks || [];
  const {
    activeLock,
    locks,
    comparisons,
    finalComparison,
    nextMilestone,
    onTrackCount,
    finalLiveMilestone,
    daysRemaining,
    pctComplete
  } = computeTimelineMetrics(liveTasks, timelineLocks, selectedLockId);

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('authToken')}`
  });

  // Sends the tasks currently known to this page rather than trusting
  // whatever's last committed server-side - same reasoning as Budget's
  // lock: unlike Budget, this page's own `tasks` prop is a synced copy of
  // CustomTimeline's state (which owns and saves its own tasks
  // independently), not the true source of truth - sending it here could
  // freeze a stale pre-edit snapshot if a Gantt edit's save hasn't landed
  // yet. Omitting `tasks` makes the server read straight from the DB
  // instead, which is one hop fresher (no PUT-then-broadcast-then-socket
  // round trip to wait on). The naming prompt below is the confirmation
  // step - no window.confirm.
  const handleLock = async () => {
    setLocking(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/projects/${projectId}/timeline/lock`, {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(),
        body: JSON.stringify({ name: lockNameDraft })
      });
      if (!res.ok) throw new Error(`Lock failed: ${res.status}`);
      const data = await res.json();
      onLocksChange(data.timelineLocks || []);
      setSelectedLockId(null);
      setLockPromptOpen(false);
      setLockNameDraft('');
    } catch (error) {
      console.error('Failed to lock timeline:', error);
      window.alert('Could not lock the timeline - please try again.');
    } finally {
      setLocking(false);
    }
  };

  const milestoneCount = liveTasks.filter((t) => t.type === 'milestone').length;

  return (
    <div className="timeline-module">
      <div className="hero-row-with-toggle">
        <div className="hero-tile-row">
          <div className="hero-tile-wrapper">
            <div className="hero-tile-label">Days Remaining</div>
            <div className="hero-tile">
              {finalLiveMilestone && <div className="hero-tile-sublabel">{finalLiveMilestone.name}</div>}
              <div className={`hero-tile-value ${daysRemaining !== null && daysRemaining < 0 ? 'over' : ''}`}>
                {daysRemaining === null
                  ? '—'
                  : daysRemaining < 0
                    ? `${Math.abs(daysRemaining)} day${Math.abs(daysRemaining) === 1 ? '' : 's'} overdue`
                    : `${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`}
              </div>
              {finalLiveMilestone && <div className="hero-tile-subdate">{formatDate(finalLiveMilestone.date)}</div>}
            </div>
          </div>
          <div className="hero-tile-wrapper">
            <div className="hero-tile-label">Slippage</div>
            <div className="hero-tile">
              {finalComparison && <div className="hero-tile-sublabel">{finalComparison.name}</div>}
              <div className={`hero-tile-value ${finalComparison ? deltaClass(finalComparison.slippageDays) : ''}`}>
                {finalComparison
                  ? `${finalComparison.slippageDays > 0 ? '+' : ''}${finalComparison.slippageDays} day${Math.abs(finalComparison.slippageDays) === 1 ? '' : 's'}`
                  : '—'}
              </div>
              {finalComparison && <div className="hero-tile-subdate">{formatDate(finalComparison.liveDate)}</div>}
            </div>
          </div>
          <div className="hero-tile-wrapper">
            <div className="hero-tile-label">Next Milestone</div>
            <div className="hero-tile">
              {nextMilestone && <div className="hero-tile-sublabel">{nextMilestone.name}</div>}
              <div className="hero-tile-value hero-tile-value-text">
                {nextMilestone ? formatDate(nextMilestone.date) : '—'}
              </div>
            </div>
          </div>
          <div className="hero-tile-wrapper">
            <div className="hero-tile-label">Milestones On Track</div>
            <div className="hero-tile">
              <div className="hero-tile-value">
                {comparisons.length ? `${onTrackCount} of ${comparisons.length}` : '—'}
              </div>
            </div>
          </div>
          <div className="hero-tile-wrapper">
            <div className="hero-tile-label">% Complete</div>
            <div className="hero-tile">
              <div className="hero-tile-value">{pctComplete !== null ? `${pctComplete}%` : '—'}</div>
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
              {activeLock ? `Vs. ${lockLabel(activeLock)}` : 'No timeline locked yet'}
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
            <button
              type="button"
              className="btn-primary"
              onClick={() => setLockPromptOpen((o) => !o)}
              disabled={locking || milestoneCount === 0}
            >
              🔒 Lock Timeline
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
                placeholder={`e.g. "Original Schedule" (defaults to ${formatDateTime(new Date().toISOString())})`}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleLock(); }}
              />
              <div className="budget-paste-actions">
                <button type="button" className="btn-secondary" onClick={() => { setLockPromptOpen(false); setLockNameDraft(''); }}>
                  Cancel
                </button>
                <button type="button" className="btn-primary" onClick={handleLock} disabled={locking}>
                  🔒 Lock Timeline
                </button>
              </div>
            </div>
          )}

          <div className="timeline-full-section">
            <CustomTimeline projectId={projectId} compact={false} people={people} activeLock={activeLock} />
          </div>
        </>
      )}
    </div>
  );
}

export default TimelineModule;
