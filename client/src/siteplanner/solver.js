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
import {
  analyzeAisle,
  distanceToRings,
  bestOrientation,
  fillBays,
  layBay,
  netStalls,
  parkingModule,
  rowReachesDrive,
  sharedRequirement,
  stallTypes,
} from './parking';

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
const TRAILER_WIDTH = 12;
const ONE_WAY_AISLE_DEFAULT = 16;

// A drawn aisle's width: its own, else the scheme's two-way aisle, else
// a one-way default.
export function aisleWidthOf(a, s) {
  return a.width || (a.twoWay === false ? ONE_WAY_AISLE_DEFAULT : s.aisleWidth);
}
// Floors are tried one count at a time, so the count is capped.
export const MAX_FLOORS = 100;

export const LIMIT_LABELS = {
  parking: 'Parking',
  far: 'FAR',
  coverage: 'Lot coverage',
  height: 'Height',
  site: 'Site size',
  manual: 'Placed by hand',
  trailers: 'Trailer parking',
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
    stallAngle: [45, 60, 90].includes(s.stallAngle) ? s.stallAngle : 90,
    aisle60: pos(s.aisle60, 8),
    aisle45: pos(s.aisle45, 8),
    perimeterDrive: s.perimeterDrive ? 1 : 0,
    islandEvery: Math.max(0, Math.round(s.islandEvery || 0)),
    endIslands: s.endIslands ? 1 : 0,
    compactPct: Math.min(100, pos(s.compactPct, 0)),
    compactWidth: pos(s.compactWidth, 1),
    evPct: Math.min(100, pos(s.evPct, 0)),
    sharedParking: s.sharedParking ? 1 : 0,
    trailerStallsPerDock: pos(s.trailerStallsPerDock, 0),
    trailerDepth: pos(s.trailerDepth, 10),
    levels: Math.min(20, Math.max(1, Math.round(s.levels || 1))),
    turnRadius: pos(s.turnRadius, 0),
    rampType: s.rampType ? 1 : 0,
    rampSlope: Math.min(30, pos(s.rampSlope, 1)),
    rampWidth: pos(s.rampWidth, 10),
    cores: Math.min(6, Math.max(0, Math.round(s.cores || 0))),
    coreSize: pos(s.coreSize, 5),
    parkingRotation: s.parkingRotation === 'auto' || !Number.isFinite(s.parkingRotation) ? 'auto' : s.parkingRotation,
    mix: mix && mix.length ? mix : null,
  };
}

