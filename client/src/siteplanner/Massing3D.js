import React, { useEffect, useMemo, useRef, useState } from 'react';
import { makeProjection } from './geometry';

// A 3D massing view of a scheme: the site, its parking and drives flat on
// the ground, and every building extruded to its height. Drawn on a canvas
// with a simple axonometric projection; drag sideways to turn it.

const TILT = 0.55; // how flat the ground looks
const TREE_HEIGHT = 24; // ft to the top of a crown
const CROWN = 12; // ft, crown radius
const LIFT = 0.9; // how tall a foot of height looks
const COLORS = {
  ground: '#e7f0dc', site: '#9ccc65', parking: '#9ca3af', drive: '#6b7280', lot: '#bbf7d0', yard: '#4b5563',
  top: '#a5b4fc', side1: '#6366f1', side2: '#4f46e5', garageTop: '#c4b5fd', edge: 'rgba(30, 27, 75, 0.55)',
  envelope: 'rgba(234, 88, 12, 0.85)',
  tree: '#16a34a', treeDark: '#166534', trunk: '#78350f', park: '#86efac',
};

function collect(boundary, results) {
  const proj = makeProjection(boundary.coordinates[0]);
  const toFeet = ([lat, lng]) => proj.toFeet([lng, lat]);
  const flat = [];
  const masses = [];
  const add = (g, garageHeight) => {
    if (!g) return;
    (g.drives || []).forEach((rings) => flat.push({ ring: rings[0].map(toFeet), color: COLORS.drive }));
    (g.parking || []).forEach((p) => flat.push({ ring: p.outline.map(toFeet), color: COLORS.parking }));
    (g.lots || []).forEach((r) => flat.push({ ring: r.map(toFeet), color: COLORS.lot }));
    (g.yards || []).forEach((r) => flat.push({ ring: r.map(toFeet), color: COLORS.yard }));
    (g.truckCourts || []).forEach((r) => flat.push({ ring: r.map(toFeet), color: COLORS.parking }));
    // A stepped-back building is two masses: the full footprint up to the
    // stepback, the smaller upper plate(s) from there to the roof.
    const steps = new Map((g.stepbacks || []).map((st) => [st.index, st]));
    (g.buildings || []).forEach((r, i) => {
      const height = (g.buildingHeights || [])[i] || 30;
      const st = steps.get(i);
      if (!st || st.atFt >= height) {
        masses.push({ ring: r.map(toFeet), base: 0, height });
        return;
      }
      const footprint = r.map(toFeet);
      masses.push({ ring: footprint, base: 0, height: st.atFt });
      // Sorted with its building, so it draws over its own lower part.
      st.upper.forEach((ring) => masses.push({ ring: ring.map(toFeet), base: st.atFt, height, sortRing: footprint }));
    });
    if (g.garage) g.garage.outline.forEach((r) => masses.push({ ring: r.map(toFeet), base: 0, height: garageHeight || 40, garage: true }));
  };
  add(results.geometry, results.metrics?.heightFt);
  (results.spaces || []).forEach((sp) => add(sp.result?.geometry, sp.result?.metrics?.heightFt));
  const site = boundary.coordinates[0].slice(0, -1).map(proj.toFeet);
  // The zoning envelope, as wireframe boxes: the setback line to the
  // stepback (or the height limit), the stepped line above it.
  const env = results.geometry?.envelope;
  const envelope = [];
  if (env && env.topFt) {
    const lowTop = env.upper && env.stepFt < env.topFt ? env.stepFt : env.topFt;
    env.lower.forEach((r) => envelope.push({ ring: r.map(toFeet), base: 0, height: lowTop }));
    if (env.upper && env.stepFt < env.topFt) env.upper.forEach((r) => envelope.push({ ring: r.map(toFeet), base: env.stepFt, height: env.topFt }));
  }
  // Parks on the ground; trees as a trunk and a round crown, sorted with
  // the buildings so the near ones hide what's behind.
  (results.spaces || []).forEach((sp) => {
    if (sp.kind === 'green' && sp.polygon) flat.push({ ring: sp.polygon.coordinates[0].slice(0, -1).map(proj.toFeet), color: COLORS.park });
  });
  (results.trees || []).forEach((t) => masses.push({ tree: true, ring: [toFeet(t)], base: 0, height: TREE_HEIGHT }));
  return { site, flat, masses, envelope };
}

