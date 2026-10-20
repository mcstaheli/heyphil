// Parking for the Site Planner: stall modules (90° two-way, 60° and 45°
// one-way), double-loaded bays with landscape islands, the best
// orientation for an area, ADA counts and stall types. Works in the
// solver's rotated frame: rows run along u, bays stack along v.
import { bandIntervals, candidateAngles, rotateRings } from './geometry';

const DEG = Math.PI / 180;

// The dimensions of one double-loaded bay at a stall angle.
//   proj    - how far a stall reaches back from the aisle
//   pitch   - stall-to-stall spacing along the aisle
//   endLoss - extra length an angled row needs at its end
//   depth   - the whole bay, stall + aisle + stall
// A compact share narrows the average stall, so more fit along a row.
export function parkingModule(s, stallAngle = s.stallAngle) {
  const angle = [45, 60, 90].includes(stallAngle) ? stallAngle : 90;
  const W = s.stallWidth;
  const L = s.stallDepth;
  const c = Math.min(1, Math.max(0, (s.compactPct || 0) / 100));
  const widthFactor = (1 - c) + c * Math.min(1, (s.compactWidth || W) / W);
  if (angle === 90) {
    return { angle, proj: L, pitch: W * widthFactor, endLoss: 0, aisle: s.aisleWidth, depth: 2 * L + s.aisleWidth, oneWay: false };
  }
  const t = angle * DEG;
  const proj = L * Math.sin(t) + W * Math.cos(t);
  const aisle = angle === 60 ? s.aisle60 : s.aisle45;
  return {
    angle,
    proj,
    pitch: (W / Math.sin(t)) * widthFactor,
    // Room at the row's start for the first stall's lean, so stripes and
    // stalls stay inside the row.
    endLoss: proj / Math.tan(t),
    aisle,
    depth: 2 * proj + aisle,
    oneWay: true,
  };
}

// Which of a side's n stall slots are landscape islands: one after
// every `islandEvery` stalls, and one at each end if endIslands is on.
export function islandSlots(n, s) {
  const out = new Set();
  if (s.islandEvery > 0) {
    for (let i = s.islandEvery; i < n; i += s.islandEvery + 1) out.add(i);
  }
  if (s.endIslands && n > 2) {
    out.add(0);
    out.add(n - 1);
  }
  return out;
}

// One-way bays alternate direction from one bay to the next, so traffic
// snakes up one aisle and back down the next. +1 flows toward +u.
export function bayDirection(v0, mod) {
  if (!mod.oneWay) return 0;
  const k = Math.round(v0 / mod.depth);
  return ((k % 2) + 2) % 2 === 0 ? 1 : -1;
}

// The rows of one bay starting at v0.
export function layBay(rings, v0, s, mod) {
  const dir = bayDirection(v0, mod);
  const rows = [];
  let stalls = 0;
  for (const [a, b] of bandIntervals(rings, v0, v0 + mod.depth, 2 * mod.pitch + mod.endLoss)) {
    const n = Math.floor((b - a - mod.endLoss) / mod.pitch);
    if (n < 1) continue;
    const islands = islandSlots(n, s);
    const perSide = n - islands.size;
    if (perSide < 1) continue;
    rows.push({ u0: a, u1: a + mod.endLoss + n * mod.pitch, v0, v1: v0 + mod.depth, n, islands: [...islands], perSide, mod, dir });
    stalls += 2 * perSide;
  }
  return { rows, stalls };
}

// Bays stacked across a shape (already rotated), trying a few starting
// offsets; the one with the most stalls.
export function fillBays(rings, s, mod) {
  const vs = rings.flat().map((p) => p[1]);
  const vmin = Math.min(...vs);
  const vmax = Math.max(...vs);
  let best = { rows: [], stalls: 0 };
  for (const offset of [0, mod.depth / 3, (2 * mod.depth) / 3]) {
    const rows = [];
    let stalls = 0;
    for (let v = vmin + offset; v + mod.depth <= vmax; v += mod.depth) {
      const bay = layBay(rings, v, s, mod);
      rows.push(...bay.rows);
      stalls += bay.stalls;
    }
    if (stalls > best.stalls) best = { rows, stalls };
  }
  return best;
}

