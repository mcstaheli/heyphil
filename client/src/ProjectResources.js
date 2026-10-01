import React, { useState } from 'react';
import { RESOURCE_KINDS, detectSource, driveFolderId, kindLabel, linkKind, rankFolders, resourceLayout } from './resources';

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

// "Add folder" for the Project Folder slot: lists the deal folders in the
// Drive Projects folder (GET /api/drive/project-folders), the one named
// like this project first. Until Drive access is set up the route answers
// 503 with what to do; "Paste a link instead" always works.
function FolderPickerModal({ projectName, onPick, onClose }) {
  const [state, setState] = useState({ loading: true, folders: [], error: null, setup: null });
  const [query, setQuery] = useState('');
  const [pasting, setPasting] = useState(false);
  const [pasteUrl, setPasteUrl] = useState('');

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem('authToken');
        const res = await fetch(`${API_BASE_URL}/api/drive/project-folders`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setState({ loading: false, folders: [], error: data.error || 'Could not load the Drive folders', setup: data.setup ? data : null });
          setPasting(true);
          return;
        }
        setState({ loading: false, folders: data.folders || [], error: null, setup: null });
      } catch (error) {
        if (!cancelled) {
          setState({ loading: false, folders: [], error: 'Could not reach HeyPhil to load the folders', setup: null });
          setPasting(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const ranked = rankFolders(state.folders, query, projectName);

  return (
    <div className="folder-picker-overlay" onClick={onClose}>
      <div className="folder-picker" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Choose the project folder">
        <div className="folder-picker-header">
          <h3>Choose the project folder</h3>
          <button type="button" className="folder-picker-close" onClick={onClose} title="Close">×</button>
        </div>

        {state.loading && <p className="folder-picker-note">Loading folders from Drive...</p>}

        {state.error && (
          <div className="folder-picker-error">
            <p>{state.error}</p>
            {state.setup && state.setup.serviceAccountEmail && (
              <p>
                To list folders here, share the Drive <b>Projects</b> folder (Viewer) with{' '}
                <code>{state.setup.serviceAccountEmail}</code>
                {/turned off/i.test(state.error) && ' and turn on the Google Drive API for its Google Cloud project'}.
              </p>
            )}
          </div>
        )}

        {!state.loading && !state.error && (
          <>
            <input
              type="text"
              className="folder-picker-search"
              placeholder="Search folders..."
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && ranked[0]) onPick(ranked[0]);
                if (e.key === 'Escape') onClose();
              }}
            />
            <ul className="folder-picker-list">
              {ranked.length === 0 && (
                <li className="folder-picker-empty">
                  {state.folders.length === 0 ? 'The Projects folder has no subfolders yet.' : 'No folders match.'}
                </li>
              )}
              {ranked.map((folder) => (
                <li key={folder.id}>
                  <button type="button" onClick={() => onPick(folder)}>
                    <ResourceIcon type="folder" size={20} />
                    <span className="folder-picker-name">{folder.name}</span>
                    {folder.suggested && <span className="folder-picker-suggested">Suggested</span>}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="folder-picker-footer">
          {!pasting ? (
            <button type="button" className="folder-picker-paste-toggle" onClick={() => setPasting(true)}>
              Paste a link instead
            </button>
          ) : (
            <div className="folder-picker-paste">
              <input
                type="url"
                placeholder="Paste a folder link (https://drive.google.com/...)"
                value={pasteUrl}
                autoFocus={!!state.error}
                onChange={(e) => setPasteUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && pasteUrl.trim()) onPick({ name: 'Project Folder', url: pasteUrl.trim() });
                  if (e.key === 'Escape') onClose();
                }}
              />
              <button
                type="button"
                className="btn-primary"
                disabled={!pasteUrl.trim()}
                onClick={() => onPick({ name: 'Project Folder', url: pasteUrl.trim() })}
              >
                Use link
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
const ADDABLE_KINDS = RESOURCE_KINDS.filter((k) => !k.pinned);

// The Resources row at the top of Project Detail: Project Folder and
// Working Model always have a slot (dashed "+ Link ..." until set), then
// any Teaser / Offering Memorandum / Pitch Deck / Other links, then
// "+ Add resource". Each tile opens its link in a new tab; hovering shows
// ⋯ for Replace link / Remove. Saves straight away via the link routes.
function ProjectResources({ projectId, projectName, links, onLinksChange }) {
  // editor: null | { mode: 'add', kind, label, url } | { mode: 'replace', link, label, url }
  const [editor, setEditor] = useState(null);
  const [menuFor, setMenuFor] = useState(null);
  const [saving, setSaving] = useState(false);
  const [folderPicker, setFolderPicker] = useState(null); // null | { link: existing folder link or null }
  const { pinned, extras } = resourceLayout(links);

  // Working Model default: with no model pinned, show the latest LOCKED
  // version found in the Project Folder (and its subfolders) - looked up
  // on each visit, so a newly locked version shows up on its own.
  const folderLink = pinned.find((p) => p.kind === 'folder').link;
  const modelLink = pinned.find((p) => p.kind === 'model').link;
  const autoFolderId = !modelLink && folderLink ? driveFolderId(folderLink.url) : null;
  const [autoModel, setAutoModel] = useState({ status: 'idle', model: null });
  React.useEffect(() => {
    if (!autoFolderId) {
      setAutoModel({ status: 'idle', model: null });
      return undefined;
    }
    let cancelled = false;
    setAutoModel({ status: 'loading', model: null });
    (async () => {
      try {
        const token = localStorage.getItem('authToken');
        const res = await fetch(`${API_BASE_URL}/api/drive/folders/${encodeURIComponent(autoFolderId)}/latest-model`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) setAutoModel({ status: 'error', model: null, error: data.error });
        else setAutoModel({ status: data.model ? 'ready' : 'none', model: data.model || null });
      } catch (error) {
        if (!cancelled) setAutoModel({ status: 'error', model: null });
      }
    })();
    return () => { cancelled = true; };
  }, [autoFolderId]);

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

  // Picked (or pasted) a folder: the link's title is the folder's name, so
  // the tile can show which folder it is.
  const saveFolder = async (folder) => {
    const existing = folderPicker && folderPicker.link;
    setFolderPicker(null);
    try {
      if (existing) {
        const { link } = await request('PUT', `/${existing.id}`, { cardId: projectId, title: folder.name, url: folder.url });
        onLinksChange((prev) => prev.map((l) => (l.id === link.id ? link : l)));
      } else {
        const { link } = await request('POST', '', { cardId: projectId, kind: 'folder', title: folder.name, url: folder.url });
        onLinksChange((prev) => [...prev.filter((l) => l.id !== link.id), link]);
      }
    } catch (error) {
      window.alert(`Could not save the folder: ${error.message}`);
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
    // Project Folder / Working Model keep their slot name as the label and
    // show which file/folder it is (e.g. the folder's name) underneath.
    const isPinned = RESOURCE_KINDS.some((k) => k.kind === kind && k.pinned);
    const label = isPinned ? kindLabel(kind) : (link.title || kindLabel(kind));
    const caption = isPinned && link.title && link.title !== kindLabel(kind) ? link.title : source.caption;
    return (
      <div key={link.id} className="resource-tile-wrap">
        <a className="resource-tile" href={link.url} target="_blank" rel="noopener noreferrer" title={link.url}>
          <ResourceIcon type={source.type} />
          <span className="resource-tile-label">{label}</span>
          <span className="resource-tile-caption">{caption}</span>
        </a>
        <button
          type="button"
          className="resource-tile-menu-btn"
          title="Replace or remove"
          onClick={() => setMenuFor(menuFor === link.id ? null : link.id)}
        >⋯</button>
        {menuFor === link.id && (
          <div className="resource-tile-menu" onMouseLeave={() => setMenuFor(null)}>
            <button
              type="button"
              onClick={() => {
                setMenuFor(null);
                if (kind === 'folder') setFolderPicker({ link });
                else setEditor({ mode: 'replace', link, label: link.title || '', url: link.url });
              }}
            >
              {kind === 'folder' ? 'Choose a different folder' : 'Replace link'}
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
        {pinned.map((slot) => (slot.link ? renderTile(slot.link) : slot.kind === 'model' && autoModel.model ? (
          <div key="model-auto" className="resource-tile-wrap">
            <a
              className="resource-tile"
              href={autoModel.model.url}
              target="_blank"
              rel="noopener noreferrer"
              title={`${autoModel.model.name} - the latest locked version in the Project Folder`}
            >
              <ResourceIcon type="sheets" />
              <span className="resource-tile-label">Working Model <span className="resource-tile-badge">Latest</span></span>
              <span className="resource-tile-caption">
                {autoModel.model.version}{autoModel.model.lockedOn ? ` · locked ${autoModel.model.lockedOn}` : ''}
              </span>
            </a>
            <button
              type="button"
              className="resource-tile-menu-btn"
              title="Pin a different model"
              onClick={() => setMenuFor(menuFor === 'model-auto' ? null : 'model-auto')}
            >⋯</button>
            {menuFor === 'model-auto' && (
              <div className="resource-tile-menu" onMouseLeave={() => setMenuFor(null)}>
                <button
                  type="button"
                  onClick={() => { setMenuFor(null); setEditor({ mode: 'add', kind: 'model', label: 'Working Model', url: '' }); }}
                >
                  Pin a specific link
                </button>
              </div>
            )}
          </div>
        ) : (
          <button
            key={slot.kind}
            type="button"
            className="resource-tile resource-tile-empty"
            onClick={() => (slot.kind === 'folder'
              ? setFolderPicker({ link: null })
              : setEditor({ mode: 'add', kind: slot.kind, label: slot.label, url: '' }))}
          >
            <ResourceIcon type={EMPTY_SLOT_ICON[slot.kind]} />
            <span className="resource-tile-label">{slot.label}</span>
            <span className="resource-tile-caption">
              {slot.kind === 'folder' && '＋ Add folder'}
              {slot.kind === 'model' && (autoModel.status === 'loading' ? 'Finding latest…'
                : autoModel.status === 'none' ? 'No locked version yet · ＋ Add link'
                : '＋ Add link')}
            </span>
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

      {folderPicker && (
        <FolderPickerModal
          projectName={projectName}
          onPick={saveFolder}
          onClose={() => setFolderPicker(null)}
        />
      )}

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