// One double-loaded bay starting at v0, at the scheme's stall angle.
function parkingBay(pts, v0, s, mod = parkingModule(s)) {
  return layBay(asRings(pts), v0, s, mod);
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

// extraRaw: stalls laid out elsewhere (parking areas) that count toward
// this layout's requirement.
function barsLayouts(pts, s, type, siteSf, extraRaw = 0) {
  const D = s.buildingDepth;
  const mod = parkingModule(s);
  const P = mod.depth;
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
          for (let k = 0; (k + 1) * P <= D; k++) band.asParking.push(parkingBay(pts, band.v0 + k * P, s, mod));
          band.asParkingStalls = band.asParking.reduce((sum, b) => sum + b.stalls, 0);
        } else {
          band.bay = parkingBay(pts, band.v0, s, mod);
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
        const provided = netStalls(surface + extraRaw) + prog.structured;
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
          parkingSurface: netStalls(best.surface),
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

function industrialLayouts(pts, s, type, siteSf, extraRaw = 0) {
  const vs = asRings(pts).flat().map((p) => p[1]);
  const vmin = Math.min(...vs);
  const vmax = Math.max(...vs);
  const mod = parkingModule(s);
  const P = mod.depth;
  const heightFt = s.clearHeight + INDUSTRIAL_ROOF_ALLOWANCE;
  const tooTall = s.maxHeight > 0 && heightFt > s.maxHeight;
  const candidates = [];
  let unconstrained = null;

  // P car parking, B building, T truck court, R trailer stalls (backed
  // into from the truck court).
  const build = (sequence, depth) => {
    const bands = [];
    let v = vmin;
    for (const kind of sequence) {
      const d = { P, B: depth, T: s.truckCourt, R: s.trailerDepth }[kind];
      if (v + d > vmax) return null;
      bands.push({ kind, v0: v, v1: v + d });
      v += d;
    }
    while (v + P <= vmax) {
      bands.push({ kind: 'P', v0: v, v1: v + P });
      v += P;
    }
    const shapes = { buildings: [], parking: [], truckCourts: [], trailers: [] };
    let surface = 0;
    let docks = 0;
    let trailers = 0;
    for (const b of bands) {
      if (b.kind === 'P') {
        const bay = parkingBay(pts, b.v0, s, mod);
        shapes.parking.push(...bay.rows);
        surface += bay.stalls;
      } else if (b.kind === 'B') {
        for (const [a, c] of bandIntervals(pts, b.v0, b.v1, MIN_INDUSTRIAL_LENGTH)) {
          shapes.buildings.push({ u0: a, u1: c, v0: b.v0, v1: b.v1 });
          docks += Math.floor((c - a) / s.dockSpacing);
        }
      } else if (b.kind === 'R') {
        for (const [a, c] of bandIntervals(pts, b.v0, b.v1, 2 * TRAILER_WIDTH)) {
          const n = Math.floor((c - a) / TRAILER_WIDTH);
          shapes.trailers.push({ u0: a, u1: a + n * TRAILER_WIDTH, v0: b.v0, v1: b.v1, n });
          trailers += n;
        }
      } else if (s.truckCourt > 0) {
        for (const [a, c] of bandIntervals(pts, b.v0, b.v1, 50)) shapes.truckCourts.push({ u0: a, u1: c, v0: b.v0, v1: b.v1 });
      }
    }
    const footprint = areaOf(shapes.buildings);
    const required = Math.ceil((footprint / 1000) * s.parkingRatio - 1e-9);
    const trailerRequired = Math.ceil(docks * s.trailerStallsPerDock - 1e-9);
    const fails = zoningFails(s, siteSf, footprint, footprint);
    if (netStalls(surface + extraRaw) < required) fails.push('parking');
    if (trailers < trailerRequired) fails.push('trailers');
    if (tooTall && footprint > 0) fails.push('height');
    return { shapes, footprint, surface: netStalls(surface), required, docks, trailers, trailerRequired, fails };
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
      trailerStalls: r.trailers,
      trailerRequired: r.trailerRequired,
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
  const sequences = s.trailerStallsPerDock > 0
    ? [['P', 'B', 'T', 'R'], ['R', 'T', 'B', 'P'], ['P', 'B', 'T'], ['T', 'B', 'P']]
    : [['P', 'B', 'T'], ['T', 'B', 'P']];
  // Layouts that hold the trailer stalls come first; if none fits, the
  // best without them is used and the trailer shortfall is reported.
  const withoutTrailers = [];
  for (const depth of depths) {
    for (const sequence of sequences) {
      const r = build(sequence, depth);
      if (!r) continue;
      if (!unconstrained || r.footprint > unconstrained.footprint) unconstrained = r;
      if (!r.fails.length) candidates.push(toCandidate(r, []));
      else if (r.fails.every((f) => f === 'trailers')) withoutTrailers.push(toCandidate(r, []));
    }
  }
  if (!candidates.length) candidates.push(...withoutTrailers);

  // Name what stopped it growing: the constraints the biggest layout broke.
  const limits = unconstrained && unconstrained.fails.length ? [...unconstrained.fails] : ['site'];
  candidates.forEach((c) => { c.limits = limits; });
  if (!candidates.length) {
    const parkingOnly = build([], 0);
    if (parkingOnly) {
      candidates.push(toCandidate({ ...parkingOnly, shapes: { ...parkingOnly.shapes, buildings: [] }, footprint: 0, required: 0, docks: 0, trailers: 0, trailerRequired: 0 }, limits));
    }
  }
  return candidates;
}

const LAYOUTS = { bars: barsLayouts, lots: lotsLayouts, industrial: industrialLayouts };

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


// a ∩ b as a Feature (or null): a minus the part of a outside b.
function intersect(aGeom, bFeature) {
  const outside = subtract(toFeature(aGeom), [bFeature.geometry]);
  if (!outside) return toFeature(aGeom);
  return subtract(toFeature(aGeom), [outside.geometry]);
}

// The separate pieces of a Feature, each as rings ([outline, ...holes]).
function piecesOf(feature) {
  if (!feature || !feature.geometry) return [];
  const g = feature.geometry;
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  return [];
}

const DEG = Math.PI / 180;

function rectToLatLngs(r, angle, proj) {
  return [[r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1]].map((p) => proj.toLatLng(unrotate(p, angle)));
}

function rectToGeo(r, angle, proj) {
  const pts = rectToLatLngs(r, angle, proj).map(([lat, lng]) => [lng, lat]);
  return { type: 'Polygon', coordinates: [[...pts, pts[0]]] };
}

// A parking row on the map: its outline, stall stripes (leaning for
// angled stalls), landscape islands and accessible stalls.
function rowGeometry(row, proj) {
  const { mod } = row;
  const toLL = (p) => proj.toLatLng(unrotate(p, row.angle));
  const lean = mod.angle === 90 ? 0 : mod.proj / Math.tan(mod.angle * DEG);
  const start = row.u0 + mod.endLoss;
  const stalls = [];
  for (let k = 0; k <= row.n; k++) {
    const u = start + k * mod.pitch;
    stalls.push([[u, row.v0 + mod.proj], [u - lean, row.v0]].map(toLL));
    stalls.push([[u, row.v1 - mod.proj], [u - lean, row.v1]].map(toLL));
  }
  const slot = (i, side) => {
    const u = start + i * mod.pitch;
    const [edge, outer] = side === 'lower' ? [row.v0 + mod.proj, row.v0] : [row.v1 - mod.proj, row.v1];
    return [[u, edge], [u + mod.pitch, edge], [u + mod.pitch - lean, outer], [u - lean, outer]].map(toLL);
  };
  return {
    outline: [[row.u0, row.v0], [row.u1, row.v0], [row.u1, row.v1], [row.u0, row.v1]].map(toLL),
    stalls,
    islands: row.islands.flatMap((i) => [slot(i, 'lower'), slot(i, 'upper')]),
    ada: (row.adaSlots || []).map(({ i, side }) => slot(i, side)),
    connected: row.connected !== false,
  };
}

function trailerGeometry(r, angle, proj) {
  const toLL = (p) => proj.toLatLng(unrotate(p, angle));
  const stalls = [];
  for (let k = 0; k <= r.n; k++) stalls.push([[r.u0 + k * TRAILER_WIDTH, r.v0], [r.u0 + k * TRAILER_WIDTH, r.v1]].map(toLL));
  return { outline: rectToLatLngs(r, angle, proj), stalls };
}

const EMPTY_METRICS = {
  footprintSf: 0, buildingCount: 0, floors: 0, heightFt: 0, gsf: 0, nsf: 0, units: 0, unitsByType: [], keys: 0,
  docks: 0, trailerStalls: 0, trailerRequired: 0, parkingRequired: 0, parkingSurface: 0, parkingStructured: 0,
  parkingGarage: 0, parkingProvided: 0,
};

const better = (c, best) => !best || c.score > best.score + 1e-6
  || (Math.abs(c.score - best.score) <= 1e-6 && c.surplus > best.surplus);

// Whether a type's buildings can be placed by hand (bars and industrial;
// lots, parking-only and garages lay out their own way).
export function supportsManualLayout(type) {
  return type.mode === 'bars' || type.mode === 'industrial';
}

// Whether a type has surface parking the parking tools apply to.
export function hasSurfaceParking(type) {
  return type.mode === 'bars' || type.mode === 'industrial' || type.mode === 'parking';
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

// Hand-placed buildings: their footprints and program as drawn, and which
// break the setback (or sit on a space or parking area) or overlap.
// Parking is added by the caller.
function solveManual(checkRings, s, type, proj, placed) {
  const floorsOf = (b) => Math.min(MAX_FLOORS, Math.max(1, Math.round(b.floors || s.floors || 1)));
  const rects = placed.map((b) => ({ b, corners: buildingFeet(b, proj), floors: floorsOf(b) }));
  const footprint = rects.reduce((sum, r) => sum + r.b.length * r.b.depth, 0);
  const isIndustrial = type.mode === 'industrial';
  const gsf = isIndustrial ? footprint : rects.reduce((sum, r) => sum + r.b.length * r.b.depth * r.floors, 0);
  const maxFloors = isIndustrial ? (rects.length ? 1 : 0) : Math.max(0, ...rects.map((r) => r.floors));

  let prog;
  let docks = 0;
  if (isIndustrial) {
    const required = Math.ceil((footprint / 1000) * s.parkingRatio - 1e-9);
    prog = { gsf, nsf: gsf, units: 0, keys: 0, structured: 0, required };
    docks = placed.reduce((sum, b) => sum + Math.floor(Math.max(b.length, b.depth) / s.dockSpacing), 0);
  } else {
    prog = barsProgram(type, s, footprint, 1, gsf);
  }

  const podiumHeight = type.id === 'mf-podium' ? s.podiumLevels * PODIUM_LEVEL_HEIGHT : 0;
  const heightFt = isIndustrial
    ? (rects.length ? s.clearHeight + INDUSTRIAL_ROOF_ALLOWANCE : 0)
    : (rects.length ? podiumHeight + maxFloors * s.floorToFloor : 0);

  // Checked half a foot in from each edge, so a building converted from
  // the automatic layout (edges exactly on the setback, or touching a
  // neighbour, then rounded to whole feet) doesn't fail on rounding.
  const checkCorners = placed.map((b) => buildingFeet(b, proj, -CHECK_TOLERANCE));
  const outside = rects.filter((r, i) => !ringInsideShape(checkCorners[i], checkRings)).map((r) => r.b.id);
  const overlaps = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (convexOverlap(checkCorners[i], checkCorners[j])) overlaps.push([rects[i].b.id, rects[j].b.id]);
    }
  }

  return {
    score: prog.units || prog.keys || prog.nsf,
    surplus: 0,
    angle: placed.length ? placed[0].angle * DEG : 0,
    shapes: { parking: [] },
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
      parkingSurface: 0,
      parkingStructured: prog.structured,
      parkingGarage: 0,
      parkingProvided: prog.structured,
    },
    limits: ['manual'],
    warnings: { outside, overlaps },
  };
}

// The middle of the boundary's longest edge - where a street most likely
// runs, so the default driveway entry.
export function autoEntryPoint(boundary) {
  const ring = boundary.coordinates[0];
  const proj = makeProjection(ring);
  let best = null;
  for (let i = 0; i + 1 < ring.length; i++) {
    const a = proj.toFeet(ring[i]);
    const b = proj.toFeet(ring[i + 1]);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!best || len > best.len) best = { len, mid: [(ring[i][0] + ring[i + 1][0]) / 2, (ring[i][1] + ring[i + 1][1]) / 2] };
  }
  return best ? best.mid : ring[0];
}

