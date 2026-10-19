// The Site Planner's layout engine: given a drawn site and a scheme (an
// asset type plus its overrides), lay out buildings and parking and work
// out the yield. It is a rules-based test fit, not an optimiser: it tries
// the layout lined up with each of the site's main edge directions and a
// few starting offsets, and keeps the one with the best yield that meets
// parking, FAR and coverage. Drive connections between parking bays and
// out to the street aren't modelled.
import turfArea from '@turf/area';
import buffer from '@turf/buffer';
import difference from '@turf/difference';
import { featureCollection, polygon as turfPolygon } from '@turf/helpers';
import { effectiveSettings, getAssetType } from './assetTypes';
import {
  asRings,
  bandIntervals,
  candidateAngles,
  convexOverlap,
  makeProjection,
  openRing,
  rectCorners,
  ringInsideShape,
  rotateRings,
  shapeArea,
  unrotate,
} from './geometry';
import { combineProformas, proformaFor } from './proforma';

const SF_PER_SQM = 10.7639;
export const SF_PER_ACRE = 43560;
const MIN_BUILDING_LENGTH = 50;
const MIN_INDUSTRIAL_LENGTH = 100;
// Drive clearance kept around a hand-placed building when parking fills
// in around it.
export const BUILDING_CLEARANCE = 10;
const CHECK_TOLERANCE = 0.5;
const PODIUM_LEVEL_HEIGHT = 10;
const HOME_FLOOR_HEIGHT = 10;
const INDUSTRIAL_ROOF_ALLOWANCE = 8; // clear height to roof
const INDUSTRIAL_DEPTH_STEP = 20;
// Floors are tried one count at a time, so the count is capped.
export const MAX_FLOORS = 100;

export const LIMIT_LABELS = {
  parking: 'Parking',
  far: 'FAR',
  coverage: 'Lot coverage',
  height: 'Height',
  site: 'Site size',
  manual: 'Placed by hand',
};

// Keeps every dimension the layout divides by or steps with above zero,
// whatever an override says.
function sanitize(s) {
  const pos = (v, min) => Math.max(min, Number.isFinite(v) ? v : min);
  const mix = Array.isArray(s.mix) ? s.mix.filter((u) => u.size > 0 && u.pct > 0) : null;
  return {
    ...s,
    setback: pos(s.setback, 0),
    stallWidth: pos(s.stallWidth, 1),
    stallDepth: pos(s.stallDepth, 1),
    aisleWidth: pos(s.aisleWidth, 0),
    floors: Math.min(MAX_FLOORS, Math.max(0, Math.round(s.floors || 0))),
    podiumLevels: Math.min(MAX_FLOORS, Math.max(0, Math.round(s.podiumLevels || 0))),
    floorToFloor: pos(s.floorToFloor, 1),
    buildingDepth: pos(s.buildingDepth, 10),
    maxBuildingLength: pos(s.maxBuildingLength, MIN_BUILDING_LENGTH),
    buildingGap: pos(s.buildingGap, 0),
    efficiency: Math.min(100, pos(s.efficiency, 1)),
    sfPerStructuredStall: pos(s.sfPerStructuredStall, 100),
    grossPerKey: pos(s.grossPerKey, 50),
    lotWidth: pos(s.lotWidth, 5),
    lotDepth: pos(s.lotDepth, 10),
    streetWidth: pos(s.streetWidth, 10),
    homeSize: pos(s.homeSize, 100),
    garageStalls: pos(s.garageStalls, 0),
    minBuildingDepth: pos(s.minBuildingDepth, 20),
    maxBuildingDepth: pos(s.maxBuildingDepth, 20),
    truckCourt: pos(s.truckCourt, 0),
    dockSpacing: pos(s.dockSpacing, 1),
    clearHeight: pos(s.clearHeight, 0),
    parkingRatio: pos(s.parkingRatio, 0),
    maxHeight: pos(s.maxHeight, 0),
    maxFar: pos(s.maxFar, 0),
    maxCoverage: pos(s.maxCoverage, 0),
    mix: mix && mix.length ? mix : null,
  };
}

function bayDepth(s) {
  return 2 * s.stallDepth + s.aisleWidth;
}

// The parking rows that fit in one double-loaded bay starting at v0.
function parkingBay(pts, v0, s) {
  const depth = bayDepth(s);
  const rows = [];
  let stalls = 0;
  for (const [a, b] of bandIntervals(pts, v0, v0 + depth, 2 * s.stallWidth)) {
    const perSide = Math.floor((b - a) / s.stallWidth);
    if (perSide < 1) continue;
    rows.push({ u0: a, u1: a + perSide * s.stallWidth, v0, v1: v0 + depth, perSide });
    stalls += 2 * perSide;
  }
  return { rows, stalls };
}

