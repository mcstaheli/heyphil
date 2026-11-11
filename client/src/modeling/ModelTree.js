import React, { useMemo, useState } from 'react';
import { modelingApi, sheetUrl, when, who } from './api';
import ActionModal from './ActionModal';

// The family tree of a template's or project's models: each model under
// the one it was copied from. Every row shows the version (and label),
// ★ Active / ☆ starred / 🔒 Locked or ✎ Unlocked, who made it and when,
// and its actions. Hidden models are left out unless "Show hidden" is on -
// except when they have visible children, which then show under a greyed
// hidden parent so the line of descent stays readable.

export const title = (m) => (m.label ? `${m.version} · ${m.label}` : m.version);

export function buildTree(models, { showHidden }) {
  const byId = new Map(models.map((m) => [m.id, m]));
  const kids = new Map();
  models.forEach((m) => {
    const p = m.parentModelId && byId.has(m.parentModelId) ? m.parentModelId : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(m);
  });
  const visible = (m) => showHidden || !m.hiddenAt || (kids.get(m.id) || []).some(visible);
  const order = (a, b) => new Date(a.createdAt) - new Date(b.createdAt) || a.id - b.id;
  const walk = (parentId, depth) => (kids.get(parentId) || []).filter(visible).sort(order)
    .flatMap((m) => [{ model: m, depth }, ...walk(m.id, depth + 1)]);
  return walk(null, 0);
}

function Badges({ m }) {
  return (
    <span className="mdl-badges">
      {m.isActive && <span className="mdl-badge mdl-badge-active" title={`Active since ${when(m.activatedAt)} (${who(m.activatedByEmail, m.activatedByName)})`}>★ Active</span>}
      {m.locked
        ? <span className="mdl-badge mdl-badge-locked" title={m.lockedAt ? `Locked ${when(m.lockedAt)}${m.lockedByEmail ? ` by ${who(m.lockedByEmail, m.lockedByName)}` : ''}` : 'Locked'}>🔒 Locked</span>
        : <span className="mdl-badge mdl-badge-unlocked" title="Editable">✎ Unlocked</span>}
      {m.hiddenAt && <span className="mdl-badge mdl-badge-hidden" title={`Hidden by ${who(m.hiddenByEmail, m.hiddenByName)} ${when(m.hiddenAt)}`}>Hidden</span>}
    </span>
  );
}

// One card in the summary box: the Active model or a starred one.
function SummaryCard({ m, kind, onCopy, onMakeActive }) {
  return (
    <div className={`mdl-summary-card mdl-summary-${kind}`}>
      <div className="mdl-summary-head">
        <span className="mdl-summary-kind">{kind === 'active' ? '★ Active' : '☆ Starred'}</span>
        <span className="mdl-summary-version">{m.version}</span>
        {m.label && <span className="mdl-summary-label">{m.label}</span>}
        <span className="mdl-summary-state">{m.locked ? '🔒 Locked' : '✎ Unlocked'}</span>
      </div>
      {m.note && <p className="mdl-summary-note">{m.note}</p>}
      <dl className="mdl-summary-facts">
        <div><dt>Made</dt><dd>{m.origin === 'import' ? 'Imported' : who(m.createdByEmail, m.createdByName)} · {when(m.createdAt)}</dd></div>
        {m.parentVersion && <div><dt>From</dt><dd>{m.parentTemplateName ? `${m.parentTemplateName} ` : ''}{m.parentVersion}</dd></div>}
        {m.locked && m.lockedAt && <div><dt>Locked</dt><dd>{m.lockedByEmail ? `${who(m.lockedByEmail, m.lockedByName)} · ` : ''}{when(m.lockedAt)}</dd></div>}
        {kind === 'active' && m.activatedAt && <div><dt>Active since</dt><dd>{who(m.activatedByEmail, m.activatedByName)} · {when(m.activatedAt)}</dd></div>}
        {kind === 'starred' && m.starredAt && <div><dt>Starred</dt><dd>{who(m.starredByEmail, m.starredByName)} · {when(m.starredAt)}</dd></div>}
      </dl>
      <div className="mdl-actions">
        <a className="mdl-btn" href={sheetUrl(m.fileId)} target="_blank" rel="noreferrer">Open in Sheets ↗</a>
        <button type="button" className="mdl-btn" onClick={() => onCopy(m)}>Copy</button>
        {!m.isActive && <button type="button" className="mdl-btn mdl-btn-primary" onClick={() => onMakeActive(m)}>Make Active</button>}
      </div>
    </div>
  );
}

