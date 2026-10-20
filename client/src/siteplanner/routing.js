// Auto-routed drive aisles for the Site Planner: from each bay that can't
// reach a drive, the cheapest path over a grid of the site to the drive
// network (or an entry). Buildings block the way; cutting through stalls
// costs more than open ground, so paths prefer gaps and existing drives.
// Each new path joins the network, so later bays can share it.
import { pointInShape } from './geometry';
import { distanceToRings } from './parking';

const DIAG = Math.SQRT2;

class MinHeap {
  constructor() { this.items = []; }

  push(item) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }

  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }

  get size() { return this.items.length; }
}

function inConvex(ring, [x, y]) {
  let sign = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (cross !== 0) {
      if (sign === 0) sign = Math.sign(cross);
      else if (Math.sign(cross) !== sign) return false;
    }
  }
  return true;
}

// Ramer-Douglas-Peucker: drops grid stair-steps that stay within tol.
export function simplifyPath(pts, tol) {
  if (pts.length <= 2) return pts;
  const [ax, ay] = pts[0];
  const [bx, by] = pts[pts.length - 1];
  const len = Math.hypot(bx - ax, by - ay) || 1;
  let worst = -1;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i];
    const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
    if (d > worst) { worst = d; idx = i; }
  }
  if (worst <= tol) return [pts[0], pts[pts.length - 1]];
  return [...simplifyPath(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplifyPath(pts.slice(idx), tol)];
}

// region: rings (local feet) the paths may use. blocked: convex polygons
// (buildings with clearance). costly: convex polygons (stall rows).
// network: rings of drive edges a path may end on. targets: points (e.g.
// entries) a path may end near, within targetRadius. sources: [[x, y]].
// Returns one path per source that found a way (points in feet).
// straighten: how far (ft) a simplified path may stray from the grid
// path, so it comes out as a few long straights rather than stair-steps.
export function routeAisles({ region, blocked = [], costly = [], network = [], targets = [], targetRadius = 30, sources, cell, straighten = 0 }) {
  const pts = region.flat();
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)];
  const area = (Math.max(...xs) - x0) * (Math.max(...ys) - y0);
  const size = cell || Math.max(6, Math.sqrt(area) / 120);
  const nx = Math.max(1, Math.ceil((Math.max(...xs) - x0) / size));
  const ny = Math.max(1, Math.ceil((Math.max(...ys) - y0) / size));
  const n = nx * ny;
  const centre = (i) => [x0 + ((i % nx) + 0.5) * size, y0 + (Math.floor(i / nx) + 0.5) * size];

  const cost = new Float32Array(n); // 0 = impassable
  const goal = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const c = centre(i);
    if (!pointInShape(region, c) || blocked.some((r) => inConvex(r, c))) continue;
    cost[i] = costly.some((r) => inConvex(r, c)) ? 4 : 1;
    if ((network.length && distanceToRings(network, c) <= size * 0.75)
      || targets.some(([tx, ty]) => Math.hypot(tx - c[0], ty - c[1]) <= targetRadius)) {
      goal[i] = 1;
    }
  }
  // A cell centre can sit up to a cell from a target, so allow for it.
  const reachTargets = (c) => targets.some(([tx, ty]) => Math.hypot(tx - c[0], ty - c[1]) <= targetRadius + size);
  for (let i = 0; i < n; i++) if (cost[i] && !goal[i] && reachTargets(centre(i))) goal[i] = 1;

  const cellOf = ([x, y]) => {
    const cx = Math.min(nx - 1, Math.max(0, Math.floor((x - x0) / size)));
    const cy = Math.min(ny - 1, Math.max(0, Math.floor((y - y0) / size)));
    return cy * nx + cx;
  };
  // The nearest passable cell to a point (a row end can sit on a cell
  // whose centre falls just outside the region).
  const nearestOpen = (p) => {
    const start = cellOf(p);
    if (cost[start] > 0) return start;
    for (let ring = 1; ring < 6; ring++) {
      const sx = start % nx;
      const sy = Math.floor(start / nx);
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          const x = sx + dx;
          const y = sy + dy;
          if (x < 0 || y < 0 || x >= nx || y >= ny) continue;
          const i = y * nx + x;
          if (cost[i] > 0) return i;
        }
      }
    }
    return -1;
  };

  const steps = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, DIAG], [1, -1, DIAG], [-1, 1, DIAG], [-1, -1, DIAG]];
  const paths = [];
  for (const source of sources) {
    const start = nearestOpen(source);
    if (start < 0) continue;
    if (goal[start]) continue; // already on the network
    // Full precision: rounding here could let a cell's back-pointer loop.
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const heap = new MinHeap();
    dist[start] = 0;
    heap.push([0, start]);
    let found = -1;
    while (heap.size) {
      const [d, i] = heap.pop();
      if (d > dist[i]) continue;
      if (goal[i]) { found = i; break; }
      const x = i % nx;
      const y = Math.floor(i / nx);
      for (const [dx, dy, w] of steps) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= nx || yy >= ny) continue;
        const j = yy * nx + xx;
        if (!cost[j]) continue;
        const nd = d + w * (cost[i] + cost[j]) / 2;
        if (nd < dist[j]) {
          dist[j] = nd;
          prev[j] = i;
          heap.push([nd, j]);
        }
      }
    }
    if (found < 0) continue;
    const cells = [];
    for (let i = found; i >= 0 && cells.length <= n; i = prev[i]) cells.push(i);
    cells.reverse();
    const line = simplifyPath([source, ...cells.slice(1).map(centre)], Math.max(size * 0.75, straighten));
    if (line.length >= 2 && Math.hypot(line[0][0] - line[line.length - 1][0], line[0][1] - line[line.length - 1][1]) > size) {
      paths.push(line);
      // The path is now part of the network for the bays still to route.
      cells.forEach((i) => { goal[i] = 1; });
    }
  }
  return paths;
}