// Splits each stretch of a building band into buildings no longer than
// the max, with the gap between them.
function buildingsInBand(pts, v0, v1, s) {
  const out = [];
  for (const [a, b] of bandIntervals(pts, v0, v1, MIN_BUILDING_LENGTH)) {
    const len = b - a;
    const gap = s.buildingGap;
    let n = Math.max(1, Math.ceil((len + gap) / (s.maxBuildingLength + gap)));
    let w = (len - (n - 1) * gap) / n;
    while (n > 1 && w < MIN_BUILDING_LENGTH) {
      n--;
      w = (len - (n - 1) * gap) / n;
    }
    for (let i = 0; i < n; i++) {
      const u0 = a + i * (w + gap);
      out.push({ u0, u1: u0 + w, v0, v1 });
    }
  }
  return out;
}

function areaOf(rects) {
  return rects.reduce((sum, r) => sum + (r.u1 - r.u0) * (r.v1 - r.v0), 0);
}

function mixAverage(mix) {
  const total = mix.reduce((s, u) => s + u.pct, 0);
  return mix.reduce((s, u) => s + u.size * u.pct, 0) / total;
}

// Splits a unit count across the mix by percentage, rounding so the
// counts still add up (largest remainder).
export function splitByMix(units, mix) {
  if (!mix || !mix.length || units <= 0) return [];
  const total = mix.reduce((s, u) => s + u.pct, 0);
  const raw = mix.map((u) => (units * u.pct) / total);
  const counts = raw.map(Math.floor);
  let left = units - counts.reduce((s, c) => s + c, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k++, left--) counts[order[k % order.length][1]]++;
  return mix.map((u, i) => ({ name: u.name, size: u.size, count: counts[i] }));
}

function zoningFails(s, siteSf, gsf, footprint) {
  const fails = [];
  if (s.maxFar > 0 && gsf > s.maxFar * siteSf + 1e-6) fails.push('far');
  if (s.maxCoverage > 0 && footprint > (s.maxCoverage / 100) * siteSf + 1e-6) fails.push('coverage');
  return fails;
}

// ---- Bars: building bars alternating with parking bays -----------------

// gsf defaults to footprint x floors; hand-placed buildings with their
// own floor counts pass it in.
function barsProgram(type, s, footprint, floors, gsf = footprint * floors) {
  const out = { gsf, nsf: 0, units: 0, keys: 0, structured: 0, required: 0, score: 0 };
  if (type.yieldKind === 'units') {
    out.nsf = (gsf * s.efficiency) / 100;
    out.units = s.mix ? Math.floor(out.nsf / mixAverage(s.mix)) : 0;
    out.required = Math.ceil(out.units * s.parkingRatio - 1e-9);
    out.score = out.units;
  } else if (type.yieldKind === 'keys') {
    out.keys = Math.floor(gsf / s.grossPerKey);
    out.required = Math.ceil(out.keys * s.parkingRatio - 1e-9);
    out.score = out.keys;
  } else {
    out.nsf = (gsf * s.efficiency) / 100;
    out.required = Math.ceil((out.nsf / 1000) * s.parkingRatio - 1e-9);
    out.score = out.nsf;
  }
  if (s.podiumLevels > 0 && type.id === 'mf-podium') {
    out.structured = Math.floor((footprint * s.podiumLevels) / s.sfPerStructuredStall);
  }
  return out;
}

