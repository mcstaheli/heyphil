// Terrain for the Site Planner: ground elevation sampled across the site
// from USGS (3DEP, via the Elevation Point Query Service), then the
// site's relief and slope, and a rough earthwork estimate - each building
// set on one flat pad at its average ground level, cut above it and fill
// below. An order-of-magnitude check, not a grading plan.
import { makeProjection, pointInShape } from './geometry';

export const EPQS_URL = 'https://epqs.nationalmap.gov/v1/json';
const CF_PER_CY = 27;

// Points on a grid inside the boundary ([lng, lat]), about `target` of
// them, plus the boundary's corners.
export function samplePoints(boundary, target = 30) {
  const ring = boundary.coordinates[0].slice(0, -1);
  const proj = makeProjection(boundary.coordinates[0]);
  const feet = ring.map(proj.toFeet);
  const xs = feet.map((p) => p[0]);
  const ys = feet.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const area = (x1 - x0) * (y1 - y0);
  const step = Math.max(20, Math.sqrt(area / target));
  const out = [];
  for (let x = x0 + step / 2; x < x1; x += step) {
    for (let y = y0 + step / 2; y < y1; y += step) {
      if (pointInShape([feet], [x, y])) {
        const [lat, lng] = proj.toLatLng([x, y]);
        out.push([lng, lat]);
      }
    }
  }
  // Corners pulled slightly inside, so the edges are sampled too.
  const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
  const every = Math.max(1, Math.ceil(feet.length / 12));
  for (const [x, y] of feet.filter((_, i) => i % every === 0)) {
    const [lat, lng] = proj.toLatLng([x + (cx - x) * 0.05, y + (cy - y) * 0.05]);
    out.push([lng, lat]);
  }
  return out;
}

// Elevations (ft) for points, a few requests at a time.
export async function fetchElevations(points, { fetchImpl = fetch, concurrency = 6 } = {}) {
  const out = new Array(points.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < points.length) {
      const i = next++;
      const [lng, lat] = points[i];
      try {
        const res = await fetchImpl(`${EPQS_URL}?x=${lng}&y=${lat}&wkid=4326&units=Feet&includeDate=false`);
        if (!res.ok) continue;
        const data = await res.json();
        const z = Number(data.value);
        if (Number.isFinite(z) && z > -1000) out[i] = z;
      } catch {
        // A point that fails is left out.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, points.length) }, worker));
  return points.map(([lng, lat], i) => ({ lng, lat, z: out[i] })).filter((p) => p.z !== null);
}

// Inverse-distance-weighted ground level at a point (feet frame).
function groundAt(samples, [x, y]) {
  let w = 0;
  let sum = 0;
  for (const s of samples) {
    const d2 = (s.x - x) ** 2 + (s.y - y) ** 2;
    if (d2 < 1) return s.z;
    const k = 1 / d2;
    w += k;
    sum += k * s.z;
  }
  return w ? sum / w : NaN;
}

// Least-squares plane z = a·x + b·y + c; its grade is the site's overall slope.
function fitPlane(samples) {
  const n = samples.length;
  let sx = 0; let sy = 0; let sz = 0; let sxx = 0; let syy = 0; let sxy = 0; let sxz = 0; let syz = 0;
  for (const { x, y, z } of samples) {
    sx += x; sy += y; sz += z; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z;
  }
  const mx = sx / n; const my = sy / n; const mz = sz / n;
  const cxx = sxx / n - mx * mx; const cyy = syy / n - my * my; const cxy = sxy / n - mx * my;
  const cxz = sxz / n - mx * mz; const cyz = syz / n - my * mz;
  const det = cxx * cyy - cxy * cxy;
  if (Math.abs(det) < 1e-9) return { a: 0, b: 0 };
  return { a: (cxz * cyy - cyz * cxy) / det, b: (cyz * cxx - cxz * cxy) / det };
}

// samples: [{ lng, lat, z }]; buildings: [[lat, lng], ...] rings (the
// solver's geometry). Returns the site's relief and slope and, per
// building, its pad level, the slope under it and cut/fill (cubic yards).
export function analyzeTerrain(boundary, samples, buildings = []) {
  if (!samples.length) return null;
  const proj = makeProjection(boundary.coordinates[0]);
  const pts = samples.map((s) => {
    const [x, y] = proj.toFeet([s.lng, s.lat]);
    return { ...s, x, y };
  });
  const zs = pts.map((p) => p.z);
  const low = Math.min(...zs);
  const high = Math.max(...zs);
  const plane = pts.length >= 3 ? fitPlane(pts) : { a: 0, b: 0 };
  const gradePct = Math.hypot(plane.a, plane.b) * 100;
  const pads = buildings.map((ring) => {
    const feet = ring.map(([lat, lng]) => proj.toFeet([lng, lat]));
    // Corners, edge midpoints and the centre, each standing for an equal
    // share of the footprint.
    const cx = feet.reduce((t, p) => t + p[0], 0) / feet.length;
    const cy = feet.reduce((t, p) => t + p[1], 0) / feet.length;
    const probes = [...feet, ...feet.map((p, i) => {
      const q = feet[(i + 1) % feet.length];
      return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    }), [cx, cy]];
    const ground = probes.map((p) => groundAt(pts, p));
    const pad = ground.reduce((t, z) => t + z, 0) / ground.length;
    let area = 0;
    for (let i = 0; i < feet.length; i++) {
      const [x1, y1] = feet[i];
      const [x2, y2] = feet[(i + 1) % feet.length];
      area += x1 * y2 - x2 * y1;
    }
    area = Math.abs(area) / 2;
    const share = area / probes.length;
    const cut = ground.reduce((t, z) => t + Math.max(0, z - pad) * share, 0) / CF_PER_CY;
    const fill = ground.reduce((t, z) => t + Math.max(0, pad - z) * share, 0) / CF_PER_CY;
    const span = Math.max(...feet.map((p) => Math.hypot(p[0] - cx, p[1] - cy))) * 2;
    const slopePct = span > 0 ? ((Math.max(...ground) - Math.min(...ground)) / span) * 100 : 0;
    return { padFt: pad, cutCy: cut, fillCy: fill, slopePct, steep: slopePct > STEEP_PAD_PCT };
  });
  return {
    samples: pts.length,
    lowFt: low,
    highFt: high,
    reliefFt: high - low,
    gradePct,
    pads,
    cutCy: pads.reduce((t, p) => t + p.cutCy, 0),
    fillCy: pads.reduce((t, p) => t + p.fillCy, 0),
    steepPads: pads.filter((p) => p.steep).length,
  };
}

export const STEEP_PAD_PCT = 8;