function nearestPointOnRings(rings, [x, y]) {
  let best = null;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[(i + 1) % ring.length];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
      const p = [ax + t * dx, ay + t * dy];
      const d = Math.hypot(x - p[0], y - p[1]);
      if (!best || d < best.d) best = { d, p };
    }
  }
  return best;
}

const MIN_PARKING_PIECE_SF = 1500;

// A parking garage's typical level, laid out along its long side: two
// stair/elevator cores (or as many as set) in the corners, a cross aisle
// at each end, and either sloped floors (parking on the ramp: each bay
// climbs half a level over the length) or a separate express ramp along
// one long edge. Returns the bays, how many stalls a level holds, the
// drawing, and whether the ramp fits.
function garagePlan(region, regionRings, s, proj, levels = s.levels) {
  const angle = candidateAngles(regionRings)[0] || 0;
  const rotated = rotateRings(regionRings, angle);
  const us = rotated.flat().map((p) => p[0]);
  const vs = rotated.flat().map((p) => p[1]);
  const [umin, umax, vmin, vmax] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
  const longSide = umax - umin;
  const shortSide = vmax - vmin;
  const mod = parkingModule(s);
  const aisle = s.aisleWidth;
  const slope = s.rampSlope / 100;
  // Tested half a foot in, so a core or ramp flush with the garage's
  // edge still counts as inside.
  const inside = (r) => ringInsideShape(
    [[r.u0 + 0.5, r.v0 + 0.5], [r.u1 - 0.5, r.v0 + 0.5], [r.u1 - 0.5, r.v1 - 0.5], [r.u0 + 0.5, r.v1 - 0.5]],
    rotated
  );

  const cuts = [];
  const info = { rampType: s.rampType ? 'express' : 'sloped', slopePct: s.rampSlope, longSide, shortSide };
  let ramp = null;
  const arrows = [];
  if (levels <= 1) {
    // A single deck needs no ramp.
    info.rampType = 'none';
    info.required = 0;
    info.fits = true;
    info.note = null;
  } else if (s.rampType) {
    // Express ramp: one level's rise at the slope, plus a 12 ft
    // transition at each end, along a long edge.
    const run = s.floorToFloor / slope + 24;
    info.required = run + 2 * aisle;
    for (const v0 of [vmin, vmax - s.rampWidth]) {
      const r = { u0: umax - aisle - run, u1: umax - aisle, v0, v1: v0 + s.rampWidth };
      if (r.u0 >= umin + aisle && inside(r)) {
        ramp = r;
        break;
      }
    }
    info.fits = !!ramp;
    info.note = ramp ? null : `needs ${Math.round(run + 2 * aisle)} ft of length for the ramp and end aisles`;
    if (ramp) {
      cuts.push(ramp);
      const vm = (ramp.v0 + ramp.v1) / 2;
      arrows.push([[ramp.u0 + 4, vm], [ramp.u1 - 4, vm]]);
    }
  } else {
    // Sloped floors: a two-bay loop climbs a level per lap, so each bay
    // rises half a level along its length.
    const run = s.floorToFloor / 2 / slope;
    info.required = run + 2 * aisle;
    info.fits = longSide >= info.required && shortSide >= 2 * mod.depth;
    info.note = info.fits ? null
      : longSide < info.required ? `needs ${Math.round(info.required)} ft of length at ${s.rampSlope}%`
        : `needs ${Math.round(2 * mod.depth)} ft of width for two bays`;
    if (s.rampSlope > 6.67) {
      info.fits = false;
      info.note = 'parked-on ramps are limited to about 6.67%';
    }
    const mid = (vmin + vmax) / 2;
    arrows.push([[umin + aisle + 6, (vmin + mid) / 2], [umax - aisle - 6, (vmin + mid) / 2]]);
    arrows.push([[umax - aisle - 6, (mid + vmax) / 2], [umin + aisle + 6, (mid + vmax) / 2]]);
  }

  // Cores in the corners not taken by the ramp, then along the long sides.
  const c = s.coreSize;
  const spots = [
    { u0: umin, v0: vmax - c }, { u0: umax - c, v0: vmax - c }, { u0: umin, v0: vmin }, { u0: umax - c, v0: vmin },
    { u0: (umin + umax - c) / 2, v0: vmax - c }, { u0: (umin + umax - c) / 2, v0: vmin },
  ].map((p) => ({ ...p, u1: p.u0 + c, v1: p.v0 + c }));
  const overlapsRamp = (r) => ramp && r.u0 < ramp.u1 && r.u1 > ramp.u0 && r.v0 < ramp.v1 && r.v1 > ramp.v0;
  const cores = spots.filter((r) => !overlapsRamp(r) && inside(r)).slice(0, s.cores);
  cuts.push(...cores);

  // Cross aisles at both ends connect the bays.
  const endAisles = [
    { u0: umin, u1: umin + aisle, v0: vmin, v1: vmax },
    { u0: umax - aisle, u1: umax, v0: vmin, v1: vmax },
  ];
  cuts.push(...endAisles);

  let level = region;
  try {
    level = subtract(region, cuts.map((r) => rectToGeo(r, angle, proj)));
  } catch {
    level = null;
  }
  const levelRings = level ? ringsOf(level.geometry).map((r) => openRing(r).map(proj.toFeet)).filter((r) => r.length >= 3) : [];
  const { rows } = levelRings.length ? fillBays(rotateRings(levelRings, angle), s, mod) : { rows: [] };
  rows.forEach((r) => { r.angle = angle; });
  const perLevel = rows.reduce((sum, r) => sum + 2 * r.perSide, 0);

  const toLL = (p) => proj.toLatLng(unrotate(p, angle));
  return {
    angle,
    rows,
    perLevel,
    info,
    geometry: {
      outline: ringsOf(region.geometry).map((r) => openRing(r).map(([lng, lat]) => [lat, lng])),
      ramp: ramp ? rectToLatLngs(ramp, angle, proj) : null,
      cores: cores.map((r) => rectToLatLngs(r, angle, proj)),
      endAisles: endAisles.map((r) => rectToLatLngs(r, angle, proj)),
      arrows: arrows.map((line) => line.map(toLL)),
      rampLabel: levels <= 1 ? 'Single deck' : s.rampType ? `Express ramp · ${s.rampSlope}%` : `Sloped floors · ${s.rampSlope}% up`,
    },
  };
}