// The orientation that fits the most stalls in an area (shape in local
// feet, unrotated): every 5°, plus the area's own edge directions; or
// just `fixedDeg` when given. keep(row, angle) can drop rows (e.g. ones
// that can't reach a drive). Returns { angle (radians), rows, stalls }.
export function bestOrientation(rings, s, mod, { fixedDeg = null, keep = null, stepDeg = 5, extraAngles = [] } = {}) {
  const steps = Math.round(180 / stepDeg);
  const angles = fixedDeg !== null && Number.isFinite(fixedDeg)
    ? [fixedDeg * DEG]
    : [...Array.from({ length: steps }, (_, i) => i * stepDeg * DEG), ...candidateAngles(rings, 4), ...extraAngles];
  let best = { angle: angles[0], rows: [], stalls: 0 };
  for (const angle of angles) {
    const rotated = rotateRings(rings, angle);
    let { rows, stalls } = fillBays(rotated, s, mod);
    if (keep) {
      rows = rows.filter((r) => keep(r, angle));
      stalls = rows.reduce((sum, r) => sum + 2 * r.perSide, 0);
    }
    if (stalls > best.stalls) best = { angle, rows, stalls };
  }
  best.rows.forEach((r) => { r.angle = best.angle; });
  return best;
}

// ADA Standards 208.2: accessible stalls required for a lot's total.
export function adaRequired(total) {
  if (total <= 0) return 0;
  const table = [[25, 1], [50, 2], [75, 3], [100, 4], [150, 5], [200, 6], [300, 7], [400, 8], [500, 9]];
  for (const [max, n] of table) if (total <= max) return n;
  if (total <= 1000) return Math.ceil(total * 0.02);
  return 20 + Math.ceil((total - 1000) / 100);
}

// An accessible stall plus its access aisle takes about one and a half
// standard stalls, so each costs half a stall.
export function netStalls(raw) {
  return raw - Math.ceil(adaRequired(raw) * 0.5);
}

// Stall counts by type for a lot of `raw` laid-out stalls.
export function stallTypes(raw, s) {
  const total = netStalls(raw);
  const ada = adaRequired(raw);
  const van = Math.ceil(ada / 6);
  const compact = Math.round((total * (s.compactPct || 0)) / 100);
  return {
    total,
    ada,
    van,
    compact,
    standard: Math.max(0, total - ada - compact),
    ev: Math.ceil((total * (s.evPct || 0)) / 100),
  };
}

// Shortest distance from a point to any edge of the rings.
export function distanceToRings(rings, [x, y]) {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[(i + 1) % ring.length];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
    }
  }
  return best;
}

// Where a row's aisle meets the drive (rings in the same rotated frame,
// within half a bay): { in, out } for a one-way row (in = the end traffic
// enters by), and either end for a two-way row.
export function rowEnds(row, driveEdgeRings) {
  const vmid = row.v0 + row.mod.proj + row.mod.aisle / 2;
  const tol = row.mod.depth / 2;
  const a = distanceToRings(driveEdgeRings, [row.u0, vmid]) <= tol;
  const b = distanceToRings(driveEdgeRings, [row.u1, vmid]) <= tol;
  if (!row.dir) return { in: a || b, out: a || b, a, b };
  return row.dir > 0 ? { in: a, out: b, a, b } : { in: b, out: a, a, b };
}

// A two-way row needs one end on a drive; a one-way row needs both - a
// way in and a way out.
export function rowReachesDrive(row, driveEdgeRings) {
  const ends = rowEnds(row, driveEdgeRings);
  return row.dir ? ends.in && ends.out : ends.in;
}

// A row's aisle ends (rotated frame), for routing from the one(s) that
// don't reach a drive.
export function rowEndPoints(row) {
  const vmid = row.v0 + row.mod.proj + row.mod.aisle / 2;
  return { a: [row.u0, vmid], b: [row.u1, vmid] };
}