function barsLayouts(pts, s, type, siteSf) {
  const D = s.buildingDepth;
  const P = bayDepth(s);
  const vs = asRings(pts).flat().map((p) => p[1]);
  const vmin = Math.min(...vs);
  const vmax = Math.max(...vs);
  const podiumHeight = type.id === 'mf-podium' ? s.podiumLevels * PODIUM_LEVEL_HEIGHT : 0;
  let floorsMax = Math.max(1, s.floors);
  let heightLimited = false;
  if (s.maxHeight > 0) {
    const allowed = Math.floor((s.maxHeight - podiumHeight) / s.floorToFloor + 1e-9);
    if (allowed < floorsMax) {
      heightLimited = true;
      floorsMax = Math.max(0, allowed);
    }
  }

  const candidates = [];
  for (const phase of ['B', 'P']) {
    for (const offset of [0, 10]) {
      const bands = [];
      let v = vmin + offset;
      let kind = phase;
      while (true) {
        const depth = kind === 'B' ? D : P;
        if (v + depth <= vmax) {
          bands.push({ kind, v0: v, v1: v + depth });
          v += depth;
          kind = kind === 'B' ? 'P' : 'B';
        } else if (kind === 'B' && v + P <= vmax) {
          bands.push({ kind: 'P', v0: v, v1: v + P });
          v += P;
        } else {
          break;
        }
      }

      for (const band of bands) {
        if (band.kind === 'B') {
          band.buildings = buildingsInBand(pts, band.v0, band.v1, s);
          band.footprint = areaOf(band.buildings);
          // A building band given over to parking holds as many bays as fit.
          band.asParking = [];
          for (let k = 0; (k + 1) * P <= D; k++) band.asParking.push(parkingBay(pts, band.v0 + k * P, s));
          band.asParkingStalls = band.asParking.reduce((sum, b) => sum + b.stalls, 0);
        } else {
          band.bay = parkingBay(pts, band.v0, s);
        }
      }

      const bIdx = bands.map((b, i) => i).filter((i) => bands[i].kind === 'B');
      const empty = bIdx.filter((i) => bands[i].footprint === 0);
      const order = bIdx.filter((i) => bands[i].footprint > 0).sort((a, b) => bands[a].footprint - bands[b].footprint);

      const evaluate = (flipped, floors) => {
        let footprint = 0;
        let surface = 0;
        for (let i = 0; i < bands.length; i++) {
          const b = bands[i];
          if (b.kind === 'P') surface += b.bay.stalls;
          else if (flipped.has(i)) surface += b.asParkingStalls;
          else footprint += b.footprint;
        }
        const prog = barsProgram(type, s, footprint, floors);
        const provided = surface + prog.structured;
        const fails = zoningFails(s, siteSf, prog.gsf, footprint);
        if (provided < prog.required) fails.push('parking');
        return { ...prog, footprint, surface, provided, fails, floors, flipped: new Set(flipped) };
      };

      const firstLook = evaluate(new Set(empty), floorsMax);
      const limits = [...firstLook.fails];
      if (heightLimited) limits.push('height');

      let best = null;
      for (let floors = floorsMax; floors >= 1; floors--) {
        const flipped = new Set(empty);
        const queue = [...order];
        let ev = evaluate(flipped, floors);
        while (ev.fails.length && queue.length) {
          flipped.add(queue.shift());
          ev = evaluate(flipped, floors);
        }
        if (ev.fails.length) continue;
        if (!best || ev.score > best.score) best = ev;
      }
      if (!best) best = evaluate(new Set(bIdx), Math.max(1, floorsMax));
      if (floorsMax < 1) best = { ...evaluate(new Set(bIdx), 1), floors: 0, score: 0 };

      const shapes = { buildings: [], parking: [] };
      bands.forEach((b, i) => {
        if (b.kind === 'P') shapes.parking.push(...b.bay.rows);
        else if (best.flipped.has(i)) b.asParking.forEach((bay) => shapes.parking.push(...bay.rows));
        else shapes.buildings.push(...b.buildings);
      });

      candidates.push({
        score: best.score,
        surplus: best.provided - best.required,
        shapes,
        metrics: {
          footprintSf: best.footprint,
          buildingCount: best.footprint > 0 ? shapes.buildings.length : 0,
          floors: best.footprint > 0 ? best.floors : 0,
          heightFt: best.footprint > 0 ? podiumHeight + best.floors * s.floorToFloor : 0,
          gsf: best.gsf,
          nsf: best.nsf,
          units: best.units,
          unitsByType: type.yieldKind === 'units' ? splitByMix(best.units, s.mix) : [],
          keys: best.keys,
          parkingRequired: best.required,
          parkingSurface: best.surface,
          parkingStructured: best.structured,
          parkingGarage: 0,
          parkingProvided: best.provided,
        },
        limits: limits.length ? limits : ['site'],
      });
    }
  }
  return candidates;
}

// ---- Lots: rows of lots facing internal streets ------------------------