function Massing3D({ boundary, result, onClose }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [angle, setAngle] = useState(-35);
  const [showEnvelope, setShowEnvelope] = useState(true);
  const dragRef = useRef(null);
  const [size, setSize] = useState({ w: 800, h: 520 });
  // Projected once per scheme; turning only changes the view transform.
  const scene = useMemo(() => (boundary && result?.geometry ? collect(boundary, result) : null), [boundary, result]);
  // The overlay closes only on a click that starts and ends on it, not
  // when a drag that began in the view is released over it.
  const downOnOverlay = useRef(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: Math.max(320, Math.min(640, el.clientWidth * 0.62)) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !scene) return;
    const t = (angle * Math.PI) / 180;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const view = ([x, y], z = 0) => {
      const rx = x * c - y * s;
      const ry = x * s + y * c;
      return [rx, -ry * TILT - z * LIFT, ry];
    };
    // Fit everything (ground and roofs) to the canvas.
    const all = [
      ...scene.site.map((p) => view(p)),
      ...[...scene.masses, ...(showEnvelope ? scene.envelope : [])].flatMap((m) => m.ring.map((p) => view(p, m.height))),
    ];
    const xs = all.map((p) => p[0]);
    const ys = all.map((p) => p[1]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const pad = 24;
    const k = Math.min((size.w - 2 * pad) / (maxX - minX || 1), (size.h - 2 * pad) / (maxY - minY || 1));
    const ox = pad + ((size.w - 2 * pad) - (maxX - minX) * k) / 2 - minX * k;
    const oy = pad + ((size.h - 2 * pad) - (maxY - minY) * k) / 2 - minY * k;
    const screen = (p, z) => {
      const [x, y] = view(p, z);
      return [ox + x * k, oy + y * k];
    };
    const poly = (pts, fill, stroke) => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
    };

    poly(scene.site.map((p) => screen(p, 0)), COLORS.ground, COLORS.site);
    scene.flat.forEach((f) => poly(f.ring.map((p) => screen(p, 0)), f.color, null));

    // Far buildings first; within one, side faces far to near, then the roof.
    const depth = (m) => {
      const ring = m.sortRing || m.ring;
      return ring.reduce((sum, p) => sum + view(p)[2], 0) / ring.length;
    };
    [...scene.masses].sort((a, b) => depth(b) - depth(a) || a.base - b.base).forEach((m) => {
      if (m.tree) {
        const [x0, y0] = screen(m.ring[0], 0);
        const [x1, y1] = screen(m.ring[0], m.height - CROWN);
        ctx.strokeStyle = COLORS.trunk;
        ctx.lineWidth = Math.max(1, 1.5 * k);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        const r = Math.max(2, CROWN * k);
        ctx.beginPath();
        ctx.ellipse(x1, y1, r, r * 0.9, 0, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.tree;
        ctx.fill();
        ctx.strokeStyle = COLORS.treeDark;
        ctx.lineWidth = 1;
        ctx.stroke();
        return;
      }
      const faces = m.ring.map((p, i) => {
        const q = m.ring[(i + 1) % m.ring.length];
        return { p, q, d: (view(p)[2] + view(q)[2]) / 2, i };
      }).sort((a, b) => b.d - a.d);
      faces.forEach(({ p, q, i }) => {
        poly([screen(p, m.base), screen(q, m.base), screen(q, m.height), screen(p, m.height)], i % 2 ? COLORS.side1 : COLORS.side2, COLORS.edge);
      });
      poly(m.ring.map((p) => screen(p, m.height)), m.garage ? COLORS.garageTop : COLORS.top, COLORS.edge);
    });

    // The envelope on top, as dashed outlines: base, top and corner posts.
    if (showEnvelope) {
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = COLORS.envelope;
      ctx.lineWidth = 1.25;
      scene.envelope.forEach((m) => {
        for (const z of [m.base, m.height]) {
          ctx.beginPath();
          m.ring.forEach((p, i) => { const [x, y] = screen(p, z); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
          ctx.closePath();
          ctx.stroke();
        }
        m.ring.forEach((p) => {
          ctx.beginPath();
          const [x0, y0] = screen(p, m.base);
          const [x1, y1] = screen(p, m.height);
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        });
      });
      ctx.restore();
    }
  }, [scene, angle, size, showEnvelope]);

  const onDown = (e) => { dragRef.current = { x: e.clientX, angle }; };
  const onMove = (e) => {
    if (!dragRef.current) return;
    setAngle(dragRef.current.angle + (e.clientX - dragRef.current.x) * 0.4);
  };
  const onUp = () => { dragRef.current = null; };

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => { downOnOverlay.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (downOnOverlay.current && e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal-content siteplan-3d-modal">
        <div className="modal-header"><h2>3D massing</h2></div>
        <div className="modal-body">
          <div
            ref={wrapRef}
            className="siteplan-3d-wrap"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={onUp}
          >
            <canvas ref={canvasRef} aria-label="3D massing of the scheme" />
          </div>
          <div className="siteplan-3d-controls">
            <label>
              Turn
              <input type="range" min={-180} max={180} value={Math.round(((angle + 180) % 360 + 360) % 360 - 180)} onChange={(e) => setAngle(Number(e.target.value))} />
            </label>
            {scene?.envelope.length > 0 && (
              <label className="siteplan-small">
                <input type="checkbox" checked={showEnvelope} onChange={(e) => setShowEnvelope(e.target.checked)} /> Zoning envelope
              </label>
            )}
            <span className="siteplan-muted siteplan-small">
              Drag the view to turn it. Buildings are drawn at their full height, stepped back where the zoning asks.
              {scene && !scene.envelope.length ? ' Set a max height under Zoning to see the envelope.' : ' Orange dashes: the setbacks up to the height limit.'}
            </span>
          </div>
        </div>
        <div className="modal-footer siteplan-modal-footer">
          <div className="modal-actions"><button type="button" className="btn-secondary" onClick={onClose}>Close</button></div>
        </div>
      </div>
    </div>
  );
}

export default Massing3D;
