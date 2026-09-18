import React, { useState } from 'react';
import CustomTimeline from './CustomTimeline';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
  const nextMilestone = liveTasks
    .filter((t) => t.type === 'milestone' && t.date && new Date(t.date) >= today)
    .sort((a, b) => new Date(a.date) - new Date(b.date))[0] || null;

  const onTrackCount = comparisons.filter((m) => m.slippageDays <= 0).length;

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
      <div className="hero-tile-row">
        <div className="hero-tile">
          <div className="hero-tile-label">
            {finalComparison ? `Slippage: ${finalComparison.name}` : 'Slippage (Final Milestone)'}
          </div>
          <div className={`hero-tile-value ${finalComparison ? deltaClass(finalComparison.slippageDays) : ''}`}>
            {finalComparison
              ? `${finalComparison.slippageDays > 0 ? '+' : ''}${finalComparison.slippageDays} day${Math.abs(finalComparison.slippageDays) === 1 ? '' : 's'}`
              : '—'}
          </div>
        </div>
        <div className="hero-tile">
          <div className="hero-tile-label">Next Milestone</div>
          <div className="hero-tile-value hero-tile-value-text">
            {nextMilestone ? `${nextMilestone.name} · ${formatDate(nextMilestone.date)}` : '—'}
          </div>
        </div>
        <div className="hero-tile">
          <div className="hero-tile-label">Milestones On Track</div>
          <div className="hero-tile-value">
            {comparisons.length ? `${onTrackCount} of ${comparisons.length}` : '—'}
          </div>
        </div>
        <div className="hero-tile">
          <div className="hero-tile-label">% Complete</div>
          <div className="hero-tile-value">{pctComplete !== null ? `${pctComplete}%` : '—'}</div>
        </div>
      </div>

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
          <button
            type="button"
            className="btn-primary"
            onClick={() => setLockPromptOpen((o) => !o)}
            disabled={locking || milestoneCount === 0}
          >
            🔒 Lock Timeline
          </button>
          <button
            type="button"
            className="module-expand-btn"
            onClick={onToggleExpanded}
            title={expanded ? 'Collapse details' : 'Expand details'}
          >
            {expanded ? '▾' : '▸'}
          </button>
        </div>
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

      {expanded && (
        <div className="timeline-full-section">
          <CustomTimeline projectId={projectId} compact={false} people={people} />
        </div>
      )}
    </div>
  );
}

export default TimelineModule;