function lotsLayouts(pts, s, type, siteSf) {
  const vs = asRings(pts).flat().map((p) => p[1]);
  const vmin = Math.min(...vs);
  const vmax = Math.max(...vs);
  const pattern = ['L', 'S', 'L'];
  const candidates = [];

  for (const start of [0, 1]) {
    for (const offset of [0, 10]) {
      const bands = [];
      let v = vmin + offset;
      for (let i = start; ; i++) {
        const kind = pattern[i % 3];
        const depth = kind === 'L' ? s.lotDepth : s.streetWidth;
        if (v + depth > vmax) break;
        bands.push({ kind, v0: v, v1: v + depth });
        v += depth;
      }
      for (const b of bands) {
        if (b.kind === 'S') b.intervals = bandIntervals(pts, b.v0, b.v1, 20);
      }

      // A lot counts only if a street runs past its frontage.
      const lots = [];
      const streets = [];
      bands.forEach((b, i) => {
        if (b.kind === 'S') {
          b.intervals.forEach(([a, c]) => streets.push({ u0: a, u1: c, v0: b.v0, v1: b.v1 }));
          return;
        }
        const neighbours = [bands[i - 1], bands[i + 1]].filter((n) => n && n.kind === 'S');
        if (!neighbours.length) return;
        for (const [a, c] of bandIntervals(pts, b.v0, b.v1, s.lotWidth)) {
          const n = Math.floor((c - a) / s.lotWidth);
          for (let k = 0; k < n; k++) {
            const u0 = a + k * s.lotWidth;
            const mid = u0 + s.lotWidth / 2;
            if (neighbours.some((nb) => nb.intervals.some(([x, y]) => mid >= x && mid <= y))) {
              lots.push({ u0, u1: u0 + s.lotWidth, v0: b.v0, v1: b.v1 });
            }
          }
        }
      });

      let floors = Math.max(1, s.floors);
      const limits = [];
      // Homes too tall for the height limit lose floors (same home size,
      // bigger footprint); if not even one floor fits, nothing is built.
      if (s.maxHeight > 0 && floors * HOME_FLOOR_HEIGHT > s.maxHeight) {
        floors = Math.floor(s.maxHeight / HOME_FLOOR_HEIGHT + 1e-9);
        limits.push('height');
      }
      const homeFootprint = floors > 0 ? s.homeSize / floors : 0;
      let units = floors > 0 ? lots.length : 0;
      if (s.maxFar > 0) {
        const cap = Math.floor((s.maxFar * siteSf) / s.homeSize);
        if (cap < units) { units = cap; limits.push('far'); }
      }
      if (s.maxCoverage > 0 && homeFootprint > 0) {
        const cap = Math.floor(((s.maxCoverage / 100) * siteSf) / homeFootprint);
        if (cap < units) { units = cap; limits.push('coverage'); }
      }
      const garage = units * s.garageStalls;
      const required = Math.ceil(units * s.parkingRatio - 1e-9);
      if (garage < required) limits.push('parking');

      candidates.push({
        score: units,
        surplus: garage - required,
        shapes: { lots: lots.slice(0, units), streets },
        metrics: {
          footprintSf: units * homeFootprint,
          buildingCount: units,
          floors: units > 0 ? floors : 0,
          heightFt: units > 0 ? floors * HOME_FLOOR_HEIGHT : 0,
          gsf: units * s.homeSize,
          nsf: units * s.homeSize,
          units,
          unitsByType: [],
          keys: 0,
          parkingRequired: required,
          parkingSurface: 0,
          parkingStructured: 0,
          parkingGarage: garage,
          parkingProvided: garage,
        },
        limits: limits.length ? limits : ['site'],
      });
    }
  }
  return candidates;
}

// ---- Industrial: one deep building, truck court, car parking -----------

function industrialLayouts(pts, s, type, siteSf) {
  const vs = asRings(pts).flat().map((p) => p[1]);
  const vmin = Math.min(...vs);
  const vmax = Math.max(...vs);
  const P = bayDepth(s);
  const heightFt = s.clearHeight + INDUSTRIAL_ROOF_ALLOWANCE;
  const tooTall = s.maxHeight > 0 && heightFt > s.maxHeight;
  const candidates = [];
  let unconstrained = null;

  const build = (sequence, depth) => {
    const bands = [];
    let v = vmin;
    for (const kind of sequence) {
      const d = kind === 'P' ? P : kind === 'B' ? depth : s.truckCourt;
      if (v + d > vmax) return null;
      bands.push({ kind, v0: v, v1: v + d });
      v += d;
    }
    while (v + P <= vmax) {
      bands.push({ kind: 'P', v0: v, v1: v + P });
      v += P;
    }
    const shapes = { buildings: [], parking: [], truckCourts: [] };
    let surface = 0;
    let docks = 0;
    for (const b of bands) {
      if (b.kind === 'P') {
        const bay = parkingBay(pts, b.v0, s);
        shapes.parking.push(...bay.rows);
        surface += bay.stalls;
      } else if (b.kind === 'B') {
        for (const [a, c] of bandIntervals(pts, b.v0, b.v1, MIN_INDUSTRIAL_LENGTH)) {
          shapes.buildings.push({ u0: a, u1: c, v0: b.v0, v1: b.v1 });
          docks += Math.floor((c - a) / s.dockSpacing);
        }
      } else if (s.truckCourt > 0) {
        for (const [a, c] of bandIntervals(pts, b.v0, b.v1, 50)) shapes.truckCourts.push({ u0: a, u1: c, v0: b.v0, v1: b.v1 });
      }
    }
    const footprint = areaOf(shapes.buildings);
    const required = Math.ceil((footprint / 1000) * s.parkingRatio - 1e-9);
    const fails = zoningFails(s, siteSf, footprint, footprint);
    if (surface < required) fails.push('parking');
    if (tooTall && footprint > 0) fails.push('height');
    return { shapes, footprint, surface, required, docks, fails };
  };

  const toCandidate = (r, limits) => ({
    score: r.footprint,
    surplus: r.surface - r.required,
    shapes: r.shapes,
    metrics: {
      footprintSf: r.footprint,
      buildingCount: r.shapes.buildings.length,
      floors: r.footprint > 0 ? 1 : 0,
      heightFt: r.footprint > 0 ? heightFt : 0,
      gsf: r.footprint,
      nsf: r.footprint,
      units: 0,
      unitsByType: [],
      keys: 0,
      docks: r.docks,
      parkingRequired: r.required,
      parkingSurface: r.surface,
      parkingStructured: 0,
      parkingGarage: 0,
      parkingProvided: r.surface,
    },
    limits,
  });

  const lo = Math.min(s.minBuildingDepth, s.maxBuildingDepth);
  const hi = Math.max(s.minBuildingDepth, s.maxBuildingDepth);
  const depths = [];
  for (let d = lo; d < hi; d += INDUSTRIAL_DEPTH_STEP) depths.push(d);
  depths.push(hi);
  for (const depth of depths) {
    for (const sequence of [['P', 'B', 'T'], ['T', 'B', 'P']]) {
      const r = build(sequence, depth);
      if (!r) continue;
      if (!unconstrained || r.footprint > unconstrained.footprint) unconstrained = r;
      if (!r.fails.length) candidates.push(toCandidate(r, []));
    }
  }

  // Name what stopped it growing: the constraints the biggest layout broke.
  const limits = unconstrained && unconstrained.fails.length ? [...unconstrained.fails] : ['site'];
  candidates.forEach((c) => { c.limits = limits; });
  if (!candidates.length) {
    const parkingOnly = build([], 0);
    if (parkingOnly) {
      candidates.push(toCandidate({ ...parkingOnly, shapes: { ...parkingOnly.shapes, buildings: [] }, footprint: 0, required: 0, docks: 0 }, limits));
    }
  }
  return candidates;
}

