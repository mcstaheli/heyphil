// Flat-plane geometry for the Site Planner, in feet. A site is small
// enough that projecting lng/lat onto a local plane around its middle is
// accurate to well under a foot, which keeps the layout maths simple.

const FT_PER_M = 3.28084;

// Returns the ring in local feet plus the way back to [lat, lng].
export function makeProjection(ringLngLat) {
  const pts = ringLngLat.slice(0, -1).length ? ringLngLat.slice(0, -1) : ringLngLat;
  const lng0 = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const lat0 = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const phi = (lat0 * Math.PI) / 180;
  const ftPerDegLat = (111132.954 - 559.822 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi)) * FT_PER_M;
  const ftPerDegLng = (111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi)) * FT_PER_M;
  return {
    toFeet: ([lng, lat]) => [(lng - lng0) * ftPerDegLng, (lat - lat0) * ftPerDegLat],
    toLatLng: ([x, y]) => [lat0 + y / ftPerDegLat, lng0 + x / ftPerDegLng],
  };
}

// Drops the closing point GeoJSON repeats, if it's there.
export function openRing(ring) {
  if (ring.length > 1) {
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) return ring.slice(0, -1);
  }
  return ring;
}

export function polygonArea(pts) {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

// Rotates the frame so a line at `angle` (radians) runs along +u.
export function rotate(pts, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return pts.map(([x, y]) => [x * c + y * s, -x * s + y * c]);
}

export function unrotate([u, v], angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [u * c - v * s, u * s + v * c];
}

// Where a horizontal line at v is inside the polygon, as sorted [a, b]
// intervals of u.
export function scanline(pts, v) {
  const xs = [];
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    if ((y1 <= v && y2 > v) || (y2 <= v && y1 > v)) {
      xs.push(x1 + ((v - y1) * (x2 - x1)) / (y2 - y1));
    }
  }
  xs.sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}

export function intersectIntervals(a, b) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i][0], b[j][0]);
    const hi = Math.min(a[i][1], b[j][1]);
    if (hi > lo) out.push([lo, hi]);
    if (a[i][1] < b[j][1]) i++;
    else j++;
  }
  return out;
}

// About a hundredth of an inch. Rotating a site to line it up leaves
// edges that should be level off by a hair, so a band laid along one
// is sampled just inside it rather than on the edge itself.
const EPS = 1e-3;

// The stretches of u where the whole band between v0 and v1 is inside
// the polygon. Edges are straight, so checking the band's two edges and
// either side of every corner inside it is exact (to within EPS).
export function bandIntervals(pts, v0, v1, minLength = 0) {
  const samples = [v0 + EPS, v1 - EPS];
  for (const [, y] of pts) {
    if (y > v0 + EPS && y < v1 - EPS) samples.push(y - EPS, y + EPS);
  }
  let result = scanline(pts, samples[0]);
  for (let k = 1; k < samples.length && result.length; k++) {
    result = intersectIntervals(result, scanline(pts, samples[k]));
  }
  return result.filter(([a, b]) => b - a >= minLength);
}

// Edge directions worth lining the layout up with: the longest edges
// first, de-duplicated to within half a degree (an edge and its reverse
// are the same direction).
export function candidateAngles(pts, count = 6) {
  const edges = pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return { len: Math.hypot(q[0] - p[0], q[1] - p[1]), angle: Math.atan2(q[1] - p[1], q[0] - p[0]) };
  });
  edges.sort((a, b) => b.len - a.len);
  const norm = (a) => ((a % Math.PI) + Math.PI) % Math.PI;
  const seen = [];
  const out = [];
  const add = (a) => {
    const n = norm(a);
    if (seen.some((s) => Math.min(Math.abs(s - n), Math.PI - Math.abs(s - n)) < Math.PI / 360)) return;
    seen.push(n);
    out.push(n);
  };
  for (const e of edges) {
    if (out.length >= count) break;
    add(e.angle);
  }
  if (edges.length) add(edges[0].angle + Math.PI / 2);
  return out;
}
