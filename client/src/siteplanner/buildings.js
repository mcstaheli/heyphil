// Building configurations and unit layouts for the Site Planner's
// multifamily types. A building is a set of wings - double-loaded bars,
// a corridor down the middle and units both sides - arranged as a bar,
// an L, a U, a courtyard, a double courtyard, or a ring wrapped around a
// parking garage. Each wing's floor plate is laid out unit by unit: unit
// widths come from each type's size and the unit depth, the mix is kept
// by always placing the type furthest behind its share, and stairs and
// elevators take their slots along the corridor. Works in the solver's
// rotated frame (u along, v across).
import { bandIntervals } from './geometry';

export const SHAPES = [
  { id: 0, key: 'bars', label: 'Bars' },
  { id: 1, key: 'garden', label: 'Garden walk-ups' },
  { id: 2, key: 'L', label: 'L-shape' },
  { id: 3, key: 'U', label: 'U-shape' },
  { id: 4, key: 'courtyard', label: 'Courtyard' },
  { id: 5, key: 'double', label: 'Double courtyard' },
  { id: 6, key: 'wrap', label: 'Wrap around a garage' },
];
export const shapeKey = (id) => (SHAPES.find((x) => x.id === id) || SHAPES[0]).key;

// A shape that doesn't fit falls back to the next simpler one.
const FALLBACK = { wrap: 'courtyard', double: 'courtyard', courtyard: 'U', U: 'L', L: 'bars' };

const STAIR_LENGTH = 18; // along the corridor
const ELEVATOR_LENGTH = 16;
const MIN_UNIT_DEPTH = 18;

// The rectangles (wings) a shape is made of, inside an outer rectangle,
// plus what sits in the middle (a courtyard or a garage). axis: which
// way the wing's corridor runs. cornerStart / cornerEnd: the wing's ends
// are corners where it meets another wing. joinStart / joinEnd: the
// wing's end runs into another wing's corner, whose stair serves it.
export function shapeWings(shape, r, D) {
  const { u0, u1, v0, v1 } = r;
  const um = (u0 + u1) / 2;
  const along = (a) => ({ ...a, axis: 'u' });
  const across = (a) => ({ ...a, axis: 'v' });
  switch (shape) {
    case 'L':
      return {
        wings: [
          along({ u0, u1, v0, v1: v0 + D, cornerStart: true }),
          across({ u0, u1: u0 + D, v0: v0 + D, v1, joinStart: true }),
        ],
      };
    case 'U':
      return {
        wings: [
          along({ u0, u1, v0, v1: v0 + D, cornerStart: true, cornerEnd: true }),
          across({ u0, u1: u0 + D, v0: v0 + D, v1, joinStart: true }),
          across({ u0: u1 - D, u1, v0: v0 + D, v1, joinStart: true }),
        ],
        middle: { u0: u0 + D, u1: u1 - D, v0: v0 + D, v1 },
      };
    case 'courtyard':
    case 'wrap':
      return {
        wings: [
          along({ u0, u1, v0, v1: v0 + D, cornerStart: true, cornerEnd: true }),
          along({ u0, u1, v0: v1 - D, v1, cornerStart: true, cornerEnd: true }),
          across({ u0, u1: u0 + D, v0: v0 + D, v1: v1 - D, joinStart: true, joinEnd: true }),
          across({ u0: u1 - D, u1, v0: v0 + D, v1: v1 - D, joinStart: true, joinEnd: true }),
        ],
        middle: { u0: u0 + D, u1: u1 - D, v0: v0 + D, v1: v1 - D },
      };
    case 'double':
      return {
        wings: [
          along({ u0, u1, v0, v1: v0 + D, cornerStart: true, cornerEnd: true }),
          along({ u0, u1, v0: v1 - D, v1, cornerStart: true, cornerEnd: true }),
          across({ u0, u1: u0 + D, v0: v0 + D, v1: v1 - D, joinStart: true, joinEnd: true }),
          across({ u0: u1 - D, u1, v0: v0 + D, v1: v1 - D, joinStart: true, joinEnd: true }),
          across({ u0: um - D / 2, u1: um + D / 2, v0: v0 + D, v1: v1 - D }),
        ],
        middle: { u0: u0 + D, u1: u1 - D, v0: v0 + D, v1: v1 - D },
      };
    default:
      return { wings: [along({ u0, u1, v0, v1 })] };
  }
}