// ---- Parking only ------------------------------------------------------

function parkingLayouts(pts, s) {
  const vs = asRings(pts).flat().map((p) => p[1]);
  const vmin = Math.min(...vs);
  const vmax = Math.max(...vs);
  const P = bayDepth(s);
  const candidates = [];
  for (const offset of [0, P / 3, (2 * P) / 3]) {
    const rows = [];
    let stalls = 0;
    for (let v = vmin + offset; v + P <= vmax; v += P) {
      const bay = parkingBay(pts, v, s);
      rows.push(...bay.rows);
      stalls += bay.stalls;
    }
    candidates.push({
      score: stalls,
      surplus: stalls,
      shapes: { parking: rows },
      metrics: {
        footprintSf: 0, buildingCount: 0, floors: 0, heightFt: 0, gsf: 0, nsf: 0, units: 0, unitsByType: [], keys: 0,
        parkingRequired: 0, parkingSurface: stalls, parkingStructured: 0, parkingGarage: 0, parkingProvided: stalls,
      },
      limits: ['site'],
    });
  }
  return candidates;
}

const LAYOUTS = { bars: barsLayouts, lots: lotsLayouts, industrial: industrialLayouts, parking: parkingLayouts };

// ---- Putting it together -----------------------------------------------

// Every ring of a Polygon / MultiPolygon (outlines and holes), lng/lat.
function ringsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates;
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat();
  return [];
}

function toFeature(geometry) {
  return { type: 'Feature', properties: {}, geometry };
}

// The site inside its setback, as a Feature, or null if nothing is left.
function insetSite(boundary, setback) {
  if (!(setback > 0)) return toFeature(boundary);
  const res = buffer(toFeature(boundary), -setback, { units: 'feet' });
  return res && res.geometry && ringsOf(res.geometry).length ? res : null;
}

// region minus each cutout (spaces, placed buildings), or null if
// nothing is left.
function subtract(region, cutouts) {
  if (!cutouts.length) return region;
  const res = difference(featureCollection([region, ...cutouts.map((g) => toFeature(g))]));
  return res && res.geometry ? res : null;
}

function rectToLatLngs(r, angle, proj) {
  return [[r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1]].map((p) => proj.toLatLng(unrotate(p, angle)));
}

// Stall striping for a parking row: a line at every stall edge, on both
// sides of the aisle.
function stallLines(row, s, angle, proj) {
  const lines = [];
  for (let k = 0; k <= row.perSide; k++) {
    const u = row.u0 + k * s.stallWidth;
    lines.push([[u, row.v0], [u, row.v0 + s.stallDepth]]);
    lines.push([[u, row.v1 - s.stallDepth], [u, row.v1]]);
  }
  return lines.map((line) => line.map((p) => proj.toLatLng(unrotate(p, angle))));
}

const EMPTY_METRICS = {
  footprintSf: 0, buildingCount: 0, floors: 0, heightFt: 0, gsf: 0, nsf: 0, units: 0, unitsByType: [], keys: 0,
  docks: 0, parkingRequired: 0, parkingSurface: 0, parkingStructured: 0, parkingGarage: 0, parkingProvided: 0,
};

