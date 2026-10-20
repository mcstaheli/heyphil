// The zoning envelope: setbacks by edge (front, side, rear) and the
// stepped-back line upper floors keep to. A site's edges are the sides
// of its boundary ring, numbered from 1 in drawing order. The front is
// the edge picked (frontEdge) or, by default, the longest; a corner lot
// can have a second front (frontEdge2); the rear is the edge facing most
// directly away from the front; the rest are sides.
import buffer from '@turf/buffer';
import difference from '@turf/difference';
import { featureCollection } from '@turf/helpers';
import { makeProjection } from './geometry';

const COMPASS = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];

const openRing = (ring) => {
  const n = ring.length;
  return n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1] ? ring.slice(0, -1) : ring;
};

// Each edge of the boundary's outer ring: its ends ([lng, lat]), length,
// which way it faces (outward), role and setback.
export function siteEdges(boundary, s) {
  const ring = openRing(boundary.coordinates[0]);
  const n = ring.length;
  if (n < 3) return [];
  const proj = makeProjection(ring);
  const pts = ring.map(proj.toFeet);
  let twice = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % n];
    twice += x0 * y1 - x1 * y0;
  }
  const ccw = twice > 0;
  const edges = pts.map((p, i) => {
    const q = pts[(i + 1) % n];
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const len = Math.hypot(dx, dy) || 1;
    // Outward: right of travel on a counter-clockwise ring.
    const normal = ccw ? [dy / len, -dx / len] : [-dy / len, dx / len];
    const deg = (Math.atan2(normal[1], normal[0]) * 180) / Math.PI;
    const facing = COMPASS[((Math.round(deg / 45) % 8) + 8) % 8];
    const mid = proj.toLatLng([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]);
    return { index: i + 1, a: ring[i], b: ring[(i + 1) % n], lengthFt: len, normal, facing, mid, role: 'side', setback: s.setback };
  });
  if (s.setbackMode !== 1) return edges.map((e) => ({ ...e, role: 'all' }));

  const pick = (k) => (Number.isInteger(k) && k >= 1 && k <= n ? k - 1 : -1);
  let front = pick(s.frontEdge);
  if (front < 0) front = edges.reduce((bi, e, i) => (e.lengthFt > edges[bi].lengthFt ? i : bi), 0);
  const front2 = pick(s.frontEdge2) === front ? -1 : pick(s.frontEdge2);
  const fn = edges[front].normal;
  let rear = -1;
  let bestDot = -0.5; // only an edge facing broadly away is a rear
  edges.forEach((e, i) => {
    if (i === front || i === front2) return;
    const dot = e.normal[0] * fn[0] + e.normal[1] * fn[1];
    if (dot < bestDot) { bestDot = dot; rear = i; }
  });
  return edges.map((e, i) => {
    const role = i === front || i === front2 ? 'front' : i === rear ? 'rear' : 'side';
    return { ...e, role, setback: role === 'front' ? s.frontSetback : role === 'rear' ? s.rearSetback : s.setback };
  });
}

const toFeature = (geometry) => ({ type: 'Feature', properties: {}, geometry });

// The site inside its setbacks (plus extra, for a stepback), as a
// Feature, or null when nothing is left. Points closer to an edge than
// its setback are taken out: the site less a band along each edge.
// Holes in the boundary (an excluded parcel) keep holeSetback from their
// edges, as in the one-setback case.
export function insetByEdges(boundary, edges, extra = 0, holeSetback = 0) {
  const site = toFeature(boundary);
  const ds = edges.map((e) => Math.max(0, (e.setback || 0) + extra));
  const holeD = Math.max(0, holeSetback + extra);
  if (!ds.some((d) => d > 0) && !holeD) return site;
  // One setback all round: an ordinary inward buffer (also keeps holes).
  if (ds.every((d) => Math.abs(d - ds[0]) < 1e-9) && (boundary.coordinates.length < 2 || Math.abs(holeD - ds[0]) < 1e-9)) {
    const res = buffer(site, -ds[0], { units: 'feet' });
    return res && res.geometry && res.geometry.coordinates.length ? res : null;
  }
  const bands = edges
    .map((e, i) => (ds[i] > 0 ? buffer(toFeature({ type: 'LineString', coordinates: [e.a, e.b] }), ds[i], { units: 'feet' }) : null))
    .filter((b) => b && b.geometry);
  if (holeD > 0) {
    for (const hole of boundary.coordinates.slice(1)) bands.push(buffer(toFeature({ type: 'LineString', coordinates: hole }), holeD, { units: 'feet' }));
  }
  const res = difference(featureCollection([site, ...bands]));
  return res && res.geometry && res.geometry.coordinates.length ? res : null;
}

// The setback of the edge nearest a point (feet, in proj's frame), for
// an entry's checks; fallback when there are no edges.
export function setbackNear(edges, proj, pt, fallback = 0) {
  let best = null;
  for (const e of edges) {
    const [ax, ay] = proj.toFeet(e.a);
    const [bx, by] = proj.toFeet(e.b);
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((pt[0] - ax) * dx + (pt[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(pt[0] - ax - t * dx, pt[1] - ay - t * dy);
    if (!best || d < best.d) best = { d, setback: e.setback || 0 };
  }
  return best ? best.setback : fallback;
}