// The smallest outer size a shape needs (along, across).
export function shapeMinimum(shape, D, courtyardMin) {
  switch (shape) {
    case 'L': return [2 * D, 2 * D];
    case 'U': return [2 * D + courtyardMin, D + courtyardMin];
    case 'courtyard':
    case 'wrap': return [2 * D + courtyardMin, 2 * D + courtyardMin];
    case 'double': return [3 * D + 2 * courtyardMin, 2 * D + courtyardMin];
    default: return [50, D];
  }
}

// The largest axis-aligned rectangle (rotated frame) inside the shape,
// between the minimum and maximum sizes; null if none fits.
export function largestRect(rings, { minW, minH, maxW, maxH, step }) {
  const vs = rings.flat().map((p) => p[1]);
  const vmin = Math.min(...vs);
  const vmax = Math.max(...vs);
  const st = step || Math.max(8, (vmax - vmin) / 40);
  let best = null;
  for (let v0 = vmin; v0 + minH <= vmax + 1e-6; v0 += st) {
    for (let h = minH; h <= maxH + 1e-6 && v0 + h <= vmax + 1e-6; h += st) {
      for (const [a, b] of bandIntervals(rings, v0, v0 + h, minW)) {
        const w = Math.min(b - a, maxW);
        const area = w * h;
        if (!best || area > best.area) {
          // Centre a capped width in its stretch.
          const u0 = a + ((b - a) - w) / 2;
          best = { u0, u1: u0 + w, v0, v1: v0 + h, area };
        }
      }
    }
  }
  return best;
}

// Which unit type goes next: the one furthest behind its share of what's
// been placed so far.
function nextType(mix, counts, placed, fits) {
  const total = mix.reduce((t, u) => t + u.pct, 0);
  let best = -1;
  let bestDeficit = -Infinity;
  mix.forEach((u, i) => {
    if (!fits(i)) return;
    const deficit = ((placed + 1) * u.pct) / total - counts[i];
    if (deficit > bestDeficit) {
      bestDeficit = deficit;
      best = i;
    }
  });
  return best;
}

// One wing's floor plate, in its own frame: length along the corridor,
// depth across it. cores: [{ at, side, kind, len }] (at = start along the
// corridor). Returns the units and cores placed, and the corridor.
// counts carries across wings so the mix holds for the whole building.
export function layoutWing(len, depth, s, mix, { cores = [], cornerStart = false, cornerEnd = false }, counts) {
  const cw = s.corridorWidth;
  const ud = (depth - cw) / 2;
  const units = [];
  if (ud < MIN_UNIT_DEPTH) return { units, cores: [], corridor: null, ok: false };
  const widths = mix.map((u) => u.size / ud);
  const largest = widths.reduce((bi, w, i) => (w > widths[bi] ? i : bi), 0);
  const placedCores = [...cores];
  // A corner: the outer side gets one corner unit (the largest type), the
  // inner side the stair where the corridors meet.
  const cornerZones = [];
  if (cornerStart) cornerZones.push([0, Math.min(depth, len)]);
  if (cornerEnd) cornerZones.push([Math.max(0, len - depth), len]);
  for (const [a, b] of cornerZones) {
    units.push({ t: largest, a0: a, a1: b, side: 'outer', corner: true, area: (b - a) * ud });
    counts[largest]++;
    placedCores.push({ at: a + (b - a - STAIR_LENGTH) / 2, side: 'inner', kind: 'stair', len: STAIR_LENGTH, corner: true });
  }
  for (const side of ['outer', 'inner']) {
    // Free stretches on this side: the wing minus its corners and cores.
    let free = [[cornerStart ? Math.min(depth, len) : 0, cornerEnd ? Math.max(0, len - depth) : len]];
    for (const c of placedCores.filter((x) => x.side === side && !x.corner)) {
      free = free.flatMap(([a, b]) => {
        const out = [];
        if (c.at > a) out.push([a, Math.min(b, c.at)]);
        if (c.at + c.len < b) out.push([Math.max(a, c.at + c.len), b]);
        return out.filter(([x, y]) => y - x > 0.5);
      });
    }
    for (const [a, b] of free) {
      let x = a;
      for (;;) {
        const room = b - x;
        const placed = counts.reduce((t, c) => t + c, 0);
        const i = nextType(mix, counts, placed, (k) => widths[k] <= room + 1e-6);
        if (i < 0) break;
        units.push({ t: i, a0: x, a1: x + widths[i], side, area: mix[i].size });
        counts[i]++;
        x += widths[i];
      }
    }
  }
  return { units, cores: placedCores, corridor: { b0: ud, b1: ud + cw }, ud, ok: true };
}

