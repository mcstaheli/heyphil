import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './SnapshotReporter.css';
import { TOOLS, JPEG_QUALITY, drawAll, fitWithin, isMeaningful, rectFromDrag } from './snapshotMarkup';
import { getRecentErrors } from './errorBuffer';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';

// Anything with this attribute (the 📸 button and its dialogs) is left out
// of the capture.
const IGNORE_ATTR = 'data-snapshot-ignore';

// Renders the visible part of the page to a canvas - no screen-share
// prompt. html2canvas is loaded on first use so it isn't in the main
// bundle. Known limits: some CSS effects render imperfectly, and images
// from other domains (e.g. Google profile photos) may come out blank.
async function captureViewport() {
  const { default: html2canvas } = await import('html2canvas');
  return html2canvas(document.body, {
    x: window.scrollX,
    y: window.scrollY,
    width: window.innerWidth,
    height: window.innerHeight,
    windowWidth: window.innerWidth,
    windowHeight: window.innerHeight,
    scale: Math.min(window.devicePixelRatio || 1, 2),
    useCORS: true,
    logging: false,
    ignoreElements: (el) => el.hasAttribute && el.hasAttribute(IGNORE_ATTR),
  });
}

// Sent with every report so triage sees what the reporter saw. clientCommit
// is this page's own build (set at build time from Cloudflare Pages /
// Railway, see client/package.json) - it can lag the API's commit.
function reportContext() {
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    userAgent: navigator.userAgent,
    errors: getRecentErrors(),
    clientCommit: process.env.REACT_APP_COMMIT_SHA || null,
  };
}

const HINTS = [
  { id: 'broken', label: 'Something is broken' },
  { id: 'idea', label: 'Idea or request' },
  { id: 'unsure', label: 'Not sure' },
];

function HintPicker({ value, onChange }) {
  return (
    <div className="snap-hints" role="radiogroup" aria-label="What kind of report is this?">
      {HINTS.map((h) => (
        <button
          key={h.id}
          type="button"
          role="radio"
          aria-checked={value === h.id}
          className={`snap-hint-btn ${value === h.id ? 'active' : ''}`}
          onClick={() => onChange(value === h.id ? null : h.id)}
        >
          {h.label}
        </button>
      ))}
    </div>
  );
}

