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

// The rows of one bay starting at v0.
export function layBay(rings, v0, s, mod) {
  const rows = [];
  let stalls = 0;
  for (const [a, b] of bandIntervals(rings, v0, v0 + mod.depth, 2 * mod.pitch + mod.endLoss)) {
    const n = Math.floor((b - a - mod.endLoss) / mod.pitch);
    if (n < 1) continue;
    const islands = islandSlots(n, s);
    const perSide = n - islands.size;
    if (perSide < 1) continue;
    rows.push({ u0: a, u1: a + mod.endLoss + n * mod.pitch, v0, v1: v0 + mod.depth, n, islands: [...islands], perSide, mod });
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

// A row reaches the drive if either end of its aisle comes to the drive's
// edge (rings in the same rotated frame), within half a bay.
export function rowReachesDrive(row, driveEdgeRings) {
  const vmid = row.v0 + row.mod.proj + row.mod.aisle / 2;
  const tol = row.mod.depth / 2;
  return distanceToRings(driveEdgeRings, [row.u0, vmid]) <= tol || distanceToRings(driveEdgeRings, [row.u1, vmid]) <= tol;
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