// Time-of-day shares of each use's peak parking (weekday day, weekday
// evening, weekend day, weekend evening) - typical patterns, for an
// estimate of how much mixed uses can share.
export const SHARED_PARKING_FACTORS = {
  residential: [0.6, 0.95, 0.7, 0.95],
  retail: [0.95, 0.7, 1.0, 0.65],
  hotel: [0.75, 1.0, 0.75, 1.0],
  industrial: [1.0, 0.15, 0.1, 0.05],
};

export const SHARED_PARKING_CATEGORY = {
  'mf-garden': 'residential',
  'mf-podium': 'residential',
  retail: 'retail',
  hotel: 'hotel',
  industrial: 'industrial',
};

// parts: [{ typeId, required }]. Uses with a time-of-day pattern share;
// anything else (homes' own garages) keeps its full requirement.
// Returns { required, raw, shared } - shared is false when fewer than two
// sharing uses are present.
export function sharedRequirement(parts) {
  const raw = parts.reduce((sum, p) => sum + p.required, 0);
  const byCat = {};
  let fixed = 0;
  for (const p of parts) {
    const cat = SHARED_PARKING_CATEGORY[p.typeId];
    if (cat && p.required > 0) byCat[cat] = (byCat[cat] || 0) + p.required;
    else fixed += p.required;
  }
  const cats = Object.keys(byCat);
  if (cats.length < 2) return { required: raw, raw, shared: false };
  let peak = 0;
  for (let period = 0; period < 4; period++) {
    peak = Math.max(peak, cats.reduce((sum, c) => sum + byCat[c] * SHARED_PARKING_FACTORS[c][period], 0));
  }
  return { required: Math.ceil(peak - 1e-9) + fixed, raw, shared: true };
}

// ---- Drive aisles drawn by hand ------------------------------------------

export const MIN_TWO_WAY_WIDTH = 20;
export const MIN_ONE_WAY_WIDTH = 12;

// Problems with one drawn aisle (points in local feet):
//   turn  - a corner too sharp for the turning radius: the largest curve
//           that fits between the neighbouring straights is too small
//   width - narrower than two-way (or one-way) traffic needs
//   dead  - an end that meets no other drive, no perimeter drive and no
//           street (the boundary)
// connectsTo: rings (feet) an end may meet - other aisles, the perimeter
// drive's edge, the site boundary.
// fromBay: the aisle starts at a bay's end by design (routed, or kept
// from routing), so its start isn't a dead end.
export function analyzeAisle(pts, { width, twoWay, turnRadius, connectsTo, fromBay = false }) {
  const issues = [];
  for (let i = 1; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const [cx, cy] = pts[i + 1];
    const l1 = Math.hypot(bx - ax, by - ay);
    const l2 = Math.hypot(cx - bx, cy - by);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    const cos = ((bx - ax) * (cx - bx) + (by - ay) * (cy - by)) / (l1 * l2);
    const turn = Math.acos(Math.max(-1, Math.min(1, cos)));
    if (turn < (5 * Math.PI) / 180) continue;
    // The curve's tangents take r·tan(turn/2) from each straight; each
    // straight can give half its length to this corner. That's the curve
    // along the centre line; the inside edge is half the width tighter.
    const centre = Math.min(l1, l2) / 2 / Math.tan(turn / 2);
    const inside = centre - width / 2;
    if (inside + 1e-6 < turnRadius) {
      issues.push({
        kind: 'turn',
        at: [bx, by],
        text: `Turn too tight: inside radius ${Math.max(0, Math.round(inside))} ft, needs ${Math.round(turnRadius)} ft`,
      });
    }
  }
  const minWidth = twoWay ? MIN_TWO_WAY_WIDTH : MIN_ONE_WAY_WIDTH;
  if (width < minWidth) {
    issues.push({ kind: 'width', at: pts[Math.floor(pts.length / 2)], text: `${Math.round(width)} ft is narrow for ${twoWay ? 'two-way' : 'one-way'} traffic (${minWidth} ft min)` });
  }
  for (const end of fromBay ? [pts[pts.length - 1]] : [pts[0], pts[pts.length - 1]]) {
    if (!connectsTo.length || distanceToRings(connectsTo, end) > width) {
      issues.push({ kind: 'dead', at: end, text: 'Dead end: connect it to another drive or the street, or add a turnaround' });
    }
  }
  return issues;
}