const noBoundary = { error: 'Draw the site boundary on the map to see a layout.', metrics: null, geometry: null, limits: [] };

// One part of a plan - the main scheme, or one space - on its own
// boundary, with cutouts (GeoJSON polygons) removed first. Parking areas
// and entries come from the scheme.
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
    parking: null,
    proforma: null,
    type,
    settings: s,
  });
  const feetRings = (feature) => ringsOf(feature.geometry).map((r) => openRing(r).map(proj.toFeet)).filter((r) => r.length >= 3);
  const latLngRings = (feature) => ringsOf(feature.geometry).map((r) => openRing(r).map(([lng, lat]) => [lat, lng]));

  let region;
  let inset;
  try {
    inset = insetSite(boundary, s.setback);
    region = inset ? subtract(inset, cutouts) : null;
  } catch {
    return { ...noBoundary, error: 'Couldn\'t work with that boundary - redraw it without crossing lines.', type, settings: s };
  }
  if (!region) return empty('The setback leaves no room to build.');
  const regionRings = feetRings(region);
  if (!regionRings.length) return empty('The setback leaves no room to build.');
  const buildableSf = shapeArea(regionRings);

  const setbackGeom = s.setback > 0 ? latLngRings(inset) : null;

  // ---- A parking garage fills its site: a typical level's bays, cores,
  // end aisles and ramp, stacked ----
  if (type.mode === 'garage') {
    const footprint = buildableSf;
    // Levels come down to fit the height and FAR limits.
    let levels = s.levels;
    const limits = [];
    if (s.maxHeight > 0 && levels * s.floorToFloor > s.maxHeight) {
      levels = Math.max(0, Math.floor(s.maxHeight / s.floorToFloor + 1e-9));
      limits.push('height');
    }
    if (s.maxFar > 0 && footprint * levels > s.maxFar * siteSf) {
      levels = Math.max(0, Math.floor((s.maxFar * siteSf) / footprint + 1e-9));
      limits.push('far');
    }
    const plan = garagePlan(region, regionRings, s, proj, levels);
    const raw = plan.perLevel * levels;
    const types = stallTypes(raw, s);
    const structured = types.total;
    const metrics = {
      ...base,
      ...EMPTY_METRICS,
      buildableSf,
      footprintSf: footprint,
      buildingCount: levels > 0 ? 1 : 0,
      floors: levels,
      heightFt: levels * s.floorToFloor,
      gsf: footprint * levels,
      parkingStructured: structured,
      parkingProvided: structured,
      far: siteSf > 0 ? (footprint * levels) / siteSf : 0,
      coverage: siteSf > 0 && levels > 0 ? footprint / siteSf : 0,
      density: 0,
      orientationDeg: Math.round(((plan.angle * 180) / Math.PI) * 10) / 10,
    };
    return {
      metrics,
      geometry: {
        setback: setbackGeom,
        buildings: [],
        garage: plan.geometry,
        parking: plan.rows.map((r) => rowGeometry(r, proj)),
        lots: [], streets: [], truckCourts: [], trailers: [], drives: plan.geometry.endAisles.map((r) => [r]), entryDrives: [], entries: [], aisleIssues: [],
      },
      limits: limits.length ? limits : ['site'],
      warnings: { outside: [], overlaps: [] },
      buildingRects: [],
      parking: null,
      garage: { ...plan.info, levels, perLevel: plan.perLevel, types, gsfPerStall: raw > 0 ? (footprint * levels) / raw : 0 },
      proforma: proformaFor(type, s, metrics),
      error: null,
      type,
      settings: s,
    };
  }

  const surfaceParking = hasSurfaceParking(type);
  const mod = parkingModule(s);
  const fixedParkingDeg = s.parkingRotation === 'auto' ? null : s.parkingRotation;

  // ---- Perimeter drive: a loop road just inside the setback ----
  let inner = region;
  let driveFeature = null;
  if (surfaceParking && s.perimeterDrive && s.aisleWidth > 0) {
    try {
      const shrunk = buffer(region, -s.aisleWidth, { units: 'feet' });
      if (shrunk && shrunk.geometry && feetRings(shrunk).length) {
        inner = shrunk;
        driveFeature = subtract(region, [shrunk.geometry]);
      }
    } catch {
      inner = region;
    }
  }
  // ---- Drive aisles drawn by hand: paved lines buildings and stalls stay
  // clear of, and rows can reach ----
  const aisleDefs = surfaceParking ? (scheme.driveAisles || []).filter((a) => a.line && a.line.coordinates && a.line.coordinates.length >= 2) : [];
  const aisles = [];
  for (const a of aisleDefs) {
    try {
      // Only the part inside the buildable ground counts (not across the
      // setback, off the site, or through a space).
      const buffered = buffer(toFeature(a.line), aisleWidthOf(a, s) / 2, { units: 'feet' });
      const f = buffered && buffered.geometry ? intersect(buffered.geometry, region) : null;
      if (f && f.geometry) aisles.push({ a, f, rings: feetRings(f) });
    } catch {
      // A line turf can't buffer is skipped.
    }
  }
  const aisleGeoms = aisles.map((x) => x.f.geometry);
  const perimeterEdge = driveFeature ? feetRings(inner) : [];
  const driveEdgeAll = [...perimeterEdge, ...aisles.flatMap((x) => x.rings)];
  const driveEdge = driveEdgeAll.length ? driveEdgeAll : null;
  const boundaryRings = [openRing(boundary.coordinates[0]).map(proj.toFeet)];
  // Reaching the setback line counts as reaching the street; ends inside
  // a space don't. Spaces are solved with the site's aisles but leave the
  // checking to the main plan.
  const setbackRings = s.setback > 0 ? feetRings(inset) : boundaryRings;
  const aisleIssues = !scheme.skipAisleChecks ? aisles.flatMap((x, i) => analyzeAisle(x.a.line.coordinates.map(proj.toFeet), {
    width: aisleWidthOf(x.a, s),
    twoWay: x.a.twoWay !== false,
    turnRadius: s.turnRadius,
    connectsTo: [...aisles.filter((_, j) => j !== i).flatMap((y) => y.rings), ...perimeterEdge, ...setbackRings, ...boundaryRings],
  }).map((issue) => ({ ...issue, aisleId: x.a.id }))) : [];
  const rotatedDrive = new Map();
  const reaches = (row, angle) => {
    if (!driveEdge) return true;
    if (!rotatedDrive.has(angle)) rotatedDrive.set(angle, rotateRings(driveEdge, angle));
    return rowReachesDrive(row, rotatedDrive.get(angle));
  };

  // Every separate piece of a Feature parked at its own best (or a fixed)
  // orientation. keepOnly drops rows that can't reach the drive; otherwise
  // they're kept and flagged.
  const parkPieces = (feature, pieceMod, fixedDeg, keepOnly, search = {}) => {
    const rows = [];
    for (const poly of piecesOf(feature)) {
      const rings = poly.map((r) => openRing(r).map(proj.toFeet)).filter((r) => r.length >= 3);
      if (!rings.length || shapeArea(rings) < MIN_PARKING_PIECE_SF) continue;
      const best = bestOrientation(rings, s, pieceMod, { ...search, fixedDeg, keep: keepOnly && driveEdge ? reaches : null });
      for (const r of best.rows) r.connected = reaches(r, r.angle);
      rows.push(...best.rows);
    }
    return rows;
  };

  // ---- Parking areas drawn by hand ----
  const placed = supportsManualLayout(type) ? (scheme.edits?.buildings || []) : [];
  const buildingCutouts = placed.map((b) => feetRingToGeo(buildingFeet(b, proj, BUILDING_CLEARANCE), proj));
  const areas = surfaceParking ? (scheme.parkingAreas || []).filter((a) => a.polygon) : [];
  const areaRows = [];
  for (const area of areas) {
    try {
      let f = intersect(area.polygon, inner);
      if (f && (buildingCutouts.length || aisleGeoms.length)) f = subtract(f, [...buildingCutouts, ...aisleGeoms]);
      if (!f) continue;
      const areaMod = parkingModule(s, area.stallAngle || s.stallAngle);
      const fixedDeg = Number.isFinite(area.angle) ? area.angle : fixedParkingDeg;
      const rows = parkPieces(f, areaMod, fixedDeg, false);
      rows.forEach((r) => { r.areaId = area.id; });
      areaRows.push(...rows);
    } catch {
      // A shape that can't be worked with is skipped; its outline still shows.
    }
  }
  const areaRaw = areaRows.reduce((sum, r) => sum + 2 * r.perSide, 0);

  // What the buildings (and their own parking) are laid out on.
  // A parking-area shape turf can't work with is left out rather than
  // failing the whole plan.
  const safeSubtract = (feature, cuts, fallback) => {
    try {
      return subtract(feature, cuts);
    } catch {
      return fallback;
    }
  };
  let layout = inner;
  if (areas.length || aisleGeoms.length) layout = safeSubtract(inner, [...areas.map((a) => a.polygon), ...aisleGeoms], inner);
  const layoutRings = layout ? feetRings(layout) : [];

  let best = null;
  let otherRows = [];
  if (placed.length) {
    const checkCuts = [...areas.map((a) => a.polygon), ...aisleGeoms];
    const checkRegion = checkCuts.length ? safeSubtract(region, checkCuts, region) : region;
    best = solveManual(checkRegion ? feetRings(checkRegion) : [], s, type, proj, placed);
    const parkRegion = layout ? safeSubtract(layout, buildingCutouts, null) : null;
    otherRows = parkRegion ? parkPieces(parkRegion, mod, fixedParkingDeg, false) : [];
  } else if (type.mode === 'parking') {
    otherRows = layout ? parkPieces(layout, mod, fixedParkingDeg, true) : [];
    best = {
      score: 0, surplus: 0, angle: 0, shapes: { parking: [] }, limits: ['site'],
      metrics: { ...EMPTY_METRICS },
    };
  } else if (layoutRings.length) {
    const angles = s.rotation === 'auto' || !Number.isFinite(s.rotation)
      ? candidateAngles(layoutRings)
      : [(s.rotation * Math.PI) / 180];
    for (const angle of angles) {
      for (const c of LAYOUTS[type.mode](rotateRings(layoutRings, angle), s, type, siteSf, areaRaw)) {
        if (better(c, best)) best = { ...c, angle };
      }
    }
  }
  if (!best) return empty('There\'s no room left to build once the parking areas are taken out.');

  const { angle, shapes } = best;
  const bandRows = (shapes.parking || []).map((r) => ({ ...r, angle, connected: reaches(r, angle) }));

  // Ground the bands left over (ends, wedges, corners) is parked at its own
  // best orientation; only rows that reach the drive are kept.
  let leftoverRows = [];
  if (!placed.length && type.mode !== 'parking' && type.mode !== 'lots' && surfaceParking && layout) {
    const grow = (r) => ({ u0: r.u0 - BUILDING_CLEARANCE, u1: r.u1 + BUILDING_CLEARANCE, v0: r.v0 - BUILDING_CLEARANCE, v1: r.v1 + BUILDING_CLEARANCE });
    const obstacles = [
      ...(shapes.buildings || []).map(grow),
      ...(shapes.parking || []),
      ...(shapes.truckCourts || []),
      ...(shapes.trailers || []),
    ].map((r) => rectToGeo(r, angle, proj));
    try {
      const leftover = obstacles.length ? subtract(layout, obstacles) : layout;
      if (leftover) leftoverRows = parkPieces(leftover, mod, fixedParkingDeg, true, { stepDeg: 15, extraAngles: [angle] });
    } catch {
      leftoverRows = [];
    }
  }

  const allRows = [...bandRows, ...leftoverRows, ...otherRows, ...areaRows];
  const rawStalls = allRows.reduce((sum, r) => sum + 2 * r.perSide, 0);

  // ---- Entries and accessible stalls ----
  const entries = surfaceParking
    ? (scheme.entries?.length ? scheme.entries.map((e) => ({ ...e, auto: false })) : [{ id: 'auto', point: autoEntryPoint(boundary), auto: true }])
    : [];
  const entryInfo = entries.map((e) => {
    const ef = proj.toFeet(e.point);
    const near = nearestPointOnRings(regionRings, ef);
    const reach = !driveEdge
      || (driveFeature && near && near.d <= s.setback + 30)
      || aisles.some((x) => distanceToRings(x.rings, ef) <= 30);
    let drive = null;
    if (driveFeature && near && near.d > 0.5) {
      const dx = (near.p[0] - ef[0]) / near.d;
      const dy = (near.p[1] - ef[1]) / near.d;
      const end = [near.p[0] + dx * s.aisleWidth, near.p[1] + dy * s.aisleWidth];
      const w = s.aisleWidth / 2;
      drive = [[ef[0] - dy * w, ef[1] + dx * w], [end[0] - dy * w, end[1] + dx * w], [end[0] + dy * w, end[1] - dx * w], [ef[0] + dy * w, ef[1] - dx * w]]
        .map((p) => proj.toLatLng(p));
    }
    return { id: e.id, auto: e.auto, point: e.point, feet: ef, reaches: reach, drive };
  });

  const types = stallTypes(rawStalls, s);
  let adaPlaced = 0;
  // Accessible stalls go in the rows nearest an entry, from the aisle end.
  if (types.ada > 0 && allRows.length) {
    const centre = (r) => {
      const mid = unrotate([(r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2], r.angle);
      return Math.min(...entryInfo.map((e) => Math.hypot(e.feet[0] - mid[0], e.feet[1] - mid[1])), Infinity);
    };
    let left = types.ada;
    for (const r of [...allRows].sort((a, b) => centre(a) - centre(b))) {
      if (left <= 0) break;
      const islands = new Set(r.islands);
      r.adaSlots = [];
      for (const side of ['lower', 'upper']) {
        for (let i = 0; i < r.n && left > 0; i++) {
          if (islands.has(i)) continue;
          r.adaSlots.push({ i, side });
          left--;
          adaPlaced++;
        }
      }
    }
  }

  const surface = netStalls(rawStalls);
  const m = { ...EMPTY_METRICS, ...best.metrics };
  if (surfaceParking) {
    m.parkingSurface = surface;
    m.parkingProvided = surface + (m.parkingStructured || 0) + (m.parkingGarage || 0);
  }
  const pavedRows = allRows.reduce((sum, r) => sum + (r.u1 - r.u0) * (r.v1 - r.v0), 0);
  const driveSf = (driveFeature ? turfArea(driveFeature) * SF_PER_SQM : 0)
    + aisles.reduce((sum, x) => sum + turfArea(x.f) * SF_PER_SQM, 0);
  const pavedSf = pavedRows + driveSf;
  const disconnected = allRows.filter((r) => r.connected === false).length;

  // The orientation most of the stalls face, for "Fixed angle".
  const byAngle = new Map();
  for (const r of allRows) byAngle.set(r.angle, (byAngle.get(r.angle) || 0) + r.perSide);
  const mainParkingAngle = [...byAngle.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? angle;

  const metrics = {
    ...base,
    ...m,
    buildableSf,
    far: siteSf > 0 ? m.gsf / siteSf : 0,
    coverage: siteSf > 0 ? m.footprintSf / siteSf : 0,
    density: base.siteAcres > 0 ? (m.units || m.keys) / base.siteAcres : 0,
    orientationDeg: Math.round(((type.mode === 'parking' ? mainParkingAngle : angle) * 180) / Math.PI * 10) / 10,
    parkingOrientationDeg: Math.round(((mainParkingAngle * 180) / Math.PI) * 10) / 10,
    parkingPavedSf: pavedSf,
  };

  const autoBuildings = shapes.buildings || [];
  const geometry = {
    setback: setbackGeom,
    buildings: best.buildingLatLngs || autoBuildings.map((r) => rectToLatLngs(r, angle, proj)),
    parking: allRows.map((r) => rowGeometry(r, proj)),
    lots: (shapes.lots || []).map((r) => rectToLatLngs(r, angle, proj)),
    streets: (shapes.streets || []).map((r) => rectToLatLngs(r, angle, proj)),
    truckCourts: (shapes.truckCourts || []).map((r) => rectToLatLngs(r, angle, proj)),
    trailers: (shapes.trailers || []).map((r) => trailerGeometry(r, angle, proj)),
    drives: [
      ...(driveFeature ? piecesOf(driveFeature) : []),
      ...aisles.flatMap((x) => piecesOf(x.f)),
    ].map((poly) => poly.map((ring) => openRing(ring).map(([lng, lat]) => [lat, lng]))),
    aisleIssues: aisleIssues.map((issue) => ({ latlng: proj.toLatLng(issue.at), text: issue.text, kind: issue.kind, aisleId: issue.aisleId })),
    entryDrives: entryInfo.map((e) => e.drive).filter(Boolean),
    entries: entryInfo.map((e) => ({ id: e.id, auto: e.auto, point: e.point, reaches: e.reaches })),
  };

  // The generated buildings as editable rectangles, for "Edit layout".
  const angleDeg = (angle * 180) / Math.PI;
  const buildingRects = autoBuildings.map((r) => {
    const [lat, lng] = proj.toLatLng(unrotate([(r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2], angle));
    return { center: [lng, lat], length: r.u1 - r.u0, depth: r.v1 - r.v0, angle: angleDeg };
  });

  const parking = surfaceParking ? {
    types,
    adaPlaced,
    rawStalls,
    pavedSf,
    sfPerStall: rawStalls > 0 ? pavedSf / rawStalls : 0,
    stallsPerAcre: pavedSf > 0 ? surface / (pavedSf / SF_PER_ACRE) : 0,
    disconnected,
    perimeterDrive: !!driveFeature,
    hasDrive: !!driveEdge,
    aisleCount: aisles.length,
    aisleIssues: aisleIssues.map((issue) => ({ aisleId: issue.aisleId, kind: issue.kind, text: issue.text })),
    entries: entryInfo.map((e) => ({ id: e.id, auto: e.auto, reaches: e.reaches })),
    areas: areas.map((a) => {
      const rows = areaRows.filter((r) => r.areaId === a.id);
      const dominant = rows.slice().sort((x, y) => y.perSide - x.perSide)[0];
      return {
        id: a.id,
        stalls: rows.reduce((sum, r) => sum + 2 * r.perSide, 0),
        orientationDeg: dominant ? Math.round(((dominant.angle * 180) / Math.PI) * 10) / 10 : null,
      };
    }),
    stallAngle: s.stallAngle,
  } : null;

  return {
    metrics,
    geometry,
    limits: best.limits,
    warnings: best.warnings || { outside: [], overlaps: [] },
    buildingRects,
    parking,
    proforma: proformaFor(type, s, metrics),
    error: null,
    type,
    settings: s,
  };
}

const SUM_KEYS = ['footprintSf', 'buildingCount', 'gsf', 'nsf', 'units', 'keys', 'docks', 'trailerStalls', 'trailerRequired',
  'parkingRequired', 'parkingSurface', 'parkingStructured', 'parkingGarage', 'parkingProvided', 'parkingPavedSf'];

// The zoning check rows (#4): each limit against the plan's totals.
// status is pass, fail, or none (no limit set).
function zoningChecks(s, totals, warnings, parkingParts) {
  const fmt = (n, d = 2) => (n || 0).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
  const row = (label, limit, actual, ok) => ({ label, limit, actual, status: limit === null ? 'none' : (ok ? 'pass' : 'fail') });
  const rows = [
    row('Height', s.maxHeight > 0 ? `${fmt(s.maxHeight, 0)} ft` : null, `${fmt(totals.heightFt, 0)} ft`, totals.heightFt <= s.maxHeight + 1e-6),
    row('FAR', s.maxFar > 0 ? fmt(s.maxFar) : null, fmt(totals.far), totals.far <= s.maxFar + 1e-6),
    row('Lot coverage', s.maxCoverage > 0 ? `${fmt(s.maxCoverage, 0)}%` : null, `${fmt(totals.coverage * 100, 1)}%`, totals.coverage * 100 <= s.maxCoverage + 1e-6),
    {
      label: 'Parking',
      limit: totals.sharedParking
        ? `${fmt(totals.parkingRequired, 0)} required (shared; ${fmt(totals.parkingRequiredRaw, 0)} separately)`
        : `${fmt(totals.parkingRequired, 0)} required`,
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
  const withSurface = parkingParts.filter((p) => p && p.rawStalls > 0);
  if (withSurface.length) {
    const drive = withSurface.some((p) => p.hasDrive);
    const disconnected = withSurface.reduce((sum, p) => sum + p.disconnected, 0);
    const badEntries = withSurface.flatMap((p) => p.entries.filter((e) => !e.reaches));
    const aisleProblems = withSurface.flatMap((p) => p.aisleIssues || []);
    rows.push({
      label: 'Circulation',
      limit: drive ? 'Every bay reaches a drive' : 'No drive (perimeter off, none drawn)',
      actual: !drive ? 'Not checked'
        : disconnected ? `${disconnected} bay${disconnected === 1 ? '' : 's'} can't reach one`
          : badEntries.length ? `${badEntries.length} entr${badEntries.length === 1 ? 'y doesn\'t' : 'ies don\'t'} reach a drive`
            : 'Connected',
      status: !drive ? 'none' : (disconnected || badEntries.length ? 'fail' : 'pass'),
    });
    if (aisleProblems.length) {
      const count = (k) => aisleProblems.filter((x) => x.kind === k).length;
      const parts = [
        count('turn') && `${count('turn')} tight turn${count('turn') === 1 ? '' : 's'}`,
        count('width') && `${count('width')} too narrow`,
        count('dead') && `${count('dead')} dead end${count('dead') === 1 ? '' : 's'}`,
      ].filter(Boolean);
      rows.push({ label: 'Drawn aisles', limit: `Turns ≥ ${fmt(s.turnRadius, 0)} ft radius, no dead ends`, actual: parts.join(', '), status: 'fail' });
    } else if (withSurface.some((p) => p.aisleCount > 0)) {
      rows.push({ label: 'Drawn aisles', limit: `Turns ≥ ${fmt(s.turnRadius, 0)} ft radius, no dead ends`, actual: 'Clear', status: 'pass' });
    }
    const ada = withSurface.reduce((sum, p) => sum + p.types.ada, 0);
    const van = withSurface.reduce((sum, p) => sum + p.types.van, 0);
    const placedAda = withSurface.reduce((sum, p) => sum + p.adaPlaced, 0);
    rows.push({
      label: 'Accessible stalls',
      limit: `${fmt(ada, 0)} required (${fmt(van, 0)} van)`,
      actual: `${fmt(placedAda, 0)} placed`,
      status: placedAda >= ada ? 'pass' : 'fail',
    });
  }
  if (totals.trailerRequired > 0 || totals.trailerStalls > 0) {
    rows.push({
      label: 'Trailer parking',
      limit: `${fmt(totals.trailerRequired, 0)} required`,
      actual: `${fmt(totals.trailerStalls, 0)} provided`,
      status: totals.trailerStalls >= totals.trailerRequired ? 'pass' : 'fail',
    });
  }
  return rows;
}

// Returns, for the main scheme: { metrics, geometry, limits, warnings,
// buildingRects, parking, proforma, error }, plus spaces (each space's
// own result), totals (main + spaces, with shared parking), combined
// proforma, and zoning checks. geometry is ready for Leaflet.
export function solveScheme(boundary, scheme) {
  const first = solveOnce(boundary, scheme);
  // With shared parking, the main layout can be planned against its share
  // of the stalls instead of its standalone need: solve it once more with
  // the parking ratio scaled by how much sharing saves, and keep that if
  // it builds more.
  const t = first.totals;
  if (t && t.sharedParking && t.parkingRequiredRaw > 0 && t.parkingRequired < t.parkingRequiredRaw && first.settings.parkingRatio > 0) {
    const ratio = t.parkingRequired / t.parkingRequiredRaw;
    const second = solveOnce(boundary, {
      ...scheme,
      overrides: { ...scheme.overrides, parkingRatio: first.settings.parkingRatio * ratio },
    }, { mainRequiredScale: 1 / ratio, baseOverrides: scheme.overrides });
    const passes = (r) => r.totals && r.totals.parkingProvided >= r.totals.parkingRequired;
    if (passes(second) && (second.totals.units + second.totals.keys + second.totals.gsf / 1e6) > (t.units + t.keys + t.gsf / 1e6)) return second;
  }
  return first;
}

// One solve of the whole plan. mainRequiredScale undoes a scaled parking
// ratio so the main part reports its standalone requirement; baseOverrides
// are the scheme's own settings (for what the panel shows).
function solveOnce(boundary, scheme, { mainRequiredScale = 1, baseOverrides = null } = {}) {
  const spaces = (scheme.spaces || []).filter((sp) => sp.polygon);
  const main = solvePart(boundary, scheme, spaces.map((sp) => sp.polygon));
  if (!main.metrics) return { ...main, spaces: [], totals: null, checks: [] };
  if (mainRequiredScale !== 1) {
    main.metrics = { ...main.metrics, parkingRequired: Math.ceil(main.metrics.parkingRequired * mainRequiredScale - 1e-9) };
    if (baseOverrides) main.settings = { ...main.settings, parkingRatio: sanitize(effectiveSettings({ ...scheme, overrides: baseOverrides })).parkingRatio };
  }

  // An asset space is solved only on the part of it inside the site:
  // the space minus whatever of it lies outside the boundary.
  const clipToSite = (polygon) => {
    try {
      const inside = intersect(polygon, toFeature(boundary));
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
      // The site's own loop road already runs around a space (its cutout
      // is ringed too), so a space has no perimeter drive of its own unless
      // its settings ask for one.
      result: polygon
        ? solvePart(polygon, {
          assetType: sp.assetType,
          overrides: { perimeterDrive: 0, ...(sp.overrides || {}) },
          driveAisles: scheme.driveAisles,
          skipAisleChecks: true,
        })
        : null,
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

  // Mixed uses can share stalls by time of day.
  const req = parts.map((p) => ({ typeId: p.type.id, required: p.metrics.parkingRequired || 0 }));
  const shared = main.settings.sharedParking ? sharedRequirement(req) : { required: totals.parkingRequired, raw: totals.parkingRequired, shared: false };
  totals.parkingRequiredRaw = shared.raw;
  totals.parkingRequired = shared.required;
  totals.sharedParking = shared.shared;

  const parkingParts = parts.map((p) => p.parking).filter(Boolean);
  totals.stallTypes = ['total', 'standard', 'compact', 'ada', 'van', 'ev']
    .reduce((acc, k) => ({ ...acc, [k]: parkingParts.reduce((sum, p) => sum + p.types[k], 0) }), {});
  const rawStalls = parkingParts.reduce((sum, p) => sum + p.rawStalls, 0);
  totals.sfPerStall = rawStalls > 0 ? totals.parkingPavedSf / rawStalls : 0;
  totals.stallsPerAcre = totals.parkingPavedSf > 0 ? totals.parkingSurface / (totals.parkingPavedSf / SF_PER_ACRE) : 0;

  return {
    ...main,
    spaces: spaceResults,
    totals,
    proforma: combineProformas(parts.map((p) => p.proforma).filter(Boolean)),
    checks: [
      ...zoningChecks(main.settings, totals, main.warnings || { outside: [], overlaps: [] }, parkingParts),
      ...parts.filter((p) => p.garage).map((p) => ({
        label: 'Garage ramp',
        limit: p.garage.rampType === 'none' ? 'Single deck - no ramp' : `${p.garage.rampType === 'express' ? 'Express ramp' : 'Sloped floors'} at ${p.garage.slopePct}%`,
        actual: p.garage.fits ? `Fits (${Math.round(p.garage.longSide)} ft long)` : `Doesn't fit: ${p.garage.note}`,
        status: p.garage.fits ? 'pass' : 'fail',
      })),
    ],
  };
}