const better = (c, best) => !best || c.score > best.score + 1e-6
  || (Math.abs(c.score - best.score) <= 1e-6 && c.surplus > best.surplus);

// Whether a type's buildings can be placed by hand (bars and industrial;
// lots and parking-only lay out their own way).
export function supportsManualLayout(type) {
  return type.mode === 'bars' || type.mode === 'industrial';
}

// A hand-placed building's corners in local feet.
function buildingFeet(b, proj, grow = 0) {
  const [cx, cy] = proj.toFeet(b.center);
  return rectCorners(cx, cy, b.length + 2 * grow, b.depth + 2 * grow, (b.angle * Math.PI) / 180);
}

function feetRingToGeo(ring, proj) {
  const pts = ring.map((p) => {
    const [lat, lng] = proj.toLatLng(p);
    return [lng, lat];
  });
  return { type: 'Polygon', coordinates: [[...pts, pts[0]]] };
}

// Hand-placed buildings: their footprints are as drawn; parking fills in
// around them. Constraints are checked, not enforced.
function solveManual(regionRings, regionFeature, s, type, siteSf, proj, placed) {
  const floorsOf = (b) => Math.min(MAX_FLOORS, Math.max(1, Math.round(b.floors || s.floors || 1)));
  const rects = placed.map((b) => ({ b, corners: buildingFeet(b, proj), floors: floorsOf(b) }));
  const footprint = rects.reduce((sum, r) => sum + r.b.length * r.b.depth, 0);
  const isIndustrial = type.mode === 'industrial';
  const gsf = isIndustrial ? footprint : rects.reduce((sum, r) => sum + r.b.length * r.b.depth * r.floors, 0);
  const maxFloors = isIndustrial ? (rects.length ? 1 : 0) : Math.max(0, ...rects.map((r) => r.floors));

  // Parking: whatever's left once each building and its clearance is
  // cut out, lined up with the site or with any of the buildings.
  const cutouts = placed.map((b) => feetRingToGeo(buildingFeet(b, proj, BUILDING_CLEARANCE), proj));
  const parkingRegion = subtract(regionFeature, cutouts);
  const parkingRings = parkingRegion ? ringsOf(parkingRegion.geometry).map((r) => openRing(r).map(proj.toFeet)) : [];
  const angles = [...candidateAngles(regionRings), ...placed.map((b) => (b.angle * Math.PI) / 180)];
  let best = null;
  if (parkingRings.length) {
    for (const angle of angles) {
      for (const c of parkingLayouts(rotateRings(parkingRings, angle), s)) {
        if (better(c, best)) best = { ...c, angle };
      }
    }
  }
  const surface = best ? best.score : 0;

  let prog;
  let docks = 0;
  if (isIndustrial) {
    const required = Math.ceil((footprint / 1000) * s.parkingRatio - 1e-9);
    prog = { gsf, nsf: gsf, units: 0, keys: 0, structured: 0, required };
    docks = placed.reduce((sum, b) => sum + Math.floor(Math.max(b.length, b.depth) / s.dockSpacing), 0);
  } else {
    prog = barsProgram(type, s, footprint, 1, gsf);
  }
  const provided = surface + prog.structured;

  const podiumHeight = type.id === 'mf-podium' ? s.podiumLevels * PODIUM_LEVEL_HEIGHT : 0;
  const heightFt = isIndustrial
    ? (rects.length ? s.clearHeight + INDUSTRIAL_ROOF_ALLOWANCE : 0)
    : (rects.length ? podiumHeight + maxFloors * s.floorToFloor : 0);

  // Which buildings break the setback (or sit on a space), and which
  // overlap each other.
  // Checked half a foot in from each edge, so a building converted from
  // the automatic layout (edges exactly on the setback, or touching a
  // neighbour, then rounded to whole feet) doesn't fail on rounding.
  const checkCorners = placed.map((b) => buildingFeet(b, proj, -CHECK_TOLERANCE));
  const outside = rects.filter((r, i) => !ringInsideShape(checkCorners[i], regionRings)).map((r) => r.b.id);
  const overlaps = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (convexOverlap(checkCorners[i], checkCorners[j])) overlaps.push([rects[i].b.id, rects[j].b.id]);
    }
  }

  return {
    score: prog.units || prog.keys || prog.nsf,
    surplus: provided - prog.required,
    angle: best ? best.angle : 0,
    shapes: { parking: best ? best.shapes.parking : [] },
    buildingLatLngs: rects.map((r) => r.corners.map((p) => proj.toLatLng(p))),
    metrics: {
      footprintSf: footprint,
      buildingCount: rects.length,
      floors: maxFloors,
      heightFt,
      gsf,
      nsf: prog.nsf,
      units: prog.units,
      unitsByType: type.yieldKind === 'units' ? splitByMix(prog.units, s.mix) : [],
      keys: prog.keys,
      docks,
      parkingRequired: prog.required,
      parkingSurface: surface,
      parkingStructured: prog.structured,
      parkingGarage: 0,
      parkingProvided: provided,
    },
    limits: ['manual'],
    warnings: { outside, overlaps },
  };
}