// capture: the html2canvas canvas. Shapes are drawn over it in the
// capture's own pixel coordinates and kept as a list (Undo = drop the last).
function AnnotateModal({ capture, onClose, onSubmit }) {
  const canvasRef = useRef(null);
  const dragRef = useRef(null);   // { start, points } while a pointer is down
  const draftRef = useRef(null);  // the shape being drawn (mirrors `draft`)
  const [shapes, setShapes] = useState([]);
  const [draft, setDraft] = useState(null);
  const [tool, setTool] = useState('box');
  const [hint, setHint] = useState(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { width, height } = capture;

  useEffect(() => {
    const ctx = canvasRef.current && canvasRef.current.getContext('2d');
    if (!ctx) return;
    drawAll(ctx, capture, width, height, draft ? [...shapes, draft] : shapes);
  }, [capture, width, height, shapes, draft]);

  function point(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * width) / rect.width,
      y: ((e.clientY - rect.top) * height) / rect.height,
    };
  }

  function shapeFor(start, end, points) {
    if (tool === 'pen') return { type: 'pen', points };
    if (tool === 'arrow') return { type: 'arrow', x1: start.x, y1: start.y, x2: end.x, y2: end.y };
    return { type: tool, ...rectFromDrag(start, end) };
  }

  function setDraftShape(shape) {
    draftRef.current = shape;
    setDraft(shape);
  }

  function onPointerDown(e) {
    e.preventDefault();
    canvasRef.current.setPointerCapture?.(e.pointerId);
    const p = point(e);
    dragRef.current = { start: p, points: [p] };
    setDraftShape(shapeFor(p, p, [p]));
  }

  function onPointerMove(e) {
    if (!dragRef.current) return;
    const p = point(e);
    dragRef.current.points.push(p);
    setDraftShape(shapeFor(dragRef.current.start, p, dragRef.current.points.slice()));
  }

  // Commit from the ref, not inside a state updater - StrictMode runs
  // updaters twice in development, which added every shape twice.
  function onPointerUp() {
    if (!dragRef.current) return;
    dragRef.current = null;
    const shape = draftRef.current;
    setDraftShape(null);
    if (shape && isMeaningful(shape)) setShapes((prev) => [...prev, shape]);
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      // Flatten capture + shapes, at most 1600px wide, as JPEG. Redacted
      // areas are painted over in the pixels themselves - the unmarked
      // capture is never sent.
      const out = fitWithin(width, height);
      const flat = document.createElement('canvas');
      flat.width = out.width;
      flat.height = out.height;
      const ctx = flat.getContext('2d');
      ctx.scale(out.width / width, out.height / height);
      drawAll(ctx, capture, width, height, shapes);
      await onSubmit({ screenshot: flat.toDataURL('image/jpeg', JPEG_QUALITY), note, reporterHint: hint });
      onClose();
    } catch (err) {
      window.alert(err.message || 'Failed to submit report');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Report a bug or idea</h3>
        </div>
        <div className="modal-body">
          <div className="snap-toolbar" role="toolbar" aria-label="Markup tools">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`snap-tool-btn ${tool === t.id ? 'active' : ''}`}
                aria-pressed={tool === t.id}
                title={t.title || t.label}
                onClick={() => setTool(t.id)}
              >
                <span aria-hidden="true">{t.icon}</span> {t.label}
              </button>
            ))}
            <span className="snap-toolbar-spacer" />
            <button type="button" className="snap-tool-btn" disabled={!shapes.length} onClick={() => setShapes((s) => s.slice(0, -1))}>
              ↶ Undo
            </button>
            <button type="button" className="snap-tool-btn" disabled={!shapes.length} onClick={() => setShapes([])}>
              Clear
            </button>
          </div>
          <div className="snap-canvas-wrap">
            <canvas
              ref={canvasRef}
              width={width}
              height={height}
              className={`snap-draw-canvas tool-${tool}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
          </div>
          <HintPicker value={hint} onChange={setHint} />
          <textarea
            className="snap-note"
            rows={3}
            placeholder="What are you seeing, or what would you like to see?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className="modal-footer">
          <div className="modal-actions">
            <button className="btn-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
            <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit report'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Fallback when the page couldn't be captured: a note-only report.
function TextOnlyModal({ reason, onClose, onSubmit }) {
  const [note, setNote] = useState('');
  const [pageUrl, setPageUrl] = useState(window.location.pathname);
  const [hint, setHint] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!note.trim()) {
      window.alert('Add a note describing what you\'re seeing.');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({ screenshot: null, note, pageUrl, reporterHint: hint });
      onClose();
    } catch (err) {
      window.alert(err.message || 'Failed to submit report');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Report a bug or idea</h3>
        </div>
        <div className="modal-body">
          <p className="snap-hint">
            {reason ? `Couldn't take a screenshot (${reason}) - ` : ''}
            just describe what you're seeing or what you'd like to see.
          </p>
          <HintPicker value={hint} onChange={setHint} />
          <textarea
            className="snap-note"
            rows={4}
            placeholder="What are you seeing, or what would you like to see?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            autoFocus
          />
          <label className="snap-page-label">
            Page
            <input
              className="snap-page-input"
              value={pageUrl}
              onChange={(e) => setPageUrl(e.target.value)}
              placeholder="/labs/board"
            />
          </label>
        </div>
        <div className="modal-footer">
          <div className="modal-actions">
            <button className="btn-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
            <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit report'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SnapshotReporter() {
  const [captured, setCaptured] = useState(null);
  const [capturing, setCapturing] = useState(false);
  const [textOnly, setTextOnly] = useState(null); // null | { reason }

  const handleClick = useCallback(async () => {
    setCapturing(true);
    try {
      setCaptured(await captureViewport());
    } catch (err) {
      setTextOnly({ reason: err && err.message ? err.message : 'capture failed' });
    } finally {
      setCapturing(false);
    }
  }, []);

  async function submitReport({ screenshot, note, pageUrl, reporterHint }) {
    const token = localStorage.getItem('authToken');
    const res = await fetch(`${API_BASE_URL}/api/improvements`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        note,
        screenshot,
        pageUrl: pageUrl || window.location.pathname,
        reporterHint,
        context: reportContext(),
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to submit report');
    }
  }

  // Portaled straight to <body>: other modals in this app (CardModal,
  // OrgCharts, Cashflow, ...) nest inside their own ancestor elements that
  // happen to establish their own stacking context, so a plain in-tree
  // .modal-overlay here can end up painted BEHIND one of those even with a
  // higher z-index. Rendering at the body level sidesteps that, which
  // matters because this button has to work while another dialog is open.
  // The wrapper's data-snapshot-ignore keeps all of it out of the capture.
  return createPortal(
    <div {...{ [IGNORE_ATTR]: '' }}>
      <button
        className="snap-fab"
        onClick={handleClick}
        disabled={capturing}
        title="Report a bug or feature idea"
      >
        {capturing ? '…' : '📸'}
      </button>
      {captured && (
        <AnnotateModal
          capture={captured}
          onClose={() => setCaptured(null)}
          onSubmit={submitReport}
        />
      )}
      {textOnly && (
        <TextOnlyModal
          reason={textOnly.reason}
          onClose={() => setTextOnly(null)}
          onSubmit={submitReport}
        />
      )}
    </div>,
    document.body
  );
}

export default SnapshotReporter;
