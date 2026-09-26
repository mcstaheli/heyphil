import React, { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './SnapshotReporter.css';

const API_BASE_URL = process.env.REACT_APP_API_URL || '';

// Captures a single frame of the current tab via the browser's own Screen
// Capture API - no image-rendering library needed. `preferCurrentTab` is a
// Chrome-only hint that skips straight to "this tab" instead of showing the
// full screen/window/tab picker; browsers that don't recognize it just
// ignore it and fall back to the normal picker.
async function captureScreen() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: 'browser' },
    preferCurrentTab: true,
    audio: false,
  });
  const video = document.createElement('video');
  video.srcObject = stream;
  await video.play();
  // One frame in, the video element has real dimensions to read.
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  stream.getTracks().forEach((t) => t.stop());
  return canvas.toDataURL('image/png');
}

function AnnotateModal({ imageDataUrl, onClose, onSubmit }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [dims, setDims] = useState(null);

  const handleImageLoad = (e) => {
    const { naturalWidth, naturalHeight } = e.target;
    setDims({ width: naturalWidth, height: naturalHeight });
  };

  function pointFromEvent(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function startDraw(e) {
    drawingRef.current = true;
    lastPointRef.current = pointFromEvent(e);
  }

  function moveDraw(e) {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const point = pointFromEvent(e);
    ctx.strokeStyle = '#ff3b30';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPointRef.current = point;
  }

  function endDraw() {
    drawingRef.current = false;
  }

  function clearDrawing() {
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      // Flatten the screenshot and the annotation overlay into one image.
      const composite = document.createElement('canvas');
      composite.width = dims.width;
      composite.height = dims.height;
      const ctx = composite.getContext('2d');
      ctx.drawImage(imgRef.current, 0, 0, dims.width, dims.height);
      ctx.drawImage(canvasRef.current, 0, 0, dims.width, dims.height);
      await onSubmit({ screenshot: composite.toDataURL('image/png'), note });
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
        <h3>Report a bug or idea</h3>
        <p className="snap-hint">Click and drag on the screenshot to circle or mark up what you're pointing at.</p>
        <div className="snap-canvas-wrap">
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <img ref={imgRef} src={imageDataUrl} onLoad={handleImageLoad} className="snap-base-image" alt="Screenshot" />
          {dims && (
            <canvas
              ref={canvasRef}
              width={dims.width}
              height={dims.height}
              className="snap-draw-canvas"
              onMouseDown={startDraw}
              onMouseMove={moveDraw}
              onMouseUp={endDraw}
              onMouseLeave={endDraw}
            />
          )}
        </div>
        <div className="snap-toolbar">
          <button className="btn-secondary" onClick={clearDrawing} type="button">Clear markup</button>
        </div>
        <textarea
          className="snap-note"
          rows={3}
          placeholder="What are you seeing, or what would you like to see?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="imp-modal-actions">
          <button className="btn-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={submitting || !dims}>
            {submitting ? 'Submitting…' : 'Submit report'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SnapshotReporter() {
  const [captured, setCaptured] = useState(null);
  const [capturing, setCapturing] = useState(false);

  const handleClick = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      window.alert("Screenshot capture isn't supported in this browser.");
      return;
    }
    setCapturing(true);
    try {
      const dataUrl = await captureScreen();
      setCaptured(dataUrl);
    } catch (err) {
      // The user cancelling the share picker is the common case here -
      // not an error worth surfacing.
      if (err.name !== 'NotAllowedError') {
        window.alert(`Couldn't capture the screen: ${err.message}`);
      }
    } finally {
      setCapturing(false);
    }
  }, []);

  async function submitReport({ screenshot, note }) {
    const token = localStorage.getItem('authToken');
    const res = await fetch(`${API_BASE_URL}/api/improvements`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ note, screenshot, pageUrl: window.location.pathname }),
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
  // higher z-index - a fixed-position element's z-index only competes
  // within its own stacking context, not globally. Rendering at the body
  // level sidesteps that entirely, which matters here specifically because
  // the whole point of this button is to still work while some other
  // dialog is already open.
  return createPortal(
    <>
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
          imageDataUrl={captured}
          onClose={() => setCaptured(null)}
          onSubmit={submitReport}
        />
      )}
    </>,
    document.body
  );
}

export default SnapshotReporter;