// Stair and elevator slots along a wing: a stair at each end that isn't a
// corner, more so no point is further than half the spacing from one, and
// the building's elevators in the middle of its longest wings.
export function wingCores(len, s, { cornerStart, cornerEnd, joinStart, joinEnd, elevators = 0 }) {
  const cores = [];
  if (!cornerStart && !joinStart) cores.push({ at: 0, side: 'inner', kind: 'stair', len: STAIR_LENGTH });
  if (!cornerEnd && !joinEnd) cores.push({ at: Math.max(0, len - STAIR_LENGTH), side: 'inner', kind: 'stair', len: STAIR_LENGTH });
  const spacing = Math.max(60, s.stairSpacing || 200);
  const extra = Math.max(0, Math.ceil(len / spacing) - 1);
  for (let k = 1; k <= extra; k++) {
    const at = (k * len) / (extra + 1) - STAIR_LENGTH / 2;
    cores.push({ at, side: k % 2 ? 'outer' : 'inner', kind: 'stair', len: STAIR_LENGTH });
  }
  for (let k = 0; k < elevators; k++) {
    const at = ((k + 1) * len) / (elevators + 1) - ELEVATOR_LENGTH / 2 + (extra ? STAIR_LENGTH : 0);
    cores.push({ at: Math.min(len - ELEVATOR_LENGTH, Math.max(0, at)), side: 'outer', kind: 'elevator', len: ELEVATOR_LENGTH });
  }
  return cores;
}

// A whole building's typical floor: every wing laid out, elevators shared
// out along the longest wings. Returns per-floor counts by type, rentable
// area, the drawing pieces (rotated frame), and the floor plate's area.
export function layoutBuilding(wings, s, mix, { elevators = 1 } = {}) {
  const counts = mix.map(() => 0);
  const order = wings.map((w, i) => ({ i, len: w.axis === 'u' ? w.u1 - w.u0 : w.v1 - w.v0 })).sort((a, b) => b.len - a.len);
  const elevatorsFor = new Map();
  for (let k = 0; k < elevators; k++) {
    const w = order[k % order.length].i;
    elevatorsFor.set(w, (elevatorsFor.get(w) || 0) + 1);
  }
  const pieces = { units: [], cores: [], corridors: [] };
  let nrsf = 0;
  let ok = true;
  wings.forEach((w, i) => {
    const isU = w.axis === 'u';
    const len = isU ? w.u1 - w.u0 : w.v1 - w.v0;
    const depth = isU ? w.v1 - w.v0 : w.u1 - w.u0;
    const cores = wingCores(len, s, {
      cornerStart: w.cornerStart, cornerEnd: w.cornerEnd, joinStart: w.joinStart, joinEnd: w.joinEnd, elevators: elevatorsFor.get(i) || 0,
    });
    const res = layoutWing(len, depth, s, mix, { cores, cornerStart: w.cornerStart, cornerEnd: w.cornerEnd }, counts);
    if (!res.ok) { ok = false; return; }
    // Local (along a, across b) to the rotated frame. 'outer' is the low
    // side across the wing, 'inner' the high side.
    const toFrame = (a, b) => (isU ? [w.u0 + a, w.v0 + b] : [w.u0 + b, w.v0 + a]);
    const rect = (a0, a1, b0, b1) => [toFrame(a0, b0), toFrame(a1, b0), toFrame(a1, b1), toFrame(a0, b1)];
    const sideRange = (side) => (side === 'outer' ? [0, res.ud] : [depth - res.ud, depth]);
    for (const u of res.units) {
      const [b0, b1] = sideRange(u.side);
      pieces.units.push({ t: u.t, ring: rect(u.a0, u.a1, b0, b1), corner: !!u.corner });
      nrsf += u.area;
    }
    for (const c of res.cores) {
      const [b0, b1] = sideRange(c.side);
      pieces.cores.push({ kind: c.kind, ring: rect(c.at, c.at + c.len, b0, b1) });
    }
    pieces.corridors.push(rect(0, len, res.corridor.b0, res.corridor.b1));
  });
  const plate = wings.reduce((t, w) => t + (w.u1 - w.u0) * (w.v1 - w.v0), 0);
  return { ok, counts, units: counts.reduce((t, c) => t + c, 0), nrsf, plate, pieces };
}

