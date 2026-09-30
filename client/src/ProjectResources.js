import React, { useState } from 'react';
import { RESOURCE_KINDS, detectSource, kindLabel, linkKind, resourceLayout } from './resources';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';

// Small inline icons, chosen from the link's URL (detectSource) - or, for
// an empty pinned slot, from the slot's kind.
export function ResourceIcon({ type, size = 28 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true };
  switch (type) {
    case 'folder':
      return (
        <svg {...common}><path fill="#5f6368" d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" /></svg>
      );
    case 'sheets':
      return (
        <svg {...common}>
          <rect x="3" y="2" width="18" height="20" rx="2" fill="#0f9d58" />
          <rect x="6" y="8" width="12" height="10" fill="#fff" />
          <path d="M6 11.3h12M6 14.6h12M10 8v10" stroke="#0f9d58" strokeWidth="1.2" />
        </svg>
      );
    case 'doc':
      return (
        <svg {...common}>
          <rect x="3" y="2" width="18" height="20" rx="2" fill="#4285f4" />
          <path d="M7 8h10M7 11.5h10M7 15h6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case 'slides':
      return (
        <svg {...common}>
          <rect x="3" y="2" width="18" height="20" rx="2" fill="#f4b400" />
          <rect x="6.5" y="8" width="11" height="7.5" rx="1" fill="#fff" />
        </svg>
      );
    case 'pdf':
      return (
        <svg {...common}>
          <rect x="3" y="2" width="18" height="20" rx="2" fill="#db4437" />
          <text x="12" y="15.5" textAnchor="middle" fontSize="6.5" fontWeight="700" fill="#fff" fontFamily="sans-serif">PDF</text>
        </svg>
      );
    case 'file':
      return (
        <svg {...common}>
          <path fill="#8ab4f8" d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
          <path fill="#4285f4" d="M14 2v5h5z" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path fill="none" stroke="#5f6368" strokeWidth="2" strokeLinecap="round"
            d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
        </svg>
      );
  }
}

const EMPTY_SLOT_ICON = { folder: 'folder', model: 'sheets' };
const ADDABLE_KINDS = RESOURCE_KINDS.filter((k) => !k.pinned);

// The Resources row at the top of Project Detail: Project Folder and
// Working Model always have a slot (dashed "+ Link ..." until set), then
// any Teaser / Offering Memorandum / Pitch Deck / Other links, then
// "+ Add resource". Each tile opens its link in a new tab; hovering shows
// ⋯ for Replace link / Remove. Saves straight away via the link routes.
function ProjectResources({ projectId, links, onLinksChange }) {
  // editor: null | { mode: 'add', kind, label, url } | { mode: 'replace', link, label, url }
  const [editor, setEditor] = useState(null);
  const [menuFor, setMenuFor] = useState(null);
  const [saving, setSaving] = useState(false);
  const { pinned, extras } = resourceLayout(links);

  const request = async (method, path, body) => {
    const token = localStorage.getItem('authToken');
    const res = await fetch(`${API_BASE_URL}/api/origination/link${path}`, {
      method,
      credentials: 'include',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  };

  const save = async () => {
    if (!editor || !editor.url.trim()) return;
    setSaving(true);
    try {
      if (editor.mode === 'add') {
        // The label box only shows for "Other" - ignore anything typed there
        // if the type was switched afterwards.
        const label = (editor.kind === 'other' && editor.label.trim()) || kindLabel(editor.kind);
        const { link } = await request('POST', '', { cardId: projectId, kind: editor.kind, title: label, url: editor.url.trim() });
        onLinksChange((prev) => [...prev.filter((l) => l.id !== link.id), link]);
      } else {
        const label = editor.label.trim() || editor.link.title;
        const { link } = await request('PUT', `/${editor.link.id}`, { cardId: projectId, title: label, url: editor.url.trim() });
        onLinksChange((prev) => prev.map((l) => (l.id === link.id ? link : l)));
      }
      setEditor(null);
    } catch (error) {
      window.alert(`Could not save the link: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (link) => {
    setMenuFor(null);
    if (!window.confirm(`Remove "${link.title}"? The file itself isn't touched.`)) return;
    try {
      await request('DELETE', `/${link.id}?cardId=${encodeURIComponent(projectId)}`);
      onLinksChange((prev) => prev.filter((l) => l.id !== link.id));
    } catch (error) {
      window.alert(`Could not remove the link: ${error.message}`);
    }
  };

  const renderTile = (link) => {
    const source = detectSource(link.url);
    const kind = linkKind(link);
    return (
      <div key={link.id} className="resource-tile-wrap">
        <a className="resource-tile" href={link.url} target="_blank" rel="noopener noreferrer" title={link.url}>
          <ResourceIcon type={source.type} />
          <span className="resource-tile-label">{link.title || kindLabel(kind)}</span>
          <span className="resource-tile-caption">{source.caption}</span>
        </a>
        <button
          type="button"
          className="resource-tile-menu-btn"
          title="Replace or remove"
          onClick={() => setMenuFor(menuFor === link.id ? null : link.id)}
        >⋯</button>
        {menuFor === link.id && (
          <div className="resource-tile-menu" onMouseLeave={() => setMenuFor(null)}>
            <button type="button" onClick={() => { setMenuFor(null); setEditor({ mode: 'replace', link, label: link.title || '', url: link.url }); }}>
              Replace link
            </button>
            <button type="button" className="danger" onClick={() => remove(link)}>Remove</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="project-resources">
      <div className="resource-tiles">
        {pinned.map((slot) => (slot.link ? renderTile(slot.link) : (
          <button
            key={slot.kind}
            type="button"
            className="resource-tile resource-tile-empty"
            onClick={() => setEditor({ mode: 'add', kind: slot.kind, label: slot.label, url: '' })}
          >
            <ResourceIcon type={EMPTY_SLOT_ICON[slot.kind]} />
            <span className="resource-tile-label">{slot.label}</span>
            <span className="resource-tile-caption">＋ Add link</span>
          </button>
        )))}
        {extras.map(renderTile)}
        <button
          type="button"
          className="resource-tile resource-tile-add"
          onClick={() => setEditor({ mode: 'add', kind: 'teaser', label: '', url: '' })}
        >
          <span className="resource-tile-plus">＋</span>
          <span className="resource-tile-label">Add resource</span>
        </button>
      </div>

      {editor && (
        <div className="resource-editor">
          {editor.mode === 'add' && !RESOURCE_KINDS.find((k) => k.kind === editor.kind)?.pinned && (
            <select value={editor.kind} onChange={(e) => setEditor({ ...editor, kind: e.target.value })}>
              {ADDABLE_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            </select>
          )}
          {(editor.mode === 'replace' || editor.kind === 'other') && (
            <input
              type="text"
              placeholder={editor.kind === 'other' ? 'Label (e.g. Site plan)' : 'Label'}
              value={editor.label}
              onChange={(e) => setEditor({ ...editor, label: e.target.value })}
            />
          )}
          <input
            type="url"
            autoFocus
            placeholder={editor.mode === 'replace'
              ? 'New link (https://...)'
              : `Paste the ${(editor.kind === 'other' ? 'link' : kindLabel(editor.kind))} link (https://...)`}
            value={editor.url}
            onChange={(e) => setEditor({ ...editor, url: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); save(); }
              if (e.key === 'Escape') setEditor(null);
            }}
          />
          <button type="button" className="btn-primary" disabled={!editor.url.trim() || saving} onClick={save}>
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button type="button" className="btn-secondary" disabled={saving} onClick={() => setEditor(null)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

export default ProjectResources;