// The summary box (Active + starred) and, below it, the full family tree
// in a "<name> History" section that opens and closes (remembered per
// template/project in this browser).
export default function ModelTree({ models, ownerName, onAction, onChanged, emptyText, historyKey }) {
  const storageKey = `modeling:history-open:${historyKey || ownerName}`;
  const [historyOpen, setHistoryOpen] = useState(() => {
    try { return localStorage.getItem(storageKey) === '1'; } catch { return false; }
  });
  const toggleHistory = () => setHistoryOpen((o) => {
    try { localStorage.setItem(storageKey, o ? '0' : '1'); } catch { /* private mode */ }
    return !o;
  });
  const [showHidden, setShowHidden] = useState(false);
  const [copying, setCopying] = useState(null);
  const [nextVersion, setNextVersion] = useState('');
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);
  const rows = useMemo(() => buildTree(models, { showHidden }), [models, showHidden]);
  const hiddenCount = models.filter((m) => m.hiddenAt).length;
  const byId = useMemo(() => new Map(models.map((m) => [m.id, m])), [models]);

  async function quick(m, path, body, failText) {
    setBusyId(m.id);
    setError(null);
    try {
      await modelingApi('POST', `/models/${m.id}/${path}`, body);
      onChanged();
    } catch (err) {
      setError(`${failText}: ${err.message}`);
    } finally {
      setBusyId(null);
    }
  }

  function startCopy(m) {
    setCopying(m);
    setLabel('');
    setNote('');
    setNextVersion('');
    modelingApi('GET', `/models/${m.id}/next-version`).then((r) => setNextVersion(r.version)).catch(() => setNextVersion('?'));
  }

  function lock(m) {
    if (!window.confirm(`Lock ${title(m)}?\n\nIt becomes view-only for everyone (only a drive Manager can unlock it). To change it later, make a copy.`)) return;
    onAction({ title: `Lock ${title(m)}`, start: () => modelingApi('POST', `/models/${m.id}/lock`, {}) });
  }

  function makeActive(m) {
    const current = models.find((x) => x.isActive);
    const lines = [
      `Make ${title(m)} the Active model of ${ownerName}?`,
      '',
      m.locked ? null : `${m.version} is unlocked - it will be locked first (view-only for everyone; to change it later, make a copy).`,
      current ? `${current.version} stops being Active (it stays locked).` : null,
    ].filter((x) => x !== null);
    if (!window.confirm(lines.join('\n'))) return;
    onAction({ title: `Make ${title(m)} Active`, start: () => modelingApi('POST', `/models/${m.id}/lock`, { activate: true }) });
  }

  function hide(m) {
    const kidsCount = models.filter((x) => x.parentModelId === m.id && !x.hiddenAt).length;
    const msg = `Hide ${title(m)}?\n\nIt's only hidden in HeyPhil - the file stays in Drive, and Show hidden brings it back.${kidsCount ? `\n\nIts ${kidsCount} visible ${kidsCount === 1 ? 'copy stays' : 'copies stay'} in the tree under it.` : ''}`;
    if (window.confirm(msg)) quick(m, 'hide', { hidden: true }, `Couldn't hide ${m.version}`);
  }

  const active = models.find((m) => m.isActive);
  const starred = models.filter((m) => m.starredAt && !m.hiddenAt && !m.isActive);

  return (
    <div className="mdl-tree">
      {error && <p className="mdl-error">{error}</p>}
      <div className="mdl-summary">
        {active
          ? <SummaryCard m={active} kind="active" onCopy={startCopy} onMakeActive={makeActive} />
          : <p className="mdl-empty">No Active model yet. When one is ready, Make Active locks it and makes it the official model.</p>}
        {starred.map((m) => <SummaryCard key={m.id} m={m} kind="starred" onCopy={startCopy} onMakeActive={makeActive} />)}
      </div>

      <button type="button" className="mdl-history-toggle" onClick={toggleHistory} aria-expanded={historyOpen}>
        <span>{ownerName} History</span>
        <span className="mdl-history-count">{models.filter((m) => !m.hiddenAt).length} model{models.length === 1 ? '' : 's'}</span>
        <span className={`mdl-history-arrow ${historyOpen ? 'open' : ''}`} aria-hidden>▸</span>
      </button>
      {historyOpen && (<>
      {!rows.length ? <p className="mdl-empty">{emptyText}</p> : (
        <table className="mdl-table">
          <thead><tr><th>Version</th><th>Status</th><th>Made</th><th /></tr></thead>
          <tbody>
            {rows.map(({ model: m, depth }) => {
              const parent = m.parentModelId ? byId.get(m.parentModelId) : null;
              const from = !parent && m.parentVersion ? `from ${m.parentTemplateName || 'template'} ${m.parentVersion}` : null;
              return (
                <tr key={m.id} className={[
                  m.hiddenAt ? 'mdl-row-hidden' : '',
                  // the whole row reads at a glance (#60): Active green, starred yellow
                  m.isActive ? 'mdl-row-active' : m.starredAt && !m.hiddenAt ? 'mdl-row-starred' : '',
                ].filter(Boolean).join(' ')}>
                  <td>
                    <div className="mdl-tree-name" style={{ paddingLeft: depth * 22 }}>
                      {depth > 0 && <span className="mdl-tree-branch">└</span>}
                      <span>
                        <b>{m.version}</b>{m.label && <> · {m.label}</>}
                        {from && <div className="mdl-muted">{from}</div>}
                        {m.note && <div className="mdl-muted">{m.note}</div>}
                        <div className="mdl-filename">{m.fileName}</div>
                      </span>
                    </div>
                  </td>
                  <td><Badges m={m} /></td>
                  <td>
                    {m.origin === 'import' ? 'Imported' : who(m.createdByEmail, m.createdByName)}
                    <div className="mdl-muted">{when(m.createdAt)}</div>
                  </td>
                  <td className="mdl-actions">
                    <a href={sheetUrl(m.fileId)} target="_blank" rel="noreferrer">Open ↗</a>
                    {!m.hiddenAt && (
                      <>
                        <button type="button" className="mdl-btn" onClick={() => startCopy(m)}>Copy</button>
                        {!m.locked && <button type="button" className="mdl-btn" onClick={() => lock(m)}>Lock</button>}
                        {!m.isActive && <button type="button" className="mdl-btn mdl-btn-primary" onClick={() => makeActive(m)}>Make Active</button>}
                        <button
                          type="button"
                          className={`mdl-btn mdl-star ${m.starredAt ? 'on' : ''}`}
                          title={m.starredAt ? `Starred by ${who(m.starredByEmail, m.starredByName)} ${when(m.starredAt)} - click to unstar` : 'Star: being worked with now'}
                          disabled={busyId === m.id}
                          onClick={() => quick(m, 'star', { starred: !m.starredAt }, `Couldn't change the star on ${m.version}`)}
                        >{m.starredAt ? '★' : '☆'}</button>
                        <button type="button" className="mdl-btn" onClick={() => onAction({ title: `Export ${title(m)} to Excel`, start: () => modelingApi('POST', `/models/${m.id}/export`) })}>Export</button>
                        {!m.isActive && <button type="button" className="mdl-btn mdl-btn-quiet" disabled={busyId === m.id} onClick={() => hide(m)}>Hide</button>}
                      </>
                    )}
                    {m.hiddenAt && <button type="button" className="mdl-btn" disabled={busyId === m.id} onClick={() => quick(m, 'hide', { hidden: false }, `Couldn't unhide ${m.version}`)}>Unhide</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {hiddenCount > 0 && (
        <label className="mdl-check mdl-show-hidden">
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden ({hiddenCount})
        </label>
      )}
      </>)}

      {copying && (
        <ActionModal
          title={`Copy ${title(copying)}`}
          submitLabel={nextVersion && nextVersion !== '?' ? `Make ${nextVersion}` : 'Make copy'}
          onClose={() => { setCopying(null); onChanged(); }}
          onFinished={onChanged}
          onSubmit={() => modelingApi('POST', `/models/${copying.id}/copy`, { label, note })}
        >
          <p className="mdl-muted">
            Makes an editable copy for changes and scenarios. {copying.version} isn't changed.
            {nextVersion && nextVersion !== '?' && <> The copy will be <b>{nextVersion}</b>.</>}
          </p>
          <label>Label (optional)<input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="e.g. Higher ADR case" autoFocus /></label>
          <label>Note (optional)<textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={4} placeholder="What's different about this copy, what you're testing, why it exists…" /></label>
        </ActionModal>
      )}
    </div>
  );
}
