import React, { useState } from 'react';
import CustomTimeline from './CustomTimeline';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';

// Milestone dates are "yyyy-mm-dd" (date-only) strings. `new Date(iso)`
// parses those as UTC midnight, which in any US timezone is already the
// previous calendar day locally - so formatting straight off that Date
// object would show the wrong day. Parsing as a local date first avoids it.
function formatDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(iso) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}

function daysBetween(fromIso, toIso) {
  const ms = new Date(toIso) - new Date(fromIso);
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

// Same UTC-midnight trap as formatDate above, for comparing a milestone's
// date-only string against a real Date object (e.g. "is this today or
// later") rather than another date-only string - daysBetween's own
// string-vs-string diff cancels the shift out, but a mixed comparison
// like `new Date(iso) >= today` doesn't, and can misclassify a milestone
// dated today as already past.
function parseLocalDate(dateOnlyString) {
  const [year, month, day] = dateOnlyString.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function deltaClass(days) {
  if (days > 0) return 'over';
  if (days < 0) return 'under';
  return '';
}

// Naming a lock is optional - unnamed ones just fall back to their timestamp.
function lockLabel(lock) {
  return lock.name ? lock.name : `Locked ${formatDateTime(lock.lockedAt)}`;
}

// Every locked milestone matched against its live counterpart by id (a
// milestone deleted since the lock has nothing to compare against, so
// it's dropped rather than shown as infinitely slipped).
function compareMilestones(lock, tasks) {
  if (!lock) return [];
  return lock.milestones
    .map((locked) => {
      const live = tasks.find((t) => t.id === locked.id && t.type === 'milestone');
      if (!live) return null;
      return { ...locked, liveDate: live.date, slippageDays: daysBetween(locked.date, live.date) };
    })
    .filter(Boolean);
}

function TimelineModule({ projectId, tasks, timelineLocks, people, onLocksChange, expanded, onToggleExpanded }) {
  const [locking, setLocking] = useState(false);
  const [selectedLockId, setSelectedLockId] = useState(null);
  const [lockPromptOpen, setLockPromptOpen] = useState(false);
  const [lockNameDraft, setLockNameDraft] = useState('');

  const liveTasks = tasks || [];
  const locks = timelineLocks || [];
  const latestLock = locks.length ? locks[locks.length - 1] : null;
  const activeLock = selectedLockId ? locks.find((l) => l.id === selectedLockId) || latestLock : latestLock;
  const comparisons = compareMilestones(activeLock, liveTasks);

  // "The last milestone" = whichever one was locked in furthest out -
  // the project's ultimate completion point, per the original ask of
  // reporting slippage against it specifically.
  const finalComparison = comparisons.length
    ? [...comparisons].sort((a, b) => new Date(b.date) - new Date(a.date))[0]
    : null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const nextMilestone = liveTasks
    .filter((t) => t.type === 'milestone' && t.date && parseLocalDate(t.date) >= today)
    .sort((a, b) => new Date(a.date) - new Date(b.date))[0] || null;

  const onTrackCount = comparisons.filter((m) => m.slippageDays <= 0).length;

  // Days remaining counts down to the furthest-out LIVE milestone (the
  // project's current end target), not the locked one finalComparison
  // uses - this should move as the plan changes, even between locks.
  const liveMilestones = liveTasks.filter((t) => t.type === 'milestone' && t.date);
  const finalLiveMilestone = liveMilestones.length
    ? [...liveMilestones].sort((a, b) => new Date(b.date) - new Date(a.date))[0]
    : null;
  const daysRemaining = finalLiveMilestone ? daysBetween(todayIso, finalLiveMilestone.date) : null;

  const workTasks = liveTasks.filter((t) => t.type === 'task');
  const pctComplete = workTasks.length
    ? Math.round(workTasks.reduce((sum, t) => sum + (Number(t.progress) || 0), 0) / workTasks.length)
    : null;

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