const noBoundary = { error: 'Draw the site boundary on the map to see a layout.', metrics: null, geometry: null, limits: [] };

// One part of a plan - the main scheme, or one space - on its own
// boundary, with cutouts (GeoJSON polygons) removed first.
function solvePart(boundary, scheme, cutouts = []) {
  const type = getAssetType(scheme.assetType);
  const s = sanitize(effectiveSettings(scheme));
  if (!boundary || !boundary.coordinates || !boundary.coordinates[0]) return { ...noBoundary, type, settings: s };

  const siteSf = turfArea(toFeature(boundary)) * SF_PER_SQM;
  const proj = makeProjection(boundary.coordinates[0]);
  const base = { siteSf, siteAcres: siteSf / SF_PER_ACRE };
  const empty = (error) => ({
    error,
    metrics: { ...base, ...EMPTY_METRICS, buildableSf: 0, far: 0, coverage: 0, density: 0 },
    geometry: null,
    limits: ['site'],
    warnings: { outside: [], overlaps: [] },
    buildingRects: [],
    proforma: null,
    type,
    settings: s,
  });

  let region;
  let inset;
  try {
    inset = insetSite(boundary, s.setback);
    region = inset ? subtract(inset, cutouts) : null;
  } catch {
    return { ...noBoundary, error: 'Couldn\'t work with that boundary - redraw it without crossing lines.', type, settings: s };
  }
  if (!region) return empty('The setback leaves no room to build.');

  const rings = ringsOf(region.geometry).map((r) => openRing(r).map(proj.toFeet)).filter((r) => r.length >= 3);
  if (!rings.length) return empty('The setback leaves no room to build.');
  const buildableSf = shapeArea(rings);

  const placed = supportsManualLayout(type) ? (scheme.edits?.buildings || []) : [];
  let best = null;
  if (placed.length) {
    best = solveManual(rings, region, s, type, siteSf, proj, placed);
  } else {
    const angles = s.rotation === 'auto' || !Number.isFinite(s.rotation)
      ? candidateAngles(rings)
      : [(s.rotation * Math.PI) / 180];
    for (const angle of angles) {
      for (const c of LAYOUTS[type.mode](rotateRings(rings, angle), s, type, siteSf)) {
        if (better(c, best)) best = { ...c, angle };
      }
    }
  }

  const m = { ...EMPTY_METRICS, ...best.metrics };
  const metrics = {
    ...base,
    ...m,
    buildableSf,
    far: siteSf > 0 ? m.gsf / siteSf : 0,
    coverage: siteSf > 0 ? m.footprintSf / siteSf : 0,
    density: base.siteAcres > 0 ? (m.units || m.keys) / base.siteAcres : 0,
    orientationDeg: Math.round(((best.angle * 180) / Math.PI) * 10) / 10,
  };

  const { angle, shapes } = best;
  const autoBuildings = shapes.buildings || [];
  const geometry = {
    setback: s.setback > 0 ? ringsOf(inset.geometry).map((r) => openRing(r).map(([lng, lat]) => [lat, lng])) : null,
    buildings: best.buildingLatLngs || autoBuildings.map((r) => rectToLatLngs(r, angle, proj)),
    parking: (shapes.parking || []).map((r) => ({ outline: rectToLatLngs(r, angle, proj), stalls: stallLines(r, s, angle, proj) })),
    lots: (shapes.lots || []).map((r) => rectToLatLngs(r, angle, proj)),
    streets: (shapes.streets || []).map((r) => rectToLatLngs(r, angle, proj)),
    truckCourts: (shapes.truckCourts || []).map((r) => rectToLatLngs(r, angle, proj)),
  };

  // The generated buildings as editable rectangles, for "Edit layout".
  const angleDeg = (angle * 180) / Math.PI;
  const buildingRects = autoBuildings.map((r) => {
    const [lat, lng] = proj.toLatLng(unrotate([(r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2], angle));
    return { center: [lng, lat], length: r.u1 - r.u0, depth: r.v1 - r.v0, angle: angleDeg };
  });

  return {
    metrics,
    geometry,
    limits: best.limits,
    warnings: best.warnings || { outside: [], overlaps: [] },
    buildingRects,
    proforma: proformaFor(type, s, metrics),
    error: null,
    type,
    settings: s,
  };
}

const SUM_KEYS = ['footprintSf', 'buildingCount', 'gsf', 'nsf', 'units', 'keys', 'docks', 'parkingRequired',
  'parkingSurface', 'parkingStructured', 'parkingGarage', 'parkingProvided'];

// The zoning check rows (#4): each limit against the plan's totals.
// status is pass, fail, or none (no limit set).
function zoningChecks(s, totals, warnings) {
  const fmt = (n, d = 2) => (n || 0).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
  const row = (label, limit, actual, ok) => ({ label, limit, actual, status: limit === null ? 'none' : (ok ? 'pass' : 'fail') });
  const rows = [
    row('Height', s.maxHeight > 0 ? `${fmt(s.maxHeight, 0)} ft` : null, `${fmt(totals.heightFt, 0)} ft`, totals.heightFt <= s.maxHeight + 1e-6),
    row('FAR', s.maxFar > 0 ? fmt(s.maxFar) : null, fmt(totals.far), totals.far <= s.maxFar + 1e-6),
    row('Lot coverage', s.maxCoverage > 0 ? `${fmt(s.maxCoverage, 0)}%` : null, `${fmt(totals.coverage * 100, 1)}%`, totals.coverage * 100 <= s.maxCoverage + 1e-6),
    {
      label: 'Parking',
      limit: `${fmt(totals.parkingRequired, 0)} required`,
      actual: `${fmt(totals.parkingProvided, 0)} provided`,
      status: totals.parkingProvided >= totals.parkingRequired ? 'pass' : 'fail',
    },
    {
      label: 'Setback',
      limit: `${fmt(s.setback, 0)} ft`,
      actual: warnings.outside.length ? `${warnings.outside.length} building${warnings.outside.length === 1 ? '' : 's'} over the line` : 'Clear',
      status: warnings.outside.length ? 'fail' : (s.setback > 0 ? 'pass' : 'none'),
    },
  ];
  if (warnings.overlaps.length) {
    rows.push({ label: 'Buildings overlap', limit: 'None', actual: `${warnings.overlaps.length} pair${warnings.overlaps.length === 1 ? '' : 's'}`, status: 'fail' });
  }
  return rows;
}

// Returns, for the main scheme: { metrics, geometry, limits, warnings,
// buildingRects, proforma, error }, plus spaces (each space's own
// result), totals (main + spaces), combined proforma, and zoning checks.
// geometry is ready for Leaflet ([lat, lng] rings).
export function solveScheme(boundary, scheme) {
  const spaces = (scheme.spaces || []).filter((sp) => sp.polygon);
  const main = solvePart(boundary, scheme, spaces.map((sp) => sp.polygon));
  if (!main.metrics) return { ...main, spaces: [], totals: null, checks: [] };

  // An asset space is solved only on the part of it inside the site:
  // the space minus whatever of it lies outside the boundary.
  const clipToSite = (polygon) => {
    try {
      const outside = subtract(toFeature(polygon), [boundary]);
      const inside = outside ? subtract(toFeature(polygon), [outside.geometry]) : toFeature(polygon);
      return inside && inside.geometry.type === 'Polygon' ? inside.geometry
        : inside && inside.geometry.type === 'MultiPolygon'
          ? { type: 'Polygon', coordinates: inside.geometry.coordinates.reduce((a, b) => (turfArea(turfPolygon(b)) > turfArea(turfPolygon(a)) ? b : a)) }
          : null;
    } catch {
      return null;
    }
  };
  const spaceResults = spaces.map((sp) => {
    const polygon = sp.kind === 'asset' ? clipToSite(sp.polygon) : null;
    return {
      id: sp.id,
      name: sp.name,
      kind: sp.kind,
      result: polygon ? solvePart(polygon, { assetType: sp.assetType, overrides: sp.overrides || {} }) : null,
    };
  });
  const parts = [main, ...spaceResults.map((sp) => sp.result).filter((r) => r && r.metrics)];

  const totals = Object.fromEntries(SUM_KEYS.map((k) => [k, parts.reduce((sum, p) => sum + (p.metrics[k] || 0), 0)]));
  totals.heightFt = Math.max(...parts.map((p) => p.metrics.heightFt || 0));
  totals.siteSf = main.metrics.siteSf;
  totals.siteAcres = main.metrics.siteAcres;
  totals.far = totals.siteSf > 0 ? totals.gsf / totals.siteSf : 0;
  totals.coverage = totals.siteSf > 0 ? totals.footprintSf / totals.siteSf : 0;
  totals.density = totals.siteAcres > 0 ? (totals.units + totals.keys) / totals.siteAcres : 0;

  return {
    ...main,
    spaces: spaceResults,
    totals,
    proforma: combineProformas(parts.map((p) => p.proforma).filter(Boolean)),
    checks: zoningChecks(main.settings, totals, main.warnings || { outside: [], overlaps: [] }),
  };
}