// Units for a building over all its floors, with elevators sized to the
// unit count and ground-floor amenity space taken out. Walk-ups (three
// floors or fewer, garden style) get no elevator.
export function buildingProgram(wings, s, mix, floors, { walkUp = false } = {}) {
  let elevators = walkUp && floors <= 3 ? 0 : 1;
  let plan = layoutBuilding(wings, s, mix, { elevators });
  if (!plan.ok) return null;
  if (!walkUp || floors > 3) {
    const needed = Math.max(1, Math.ceil((plan.units * floors) / Math.max(10, s.unitsPerElevator || 80)));
    if (needed > elevators) {
      elevators = needed;
      plan = layoutBuilding(wings, s, mix, { elevators });
    }
  }
  const avg = plan.units ? plan.nrsf / plan.units : 0;
  const amenityUnits = floors > 0 && avg > 0 ? Math.min(plan.units, Math.round((s.amenitySf || 0) / avg)) : 0;
  // Amenity comes out of the ground floor (at most one floor's units),
  // one at a time from whichever type has the most left.
  const byType = plan.counts.map((c) => c * floors);
  let take = amenityUnits;
  while (take > 0) {
    const i = byType.reduce((bi, c, k) => (c > byType[bi] ? k : bi), 0);
    if (byType[i] <= 0) break;
    byType[i]--;
    take--;
  }
  const units = byType.reduce((t, c) => t + c, 0);
  const removed = amenityUnits - take;
  const nrsf = plan.nrsf * floors - removed * avg;
  return { plan, elevators, byType, units, nrsf, amenityUnits: removed };
}

export { FALLBACK };

// Shapes for a building placed by hand: its length x depth box, made of
// wings b.wing deep. A shape too small for its wings stays a rectangle.
export const PLACED_SHAPES = [['rect', 'Rectangle'], ['L', 'L-shape'], ['U', 'U-shape'], ['courtyard', 'Courtyard']];
const MIN_PLACED_COURT = 10;

// The wings of a placed building in its own frame (centred, x along its
// length, y along its depth).
export function placedWings(b) {
  const box = { u0: -b.length / 2, u1: b.length / 2, v0: -b.depth / 2, v1: b.depth / 2 };
  const plain = [{ ...box, axis: b.length >= b.depth ? 'u' : 'v' }];
  if (!b.shape || b.shape === 'rect' || !(b.wing > 0)) return plain;
  const [minW, minH] = shapeMinimum(b.shape, b.wing, MIN_PLACED_COURT);
  if (b.length < minW || b.depth < minH) return plain;
  return shapeWings(b.shape, box, b.wing).wings;
}

// Its wings' corners in the plan's feet, around centre (cx, cy) at angle
// (radians), each grown by grow.
export function placedPieces(b, cx, cy, angle, grow = 0) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return placedWings(b).map((w) => [[w.u0 - grow, w.v0 - grow], [w.u1 + grow, w.v0 - grow], [w.u1 + grow, w.v1 + grow], [w.u0 - grow, w.v1 + grow]]
    .map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]));
}
