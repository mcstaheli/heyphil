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
import { bedsBaths, effectiveSettings, getAssetType } from './assetTypes';
import {
  asRings,
  bandIntervals,
  candidateAngles,
  convexOverlap,
  makeProjection,
  openRing,
  ringInsideShape,
  rotate,
  rotateRings,
  shapeArea,
  unrotate,
} from './geometry';
import { combineProformas, proformaFor } from './proforma';
import { routeAisles } from './routing';
import { insetByEdges, setbackNear, siteEdges } from './envelope';
import { FALLBACK, buildingProgram, largestRect, placedPieces, placedWings, shapeKey, shapeMinimum, shapeWings } from './buildings';
import {
  analyzeAisle,
  distanceToRings,
  bestOrientation,
  fillBays,
  layBay,
  netStalls,
  parkingModule,
  rowEndPoints,
  rowEnds,
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
const MAX_ROUTED_AISLES = 60;

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
  density: 'Density',
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
  const mix = Array.isArray(s.mix)
    ? s.mix.filter((u) => u.size > 0 && u.pct > 0).map((u) => ({ ...u, ...bedsBaths(u) }))
    : null;
  return {
    ...s,
    setback: pos(s.setback, 0),
    setbackMode: s.setbackMode === 1 ? 1 : 0,
    frontSetback: pos(s.frontSetback, 0),
    rearSetback: pos(s.rearSetback, 0),
    frontEdge: Math.max(0, Math.round(s.frontEdge || 0)),
    frontEdge2: Math.max(0, Math.round(s.frontEdge2 || 0)),
    maxDensity: pos(s.maxDensity, 0),
    stepbackAbove: Math.min(MAX_FLOORS, Math.max(0, Math.round(s.stepbackAbove || 0))),
    stepbackDepth: pos(s.stepbackDepth, 0),
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
    parkingFixed: Math.max(0, Math.round(s.parkingFixed || 0)),
    targetYield: pos(s.targetYield, 0),
    maxHeight: pos(s.maxHeight, 0),
    maxFar: pos(s.maxFar, 0),
    maxCoverage: pos(s.maxCoverage, 0),
    stallAngle: [45, 60, 90].includes(s.stallAngle) ? s.stallAngle : 90,
    aisle60: pos(s.aisle60, 8),
    aisle45: pos(s.aisle45, 8),
    perimeterDrive: s.perimeterDrive ? 1 : 0,
    autoAisles: s.autoAisles ? 1 : 0,
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
    // 0 sloped floors, 1 express, 2 helix; older saves stored true/'1'
    // for express.
    rampType: [0, 1, 2].includes(Number(s.rampType)) ? Number(s.rampType) : (s.rampType ? 1 : 0),
    helixRadius: pos(s.helixRadius, 10),
    yardDepth: pos(s.yardDepth, 0),
    minTruckCourt: pos(s.minTruckCourt, 0),
    truckAisleWidth: pos(s.truckAisleWidth, 0),
    truckTurnRadius: pos(s.truckTurnRadius, 0),
    whiteSpacePct: Math.min(100, pos(s.whiteSpacePct, 0)),
    wattsPerSf: pos(s.wattsPerSf, 0),
    generatorMw: pos(s.generatorMw, 0.1),
    redundancyPct: pos(s.redundancyPct, 0),
    rampSlope: Math.min(30, pos(s.rampSlope, 1)),
    rampWidth: pos(s.rampWidth, 10),
    cores: Math.min(6, Math.max(0, Math.round(s.cores || 0))),
    coreSize: pos(s.coreSize, 5),
    parkingRotation: s.parkingRotation === 'auto' || !Number.isFinite(s.parkingRotation) ? 'auto' : s.parkingRotation,
    buildingShape: Math.min(6, Math.max(0, Math.round(s.buildingShape || 0))),
    corridorWidth: pos(s.corridorWidth, 3),
    courtyardMin: pos(s.courtyardMin, 20),
    stairSpacing: pos(s.stairSpacing, 60),
    unitsPerElevator: pos(s.unitsPerElevator, 10),
    amenitySf: pos(s.amenitySf, 0),
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

// Stalls a use needs: the number set by hand (parkingFixed), else the
// ratio on its count (units, keys, or thousands of sf).
function parkingNeed(s, count) {
  return s.parkingFixed > 0 ? s.parkingFixed : Math.ceil(count * s.parkingRatio - 1e-9);
}

// count: units or keys, for the density limit.
function zoningFails(s, siteSf, gsf, footprint, count = 0) {
  const fails = [];
  if (s.maxDensity > 0 && count > densityCap(s, siteSf)) fails.push('density');
  if (s.maxFar > 0 && gsf > s.maxFar * siteSf + 1e-6) fails.push('far');
  if (s.maxCoverage > 0 && footprint > (s.maxCoverage / 100) * siteSf + 1e-6) fails.push('coverage');
  return fails;
}

// The most units (or keys) the density limit allows on siteSf.
function densityCap(s, siteSf) {
  return s.maxDensity > 0 ? Math.floor((s.maxDensity * siteSf) / SF_PER_ACRE + 1e-9) : Infinity;
}

// ---- Bars: building bars alternating with parking bays -----------------

// gsf defaults to footprint x floors; hand-placed buildings with their
// own floor counts pass it in.
function barsProgram(type, s, footprint, floors, gsf = footprint * floors) {
  const out = { gsf, nsf: 0, units: 0, keys: 0, structured: 0, required: 0, score: 0 };
  if (type.yieldKind === 'units') {
    out.nsf = (gsf * s.efficiency) / 100;
    out.units = s.mix ? Math.floor(out.nsf / mixAverage(s.mix)) : 0;
    out.required = parkingNeed(s, out.units);
    out.score = out.units;
  } else if (type.yieldKind === 'keys') {
    out.keys = Math.floor(gsf / s.grossPerKey);
    out.required = parkingNeed(s, out.keys);
    out.score = out.keys;
  } else {
    out.nsf = (gsf * s.efficiency) / 100;
    out.required = parkingNeed(s, out.nsf / 1000);
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
        const fails = zoningFails(s, siteSf, prog.gsf, footprint, prog.units + prog.keys);
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
      if (densityCap(s, siteSf) < units) { units = densityCap(s, siteSf); limits.push('density'); }
      if (s.maxCoverage > 0 && homeFootprint > 0) {
        const cap = Math.floor(((s.maxCoverage / 100) * siteSf) / homeFootprint);
        if (cap < units) { units = cap; limits.push('coverage'); }
      }
      const garage = units * s.garageStalls;
      const required = parkingNeed(s, units);
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
    const required = parkingNeed(s, footprint / 1000);
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

// ---- Shaped multifamily: L, U, courtyard, double courtyard, wrap ----

const MAX_SHAPED_BUILDINGS = 4;
const GARDEN_MAX_LENGTH = 160; // ft, a walk-up with breezeway stairs
const GARDEN_GAP = 40;

// Multifamily types get units laid out floor by floor.
export function isUnitLayout(type) {
  return type.yieldKind === 'units' && type.mode === 'bars';
}
const WRAP_RAMP_SHARE = 0.9; // of a wrapped garage level's stalls, after its ramps

// The largest of the chosen shape that fits, then more (each at least 40%
// of the first) in what's left, a building gap apart; a shape that won't
// fit steps down to a simpler one. Units come from laying out each
// building's floors (buildings.js). cutRects(rects) gives the ground left
// once those rectangles (rotated frame) are taken out.
function shapedLayouts(pts, s, type, siteSf, extraRaw = 0, helpers = {}) {
  const wanted = shapeKey(s.buildingShape);
  const D = s.buildingDepth;
  const mod = parkingModule(s);
  const podiumHeight = type.id === 'mf-podium' ? s.podiumLevels * PODIUM_LEVEL_HEIGHT : 0;
  let floorsMax = Math.max(1, s.floors);
  const limits = [];
  if (s.maxHeight > 0) {
    const allowed = Math.floor((s.maxHeight - podiumHeight) / s.floorToFloor + 1e-9);
    if (allowed < floorsMax) {
      floorsMax = Math.max(0, allowed);
      limits.push('height');
    }
  }
  if (!s.mix || floorsMax < 1) return [];

  // Place buildings one at a time.
  const placed = [];
  let rings = asRings(pts);
  for (let k = 0; k < MAX_SHAPED_BUILDINGS && rings.length; k++) {
    let shape = wanted;
    let rect = null;
    while (shape && shape !== 'bars') {
      const [minW, minH] = shapeMinimum(shape, D, s.courtyardMin);
      const cap = Math.max(s.maxBuildingLength, minW, minH);
      // Shapes are laid out along u; the other way round is the
      // perpendicular candidate angle's turn.
      rect = largestRect(rings, { minW, minH, maxW: cap, maxH: cap });
      if (rect) break;
      shape = FALLBACK[shape];
    }
    if (!rect || (placed.length && rect.area < 0.4 * placed[0].rect.area)) break;
    const { wings, middle } = shapeWings(shape, rect, D);
    placed.push({ shape, rect, wings, middle });
    const g = s.buildingGap;
    rings = helpers.cutRects ? helpers.cutRects(placed.map((b) => ({ u0: b.rect.u0 - g, u1: b.rect.u1 + g, v0: b.rect.v0 - g, v1: b.rect.v1 + g }))) : [];
  }
  if (!placed.length) return [];

  const candidates = [];
  for (let n = placed.length; n >= 1; n--) {
    const use = placed.slice(0, n);
    const g = s.buildingGap;
    const left = helpers.cutRects ? helpers.cutRects(use.map((b) => ({ u0: b.rect.u0 - g, u1: b.rect.u1 + g, v0: b.rect.v0 - g, v1: b.rect.v1 + g }))) : [];
    const bays = left.length ? fillBays(left, s, mod) : { rows: [], stalls: 0 };
    // A wrapped garage fills the middle of a wrap, one level per floor.
    const garageLevel = use.map((b) => (b.shape === 'wrap' && b.middle ? fillBays([[[b.middle.u0, b.middle.v0], [b.middle.u1, b.middle.v0], [b.middle.u1, b.middle.v1], [b.middle.u0, b.middle.v1]]], s, mod).stalls : 0));
    const footprint = use.reduce((t, b) => t + b.wings.reduce((x, w) => x + (w.u1 - w.u0) * (w.v1 - w.v0), 0), 0);
    // A wrapped garage is a structure too: it counts toward lot coverage.
    const garageSf = use.reduce((t, b) => t + (b.shape === 'wrap' && b.middle ? (b.middle.u1 - b.middle.u0) * (b.middle.v1 - b.middle.v0) : 0), 0);
    for (let floors = floorsMax; floors >= 1; floors--) {
      const programs = use.map((b) => buildingProgram(b.wings, s, s.mix, floors));
      if (programs.some((p) => !p)) continue;
      const units = programs.reduce((t, p) => t + p.units, 0);
      const nsf = programs.reduce((t, p) => t + p.nrsf, 0);
      const gsf = footprint * floors;
      const structured = garageLevel.reduce((t, st) => t + Math.floor(st * floors * WRAP_RAMP_SHARE), 0)
        + (type.id === 'mf-podium' ? Math.floor((footprint * s.podiumLevels) / s.sfPerStructuredStall) : 0);
      const required = parkingNeed(s, units);
      const provided = netStalls(bays.stalls + extraRaw) + structured;
      const fails = zoningFails(s, siteSf, gsf, footprint + garageSf, units);
      if (provided < required) fails.push('parking');
      if (fails.length) {
        if (n === placed.length && floors === floorsMax) limits.push(...fails);
        continue;
      }
      const byType = s.mix.map((u, i) => programs.reduce((t, p) => t + p.byType[i], 0));
      candidates.push({
        score: units,
        surplus: provided - required,
        shapes: {
          buildings: use.flatMap((b) => b.wings.map((w) => ({ u0: w.u0, u1: w.u1, v0: w.v0, v1: w.v1 }))),
          parking: bays.rows,
          courtyards: use.filter((b) => b.middle).map((b) => b.middle),
          garages: use.filter((b) => b.shape === 'wrap' && b.middle).map((b) => b.middle),
        },
        unitPlans: use.map((b, i) => ({ shape: b.shape, wings: b.wings, plan: programs[i].plan, elevators: programs[i].elevators })),
        shapesUsed: use.map((b) => b.shape),
        metrics: {
          footprintSf: footprint + garageSf,
          buildingCount: use.length,
          floors,
          heightFt: podiumHeight + floors * s.floorToFloor,
          gsf,
          nsf,
          units,
          unitsByType: s.mix.map((u, i) => ({ name: u.name, size: u.size, count: byType[i] })),
          keys: 0,
          parkingRequired: required,
          parkingSurface: netStalls(bays.stalls),
          parkingStructured: structured,
          parkingGarage: 0,
          parkingProvided: provided,
        },
        limits: [],
      });
      break; // the most floors that work for this many buildings
    }
  }
  const why = [...new Set(limits)];
  candidates.forEach((c) => { c.limits = why.length ? why : ['site']; });
  return candidates;
}

// ---- Data center: a deep data hall, its equipment yard, and parking ----

// IT load (MW) and generators for a gross floor area.
export function dataCenterProgram(gsf, s) {
  const itMw = (gsf * (s.whiteSpacePct / 100) * s.wattsPerSf) / 1e6;
  const generators = itMw > 0 ? Math.ceil((itMw * (1 + s.redundancyPct / 100)) / s.generatorMw) : 0;
  return { itMw, generators };
}

function dataCenterLayouts(pts, s, type, siteSf, extraRaw = 0) {
  const vs = asRings(pts).flat().map((p) => p[1]);
  const vmin = Math.min(...vs);
  const vmax = Math.max(...vs);
  const mod = parkingModule(s);
  const P = mod.depth;
  let floors = Math.max(1, s.floors);
  const limits = [];
  if (s.maxHeight > 0 && floors * s.floorToFloor > s.maxHeight) {
    floors = Math.max(0, Math.floor(s.maxHeight / s.floorToFloor + 1e-9));
    limits.push('height');
  }
  const candidates = [];
  let unconstrained = null;
  const lo = Math.min(s.minBuildingDepth, s.maxBuildingDepth);
  const hi = Math.max(s.minBuildingDepth, s.maxBuildingDepth);
  const depths = [];
  for (let d = lo; d < hi; d += INDUSTRIAL_DEPTH_STEP) depths.push(d);
  depths.push(hi);
  for (const depth of depths) {
    for (const sequence of [['P', 'B', 'Y'], ['Y', 'B', 'P']]) {
      const bands = [];
      let v = vmin;
      let fits = true;
      for (const kind of sequence) {
        const d = { P, B: depth, Y: s.yardDepth }[kind];
        if (v + d > vmax) { fits = false; break; }
        bands.push({ kind, v0: v, v1: v + d });
        v += d;
      }
      if (!fits) continue;
      while (v + P <= vmax) {
        bands.push({ kind: 'P', v0: v, v1: v + P });
        v += P;
      }
      const shapes = { buildings: [], parking: [], yards: [] };
      let surface = 0;
      for (const b of bands) {
        if (b.kind === 'P') {
          const bay = parkingBay(pts, b.v0, s, mod);
          shapes.parking.push(...bay.rows);
          surface += bay.stalls;
        } else if (b.kind === 'B') {
          for (const [a, c] of bandIntervals(pts, b.v0, b.v1, MIN_INDUSTRIAL_LENGTH)) shapes.buildings.push({ u0: a, u1: c, v0: b.v0, v1: b.v1 });
        } else if (s.yardDepth > 0) {
          for (const [a, c] of bandIntervals(pts, b.v0, b.v1, 50)) shapes.yards.push({ u0: a, u1: c, v0: b.v0, v1: b.v1 });
        }
      }
      const footprint = floors > 0 ? areaOf(shapes.buildings) : 0;
      if (!floors) shapes.buildings = [];
      const gsf = footprint * floors;
      const { itMw, generators } = dataCenterProgram(gsf, s);
      const required = parkingNeed(s, gsf / 1000);
      const provided = netStalls(surface + extraRaw);
      const fails = zoningFails(s, siteSf, gsf, footprint);
      if (provided < required) fails.push('parking');
      const c = {
        score: itMw,
        surplus: provided - required,
        shapes,
        metrics: {
          footprintSf: footprint,
          buildingCount: shapes.buildings.length,
          floors: footprint > 0 ? floors : 0,
          heightFt: footprint > 0 ? floors * s.floorToFloor : 0,
          gsf,
          nsf: gsf * (s.whiteSpacePct / 100),
          units: 0,
          unitsByType: [],
          keys: 0,
          itMw,
          generators,
          parkingRequired: required,
          parkingSurface: netStalls(surface),
          parkingStructured: 0,
          parkingGarage: 0,
          parkingProvided: netStalls(surface),
        },
        fails,
      };
      if (!unconstrained || c.score > unconstrained.score) unconstrained = c;
      if (!fails.length) candidates.push(c);
    }
  }
  const why = [...(unconstrained && unconstrained.fails.length ? unconstrained.fails : []), ...limits];
  candidates.forEach((c) => { c.limits = why.length ? why : ['site']; });
  // Nothing passes: show the ground as parking, with what stopped it.
  if (!candidates.length) {
    const rows = [];
    let surface = 0;
    for (let v = vmin; v + P <= vmax; v += P) {
      const bay = parkingBay(pts, v, s, mod);
      rows.push(...bay.rows);
      surface += bay.stalls;
    }
    candidates.push({
      score: 0,
      surplus: 0,
      shapes: { buildings: [], parking: rows, yards: [] },
      metrics: {
        footprintSf: 0, buildingCount: 0, floors: 0, heightFt: 0, gsf: 0, nsf: 0, units: 0, unitsByType: [], keys: 0,
        itMw: 0, generators: 0, parkingRequired: 0, parkingSurface: netStalls(surface), parkingStructured: 0, parkingGarage: 0, parkingProvided: netStalls(surface),
      },
      limits: why.length ? why : ['site'],
    });
  }
  return candidates;
}

const LAYOUTS = { bars: barsLayouts, lots: lotsLayouts, industrial: industrialLayouts, datacenter: dataCenterLayouts };

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

// The stall slot of a row under a point (feet): { i, side }, or null for
// the aisle, an island or outside the row. Angled stalls lean, so the
// slot is found along the stall's own slant.
function slotAt(row, pt) {
  const [u, v] = rotate([pt], row.angle)[0];
  const { mod } = row;
  if (u < row.u0 || u > row.u1 || v < row.v0 || v > row.v1) return null;
  const dir = row.dir || 1;
  const lean = mod.angle === 90 ? 0 : (mod.proj / Math.tan(mod.angle * DEG)) * dir;
  const start = dir > 0 ? row.u0 + mod.endLoss : row.u0;
  let side;
  let uAdj;
  if (v <= row.v0 + mod.proj) {
    side = 'lower';
    uAdj = u + (lean * (row.v0 + mod.proj - v)) / mod.proj;
  } else if (v >= row.v1 - mod.proj) {
    side = 'upper';
    uAdj = u + (lean * (v - (row.v1 - mod.proj))) / mod.proj;
  } else {
    return null;
  }
  const i = Math.floor((uAdj - start) / mod.pitch);
  if (i < 0 || i >= row.n || row.islands.includes(i)) return null;
  return { i, side };
}

// Stalls changed by hand: each edit lands on the stall under its point,
// wherever the layout now puts one (an edit with no stall under it waits).
// Sets row.marks (slot -> kind) and row.removed.
function applyStallEdits(rows, edits, proj) {
  for (const r of rows) {
    r.marks = new Map();
    r.removed = new Set();
  }
  for (const e of edits) {
    const pt = proj.toFeet(e.point);
    for (const r of rows) {
      const slot = slotAt(r, pt);
      if (!slot) continue;
      const key = `${slot.i}:${slot.side}`;
      r.marks.set(key, e.kind);
      if (e.kind === 'removed') r.removed.add(key);
      else r.removed.delete(key);
      break;
    }
  }
}

// A parking row on the map: its outline, stall stripes (leaning for
// angled stalls), landscape islands and accessible stalls.
function rowGeometry(row, proj) {
  const { mod } = row;
  const toLL = (p) => proj.toLatLng(unrotate(p, row.angle));
  // Angled stalls lean back against the flow; a row flowing toward -u
  // leans the other way, with the room for it at the other end.
  const dir = row.dir || 1;
  const lean = mod.angle === 90 ? 0 : (mod.proj / Math.tan(mod.angle * DEG)) * dir;
  const start = dir > 0 ? row.u0 + mod.endLoss : row.u0;
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
  // One-way rows get an arrow down the aisle, head at the way out.
  let flow = null;
  if (row.dir) {
    const vmid = row.v0 + mod.proj + mod.aisle / 2;
    const [from, to] = row.dir > 0 ? [row.u0 + 6, row.u1 - 6] : [row.u1 - 6, row.u0 + 6];
    const back = to - row.dir * 7;
    flow = {
      line: [[from, vmid], [to, vmid]].map(toLL),
      head: [[back, vmid - 4], [to, vmid], [back, vmid + 4]].map(toLL),
    };
  }
  // Every stall, for clicking one on the map: its outline, middle and
  // what it is (standard, compact, ev, ada, van, removed) and whether
  // that was set by hand.
  const adaKind = new Map((row.adaSlots || []).map(({ i, side, van }) => [`${i}:${side}`, van ? 'van' : 'ada']));
  const slots = [];
  const islandSet = new Set(row.islands);
  for (const side of ['lower', 'upper']) {
    for (let i = 0; i < row.n; i++) {
      if (islandSet.has(i)) continue;
      const key = `${i}:${side}`;
      const ring = slot(i, side);
      const center = [ring.reduce((t, p) => t + p[0], 0) / 4, ring.reduce((t, p) => t + p[1], 0) / 4];
      const mark = row.marks ? row.marks.get(key) : undefined;
      slots.push({ ring, center, kind: mark || adaKind.get(key) || 'standard', byHand: !!mark });
    }
  }
  return {
    outline: [[row.u0, row.v0], [row.u1, row.v0], [row.u1, row.v1], [row.u0, row.v1]].map(toLL),
    stalls,
    islands: [
      ...row.islands.flatMap((i) => [slot(i, 'lower'), slot(i, 'upper')]),
      ...[...(row.removed || [])].map((k) => { const [i, side] = k.split(':'); return slot(Number(i), side); }),
    ],
    ada: (row.adaSlots || []).map(({ i, side }) => slot(i, side)),
    van: (row.adaSlots || []).filter((x) => x.van).map(({ i, side }) => slot(i, side)),
    ev: slots.filter((x) => x.kind === 'ev').map((x) => x.ring),
    compact: slots.filter((x) => x.kind === 'compact' && x.byHand).map((x) => x.ring),
    slots,
    connected: row.connected !== false,
    flow,
    // For the selection bar: stalls (both sides, less islands), the stall
    // angle and which way the bay runs.
    stallCount: 2 * row.n - 2 * row.islands.length - (row.removed ? row.removed.size : 0),
    stallAngle: mod.angle,
    angleDeg: Math.round(((row.angle * 180) / Math.PI) * 10) / 10,
    angleExact: (row.angle * 180) / Math.PI,
    oneWay: !!row.dir,
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
  parkingGarage: 0, parkingProvided: 0, itMw: 0, generators: 0,
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
  return type.mode === 'bars' || type.mode === 'industrial' || type.mode === 'parking' || type.mode === 'datacenter';
}

// A hand-placed building's pieces (one rectangle, or an L / U /
// courtyard's wings), each as corners in local feet, grown by grow.
function buildingFeet(b, proj, grow = 0) {
  const [cx, cy] = proj.toFeet(b.center);
  return placedPieces(b, cx, cy, (b.angle * Math.PI) / 180, grow);
}
const placedArea = (b) => placedWings(b).reduce((t, w) => t + (w.u1 - w.u0) * (w.v1 - w.v0), 0);

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
  const rects = placed.map((b) => ({ b, pieces: buildingFeet(b, proj), area: placedArea(b), floors: floorsOf(b) }));
  const footprint = rects.reduce((sum, r) => sum + r.area, 0);
  const isIndustrial = type.mode === 'industrial';
  const gsf = isIndustrial ? footprint : rects.reduce((sum, r) => sum + r.area * r.floors, 0);
  const maxFloors = isIndustrial ? (rects.length ? 1 : 0) : Math.max(0, ...rects.map((r) => r.floors));

  let prog;
  let docks = 0;
  if (isIndustrial) {
    const required = parkingNeed(s, footprint / 1000);
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
  const checkPieces = placed.map((b) => buildingFeet(b, proj, -CHECK_TOLERANCE));
  const outside = rects.filter((r, i) => checkPieces[i].some((piece) => !ringInsideShape(piece, checkRings))).map((r) => r.b.id);
  const overlaps = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (checkPieces[i].some((a) => checkPieces[j].some((b) => convexOverlap(a, b)))) overlaps.push([rects[i].b.id, rects[j].b.id]);
    }
  }

  return {
    score: prog.units || prog.keys || prog.nsf,
    surplus: 0,
    angle: placed.length ? placed[0].angle * DEG : 0,
    shapes: { parking: [] },
    // One footprint per piece (a shaped building has several).
    buildingLatLngs: rects.flatMap((r) => r.pieces.map((piece) => piece.map((p) => proj.toLatLng(p)))),
    buildingHeights: rects.flatMap((r) => r.pieces.map(() => (isIndustrial ? s.clearHeight + INDUSTRIAL_ROOF_ALLOWANCE : podiumHeight + r.floors * s.floorToFloor))),
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
const HELIX_MAX_SLOPE = 12; // %, a common limit for a helix lane
const MIN_TRUCK_WIDTH = 30;
const DEFAULT_TRUCK_RADIUS = 45;

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
  const info = { rampType: ['sloped', 'express', 'helix'][s.rampType], slopePct: s.rampSlope, longSide, shortSide };
  let helix = null;
  let ramp = null;
  const arrows = [];
  if (levels <= 1) {
    // A single deck needs no ramp.
    info.rampType = 'none';
    info.required = 0;
    info.fits = true;
    info.note = null;
  } else if (s.rampType === 2) {
    // Helix: one lane spiralling up a level per turn in a corner. Its slope
    // is the rise over one lap of the lane's centre line.
    const outer = s.helixRadius + s.rampWidth;
    const d = 2 * outer;
    const lap = 2 * Math.PI * (s.helixRadius + s.rampWidth / 2);
    const helixSlope = (s.floorToFloor / lap) * 100;
    info.slopePct = Math.round(helixSlope * 10) / 10;
    info.required = d + 2 * aisle;
    for (const v0 of [vmin, vmax - d]) {
      const r = { u0: umax - aisle - d, u1: umax - aisle, v0, v1: v0 + d };
      if (r.u0 >= umin + aisle && inside(r)) {
        helix = r;
        break;
      }
    }
    info.fits = !!helix && helixSlope <= HELIX_MAX_SLOPE;
    info.note = !helix ? `needs a ${Math.round(d)} ft square corner plus end aisles`
      : helixSlope > HELIX_MAX_SLOPE ? `a ${Math.round(s.helixRadius)} ft inside radius makes it ${info.slopePct}% - widen the helix (${HELIX_MAX_SLOPE}% max)` : null;
    if (helix) {
      cuts.push(helix);
      ramp = helix;
    }
  } else if (s.rampType === 1) {
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
      ramp: helix ? null : ramp ? rectToLatLngs(ramp, angle, proj) : null,
      helix: helix ? (() => {
        const cu = (helix.u0 + helix.u1) / 2;
        const cv = (helix.v0 + helix.v1) / 2;
        const ring = (r) => Array.from({ length: 36 }, (_, k) => toLL([cu + r * Math.cos((k * Math.PI) / 18), cv + r * Math.sin((k * Math.PI) / 18)]));
        return [ring(s.helixRadius + s.rampWidth), ring(s.helixRadius)];
      })() : null,
      cores: cores.map((r) => rectToLatLngs(r, angle, proj)),
      endAisles: endAisles.map((r) => rectToLatLngs(r, angle, proj)),
      arrows: arrows.map((line) => line.map(toLL)),
      rampLabel: levels <= 1 ? 'Single deck'
        : s.rampType === 2 ? `Helix ramp · ${info.slopePct}%`
          : s.rampType === 1 ? `Express ramp · ${s.rampSlope}%` : `Sloped floors · ${s.rampSlope}% up`,
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
  const edgeList = (list) => list.map(({ index, role, setback, facing, lengthFt, mid }) => ({ index, role, setback, facing, lengthFt, mid }));
  // Called only once the edges below are worked out.
  const empty = (error) => ({
    edges: edgeList(edges),
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

  // Setbacks by edge (envelope.js); one number for the checks that need it.
  const edges = siteEdges(boundary, s);
  const anySetback = edges.some((e) => e.setback > 0);
  let region;
  let inset;
  try {
    inset = insetByEdges(boundary, edges, 0, s.setback);
    region = inset ? subtract(inset, cutouts) : null;
  } catch {
    return { ...noBoundary, error: 'Couldn\'t work with that boundary - redraw it without crossing lines.', type, settings: s };
  }
  if (!region) return empty('The setback leaves no room to build.');
  const regionRings = feetRings(region);
  if (!regionRings.length) return empty('The setback leaves no room to build.');
  const buildableSf = shapeArea(regionRings);

  const setbackGeom = anySetback ? latLngRings(inset) : null;

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
  // Trucks (industrial): the loop road and truck aisles are sized for a
  // WB-67 tractor-trailer.
  const truckWidth = s.truckAisleWidth || MIN_TRUCK_WIDTH;
  const truckRadius = s.truckTurnRadius || DEFAULT_TRUCK_RADIUS;
  const forTrucks = type.mode === 'industrial';
  const loopWidth = forTrucks ? Math.max(s.aisleWidth, truckWidth) : s.aisleWidth;
  const fixedParkingDeg = s.parkingRotation === 'auto' ? null : s.parkingRotation;

  // ---- Perimeter drive: a loop road just inside the setback ----
  let inner = region;
  let driveFeature = null;
  if (surfaceParking && s.perimeterDrive && loopWidth > 0) {
    try {
      const shrunk = buffer(region, -loopWidth, { units: 'feet' });
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
  const setbackRings = anySetback ? feetRings(inset) : boundaryRings;
  // Routed aisles start at a bay's end by design, so they aren't checked
  // for dead ends; the bays they serve are.
  const aisleIssues = !scheme.skipAisleChecks ? aisles.flatMap((x, i) => analyzeAisle(x.a.line.coordinates.map(proj.toFeet), {
    width: aisleWidthOf(x.a, s),
    twoWay: x.a.twoWay !== false,
    turnRadius: s.turnRadius,
    connectsTo: [...aisles.filter((_, j) => j !== i).flatMap((y) => y.rings), ...perimeterEdge, ...setbackRings, ...boundaryRings],
    fromBay: !!(x.a.auto || x.a.fromBay),
    truck: forTrucks && x.a.truck ? { width: truckWidth, turnRadius: truckRadius } : null,
  }).map((issue) => ({ ...issue, aisleId: x.a.id }))) : [];
  const rotatedDrive = new Map();
  const driveIn = (angle) => {
    if (!rotatedDrive.has(angle)) rotatedDrive.set(angle, rotateRings(driveEdge, angle));
    return rotatedDrive.get(angle);
  };
  const reaches = (row, angle) => {
    if (!driveEdge) return true;
    return rowReachesDrive(row, driveIn(angle));
  };

  // Every separate piece of a Feature parked at its own best (or a fixed)
  // orientation. keepOnly drops rows that can't reach the drive; otherwise
  // they're kept and flagged.
  const parkPieces = (feature, pieceMod, fixedDeg, keepOnly, search = {}) => {
    const rows = [];
    for (const poly of piecesOf(feature)) {
      const rings = poly.map((r) => openRing(r).map(proj.toFeet)).filter((r) => r.length >= 3);
      if (!rings.length || shapeArea(rings) < MIN_PARKING_PIECE_SF) continue;
      // Kept if either end reaches a drive; a one-way row missing its other
      // end is then routed or flagged rather than silently dropped.
      const keepEither = (row, a) => {
        const e = rowEnds(row, driveIn(a));
        return e.a || e.b;
      };
      const best = bestOrientation(rings, s, pieceMod, { ...search, fixedDeg, keep: keepOnly && driveEdge ? keepEither : null });
      for (const r of best.rows) r.connected = reaches(r, r.angle);
      rows.push(...best.rows);
    }
    return rows;
  };

  // ---- Parking areas drawn by hand ----
  const placed = supportsManualLayout(type) ? (scheme.edits?.buildings || []) : [];
  const buildingCutouts = placed.flatMap((b) => buildingFeet(b, proj, BUILDING_CLEARANCE).map((piece) => feetRingToGeo(piece, proj)));
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
    const checkCuts = [...areas.map((a) => a.polygon), ...aisles.filter((x) => !x.a.auto).map((x) => x.f.geometry)];
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
    // Multifamily shapes other than bars lay out shaped buildings; garden
    // walk-ups are short bars. If no shape fits at any angle, bars it is.
    const shaped = isUnitLayout(type) && s.buildingShape >= 2;
    const sLayout = isUnitLayout(type) && s.buildingShape === 1
      ? { ...s, maxBuildingLength: Math.min(s.maxBuildingLength, GARDEN_MAX_LENGTH), buildingGap: Math.max(s.buildingGap, GARDEN_GAP) }
      : s;
    const run = (fn) => {
      for (const angle of angles) {
        const cutRects = (rects) => {
          const f = safeSubtract(layout, rects.map((r) => rectToGeo(r, angle, proj)), null);
          return f ? rotateRings(feetRings(f), angle) : [];
        };
        for (const c of fn(rotateRings(layoutRings, angle), sLayout, type, siteSf, areaRaw, { cutRects })) {
          if (better(c, best)) best = { ...c, angle };
        }
      }
    };
    if (shaped) run(shapedLayouts);
    if (!best) run(LAYOUTS[type.mode]);
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
      ...(shapes.yards || []),
      ...(shapes.courtyards || []),
    ].map((r) => rectToGeo(r, angle, proj));
    try {
      const leftover = obstacles.length ? subtract(layout, obstacles) : layout;
      if (leftover) leftoverRows = parkPieces(leftover, mod, fixedParkingDeg, true, { stepDeg: 15, extraAngles: [angle] });
    } catch {
      leftoverRows = [];
    }
  }

  const allRows = [...bandRows, ...leftoverRows, ...otherRows, ...areaRows];
  applyStallEdits(allRows, scheme.stallEdits || [], proj);
  const rawStalls = allRows.reduce((sum, r) => sum + 2 * r.perSide - r.removed.size, 0);

  // ---- Entries and accessible stalls ----
  const entries = surfaceParking
    ? (scheme.entries?.length ? scheme.entries.map((e) => ({ ...e, auto: false })) : [{ id: 'auto', point: autoEntryPoint(boundary), auto: true }])
    : [];
  const entryInfo = entries.map((e) => {
    const ef = proj.toFeet(e.point);
    // The setback of the edge the entry is on.
    const setbackHere = setbackNear(edges, proj, e.point, s.setback);
    const near = nearestPointOnRings(regionRings, ef);
    const reach = !driveEdge
      || (driveFeature && near && near.d <= setbackHere + 30)
      || aisles.some((x) => distanceToRings(x.rings, ef) <= setbackHere + 30);
    let drive = null;
    if (driveFeature && near && near.d > 0.5) {
      const dx = (near.p[0] - ef[0]) / near.d;
      const dy = (near.p[1] - ef[1]) / near.d;
      const end = [near.p[0] + dx * s.aisleWidth, near.p[1] + dy * s.aisleWidth];
      const w = s.aisleWidth / 2;
      drive = [[ef[0] - dy * w, ef[1] + dx * w], [end[0] - dy * w, end[1] + dx * w], [end[0] + dy * w, end[1] - dx * w], [ef[0] + dy * w, ef[1] - dx * w]]
        .map((p) => proj.toLatLng(p));
    }
    return { id: e.id, auto: e.auto, point: e.point, feet: ef, setbackHere, reaches: reach, drive };
  });

  // ---- Auto-routed aisles: from every bay that can't reach a drive (or,
  // with no drive at all, every bay) the cheapest path to the network or
  // an entry; then the plan is solved again with those aisles in it ----
  let routedPending = null;
  if (s.autoAisles && surfaceParking && !scheme.routed && !scheme.skipAisleChecks && allRows.length) {
    const nearestEntry = (p) => Math.min(...entryInfo.map((e) => Math.hypot(e.feet[0] - p[0], e.feet[1] - p[1])), Infinity);
    const sources = [];
    for (const r of allRows) {
      const { a, b } = rowEndPoints(r);
      const pa = unrotate(a, r.angle);
      const pb = unrotate(b, r.angle);
      const nearer = nearestEntry(pa) <= nearestEntry(pb) ? pa : pb;
      if (!driveEdge) {
        if (r.dir) sources.push(pa, pb);
        else sources.push(nearer);
        continue;
      }
      if (r.connected !== false) continue;
      const ends = rowEnds(r, driveIn(r.angle));
      if (!r.dir) sources.push(nearer);
      else {
        const [inPt, outPt] = r.dir > 0 ? [pa, pb] : [pb, pa];
        if (!ends.in) sources.push(inPt);
        if (!ends.out) sources.push(outPt);
      }
    }
    if (sources.length) {
      // A path's centre keeps half an aisle plus the clearance away from
      // buildings, so the paved aisle never touches one.
      const keepOff = s.aisleWidth / 2 + BUILDING_CLEARANCE;
      const grow = (r) => ({ u0: r.u0 - keepOff, u1: r.u1 + keepOff, v0: r.v0 - keepOff, v1: r.v1 + keepOff });
      const rectFeet = (r, a) => [[r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1]].map((p) => unrotate(p, a));
      const blocked = [
        ...(shapes.buildings || []).map((r) => rectFeet(grow(r), angle)),
        ...placed.flatMap((b) => buildingFeet(b, proj, keepOff)),
      ];
      const paths = routeAisles({
        region: regionRings,
        blocked,
        costly: allRows.map((r) => rectFeet(r, r.angle)),
        network: driveEdge || [],
        targets: entryInfo.map((e) => e.feet),
        targetRadius: Math.max(s.setback, ...entryInfo.map((e) => e.setbackHere)) + 12,
        sources: sources.slice(0, MAX_ROUTED_AISLES),
        straighten: s.aisleWidth / 2,
      });
      if (paths.length) {
        const routed = paths.map((line, i) => ({
          id: `auto-${i}`,
          line: { type: 'LineString', coordinates: line.map((p) => { const [la, ln] = proj.toLatLng(p); return [ln, la]; }) },
          twoWay: true,
          auto: true,
        }));
        routedPending = routed;
      }
    }
  }

  // ---- One-way flow ----
  const flowIssues = [];
  // One-way bays need a way in and a way out. (A space leaves these
  // checks to the main plan, which sees the whole of each drawn aisle.)
  const checkFlow = !scheme.skipAisleChecks;
  if (driveEdge && checkFlow) {
    for (const r of allRows) {
      if (!r.dir) continue;
      const ends = rowEnds(r, driveIn(r.angle));
      if (ends.in && ends.out) continue;
      const { a, b } = rowEndPoints(r);
      const [inPt, outPt] = r.dir > 0 ? [a, b] : [b, a];
      if (!ends.in) flowIssues.push({ kind: 'in', at: unrotate(inPt, r.angle), text: 'One-way bay with no way in' });
      if (!ends.out) flowIssues.push({ kind: 'out', at: unrotate(outPt, r.angle), text: 'One-way bay with no way out' });
    }
  }
  // Drawn one-way aisles flow from their first point to their last.
  const oneWays = !checkFlow ? [] : aisles.filter((x) => !x.a.auto && x.a.twoWay === false).map((x) => {
    const pts = x.a.line.coordinates.map(proj.toFeet);
    return { x, start: pts[0], end: pts[pts.length - 1], width: aisleWidthOf(x.a, s) };
  });
  const twoWayRings = [...perimeterEdge, ...aisles.filter((x) => x.a.twoWay !== false).flatMap((x) => x.rings)];
  const nearTwoWay = (p, d) => twoWayRings.length > 0 && distanceToRings(twoWayRings, p) <= d;
  for (let i = 0; i < oneWays.length; i++) {
    for (let j = i + 1; j < oneWays.length; j++) {
      const A = oneWays[i];
      const B = oneWays[j];
      const d = Math.max(A.width, B.width);
      if (Math.hypot(A.end[0] - B.end[0], A.end[1] - B.end[1]) <= d && !nearTwoWay(A.end, d)) {
        flowIssues.push({ kind: 'headon', at: A.end, text: 'Two one-way aisles flow into each other here, with no way out' });
      }
      if (Math.hypot(A.start[0] - B.start[0], A.start[1] - B.start[1]) <= d && !nearTwoWay(A.start, d)) {
        flowIssues.push({ kind: 'headon', at: A.start, text: 'Two one-way aisles both flow away from here, with no way in' });
      }
    }
  }
  // An entry served only by one-way aisles needs one flowing in and one out.
  for (const e of entryInfo) {
    const reach = e.setbackHere + 30;
    const twoWayHere = (driveFeature && nearestPointOnRings(regionRings, e.feet)?.d <= reach)
      || aisles.some((x) => x.a.twoWay !== false && distanceToRings(x.rings, e.feet) <= reach);
    const touching = oneWays.filter((o) => distanceToRings(o.x.rings, e.feet) <= reach);
    if (twoWayHere || !touching.length) continue;
    const inbound = touching.some((o) => Math.hypot(o.start[0] - e.feet[0], o.start[1] - e.feet[1]) <= Math.hypot(o.end[0] - e.feet[0], o.end[1] - e.feet[1]));
    const outbound = touching.some((o) => Math.hypot(o.end[0] - e.feet[0], o.end[1] - e.feet[1]) < Math.hypot(o.start[0] - e.feet[0], o.start[1] - e.feet[1]));
    if (!inbound) flowIssues.push({ kind: 'entry', at: e.feet, text: 'This entry only has one-way aisles flowing out - no way in' });
    if (!outbound) flowIssues.push({ kind: 'entry', at: e.feet, text: 'This entry only has one-way aisles flowing in - no way out' });
  }
  // Arrows along drawn one-way aisles.
  const aisleArrows = oneWays.flatMap((o) => {
    const pts = o.x.a.line.coordinates.map(proj.toFeet);
    const out = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 20) continue;
      const ux = (bx - ax) / len;
      const uy = (by - ay) / len;
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      out.push([[mx - ux * 8 - uy * 5, my - uy * 8 + ux * 5], [mx, my], [mx - ux * 8 + uy * 5, my - uy * 8 - ux * 5]].map((p) => proj.toLatLng(p)));
    }
    return out;
  });
  const oneWayCount = allRows.filter((r) => r.dir).length + oneWays.length;

  const types = stallTypes(rawStalls, s);
  // Stalls marked by hand: accessible ones count toward what's required
  // (the rest are placed automatically); EV and compact stalls marked
  // beyond the settings' shares add to them.
  let adaPlaced = 0;
  const marked = { ev: 0, compact: 0 };
  for (const r of allRows) {
    r.adaSlots = [];
    for (const [key, kind] of r.marks) {
      const [i, side] = key.split(':');
      if (kind === 'ada' || kind === 'van') {
        r.adaSlots.push({ i: Number(i), side, van: kind === 'van', byHand: true });
        adaPlaced++;
      } else if (kind === 'ev' || kind === 'compact') {
        marked[kind]++;
      }
    }
  }
  types.ev = Math.max(types.ev, marked.ev);
  types.compact = Math.max(types.compact, marked.compact);
  const vanByHand = allRows.reduce((t, r) => t + r.adaSlots.filter((x) => x.van).length, 0);
  // What's required stays for the check; what's there counts in the types.
  types.adaRequired = types.ada;
  types.vanRequired = types.van;
  // Accessible stalls go in the rows nearest an entry, from the aisle end,
  // on stalls not marked by hand.
  if (types.ada > adaPlaced && allRows.length) {
    const centre = (r) => {
      const mid = unrotate([(r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2], r.angle);
      return Math.min(...entryInfo.map((e) => Math.hypot(e.feet[0] - mid[0], e.feet[1] - mid[1])), Infinity);
    };
    let left = types.ada - adaPlaced;
    for (const r of [...allRows].sort((a, b) => centre(a) - centre(b))) {
      if (left <= 0) break;
      const islands = new Set(r.islands);
      for (const side of ['lower', 'upper']) {
        for (let i = 0; i < r.n && left > 0; i++) {
          if (islands.has(i) || r.marks.has(`${i}:${side}`)) continue;
          r.adaSlots.push({ i, side });
          left--;
          adaPlaced++;
        }
      }
    }
  }
  // The van-accessible share: the first automatic ones, nearest the entry.
  let vanLeft = types.vanRequired - vanByHand;
  for (const r of allRows) {
    for (const x of r.adaSlots) {
      if (vanLeft <= 0) break;
      if (!x.byHand && !x.van) { x.van = true; vanLeft--; }
    }
  }
  types.ada = Math.max(types.adaRequired, adaPlaced);
  types.van = Math.max(types.vanRequired, allRows.reduce((t, r) => t + r.adaSlots.filter((x) => x.van).length, 0));
  types.standard = Math.max(0, types.total - types.ada - types.compact);

  const m = { ...EMPTY_METRICS, ...best.metrics };

  // ---- Units laid out floor by floor (multifamily) ----
  // Shaped buildings come with their plans; bars and hand-placed buildings
  // are laid out here, each as one wing. Counts, rentable area,
  // efficiency, beds and baths then come from the plans, not a ratio.
  const unitDrawings = [];
  let unitStats = null;
  if (isUnitLayout(type) && s.mix && m.floors > 0) {
    const walkUp = s.buildingShape === 1;
    const plans = [];
    if (best.unitPlans) {
      best.unitPlans.forEach((p) => plans.push({ plan: p.plan, toLL: (pt) => proj.toLatLng(unrotate(pt, angle)), floors: m.floors, elevators: p.elevators, shape: p.shape }));
    } else if (placed.length) {
      for (const b of placed) {
        const floors = Math.min(MAX_FLOORS, Math.max(1, Math.round(b.floors || s.floors || 1)));
        // Its wings (the corridor runs down a rectangle's longer side).
        const prog = buildingProgram(placedWings(b), s, s.mix, floors, { walkUp });
        if (!prog) { plans.failed = true; continue; }
        const [cx, cy] = proj.toFeet(b.center);
        const a = (b.angle * Math.PI) / 180;
        plans.push({ ...prog, toLL: ([x, y]) => proj.toLatLng([cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)]), floors, shape: 'bars' });
      }
    } else {
      for (const r of shapes.buildings || []) {
        const prog = buildingProgram([{ ...r, axis: r.u1 - r.u0 >= r.v1 - r.v0 ? 'u' : 'v' }], s, s.mix, m.floors, { walkUp });
        if (prog) plans.push({ ...prog, toLL: (pt) => proj.toLatLng(unrotate(pt, angle)), floors: m.floors, shape: walkUp ? 'garden' : 'bars' });
        else plans.failed = true;
      }
    }
    // A building too shallow for units on both sides of a corridor keeps
    // the efficiency-ratio estimate, for every building, so totals agree.
    if (plans.length && !plans.failed) {
      const byType = s.mix.map((_, i) => plans.reduce((t, p) => t + (p.byType ? p.byType[i] : 0), 0));
      let nsfLaid = plans.reduce((t, p) => t + (p.nrsf || 0), 0);
      // Automatic bars were sized for parking and density on the ratio
      // estimate; when the plan holds more units than its stalls can serve
      // or the density allows, the extra units come off (left as amenity).
      if (!best.unitPlans && !placed.length) {
        const cap = Math.min(
          s.parkingRatio > 0 && !(s.parkingFixed > 0) ? Math.floor((best.metrics.parkingProvided || 0) / s.parkingRatio + 1e-9) : Infinity,
          densityCap(s, siteSf),
        );
        let total = byType.reduce((t, c) => t + c, 0);
        const avg = total ? nsfLaid / total : 0;
        while (total > cap) {
          const i = byType.reduce((bi, c, k) => (c > byType[bi] ? k : bi), 0);
          byType[i]--;
          total--;
          nsfLaid -= avg;
        }
      }
      // Shaped plans carry per-floor counts; their totals are already in m.
      const units = best.unitPlans ? m.units : byType.reduce((t, c) => t + c, 0);
      const nsf = best.unitPlans ? m.nsf : nsfLaid;
      const typeCounts = best.unitPlans ? m.unitsByType.map((u) => u.count) : byType;
      if (!best.unitPlans) {
        m.units = units;
        m.nsf = nsf;
        m.unitsByType = s.mix.map((u, i) => ({ name: u.name, size: u.size, count: byType[i] }));
        m.parkingRequired = parkingNeed(s, units);
      }
      unitStats = {
        efficiency: m.gsf > 0 ? nsf / m.gsf : 0,
        beds: s.mix.reduce((t, u, i) => t + typeCounts[i] * u.beds, 0),
        baths: s.mix.reduce((t, u, i) => t + typeCounts[i] * u.baths, 0),
        avgUnitSf: units ? nsf / units : 0,
        elevators: plans.reduce((t, p) => t + (p.elevators || 0), 0),
        stairs: plans.reduce((t, p) => t + p.plan.pieces.cores.filter((c) => c.kind === 'stair').length, 0),
        shapes: [...new Set(plans.map((p) => p.shape))],
      };
      for (const p of plans) {
        const ll = (ring) => ring.map(p.toLL);
        unitDrawings.push({
          units: p.plan.pieces.units.map((u) => ({ t: u.t, ring: ll(u.ring) })),
          cores: p.plan.pieces.cores.map((c) => ({ kind: c.kind, ring: ll(c.ring) })),
          corridors: p.plan.pieces.corridors.map(ll),
        });
      }
    }
  }

  // ---- Stepbacks: floors above stepbackAbove keep stepbackDepth further
  // in from every setback line. What a building loses up there comes off
  // its area, units and keys (in proportion), and the 3D view steps it. ----
  const stepbacks = [];
  let envelopeUpper = null;
  const stepFloors = s.stepbackAbove;
  // Single-storey and stacked-deck types don't step back.
  let stepFailed = false;
  if (stepFloors > 0 && s.stepbackDepth > 0 && m.gsf > 0 && !['garage', 'lots', 'industrial'].includes(type.mode)) {
    // A geometry failure skips the stepback rather than counting every
    // upper floor as lost.
    try { envelopeUpper = insetByEdges(boundary, edges, s.stepbackDepth, s.setback); } catch { stepFailed = true; }
  }
  if (!stepFailed && stepFloors > 0 && s.stepbackDepth > 0 && m.gsf > 0 && !['garage', 'lots', 'industrial'].includes(type.mode)) {
    const podium = type.id === 'mf-podium' ? s.podiumLevels * PODIUM_LEVEL_HEIGHT : 0;
    const footprints = placed.length
      ? placed.flatMap((b) => buildingFeet(b, proj).map((piece) => ({ geo: feetRingToGeo(piece, proj), floors: Math.max(1, Math.round(b.floors || s.floors || 1)) })))
      : (shapes.buildings || []).map((r) => ({ geo: rectToGeo(r, angle, proj), floors: m.floors }));
    let lost = 0;
    footprints.forEach(({ geo, floors }, i) => {
      if (floors <= stepFloors) return;
      const upper = envelopeUpper ? intersect(geo, envelopeUpper) : null;
      const full = turfArea(toFeature(geo)) * SF_PER_SQM;
      const kept = upper ? turfArea(upper) * SF_PER_SQM : 0;
      if (full - kept < 1) return;
      lost += (full - kept) * (floors - stepFloors);
      stepbacks.push({ index: i, atFt: podium + stepFloors * s.floorToFloor, upper: upper ? latLngRings(upper) : [] });
    });
    if (lost > 0) {
      const keep = Math.max(0, 1 - lost / m.gsf);
      const scaled = (n) => Math.floor(n * keep + 1e-9);
      m.gsf -= lost;
      m.nsf *= keep;
      if (m.units) {
        const before = m.units;
        m.units = scaled(m.units);
        // Each type in proportion; the remainder to the largest shares.
        const counts = (m.unitsByType || []).map((u) => u.count * keep);
        const floorCounts = counts.map(Math.floor);
        let left = m.units - floorCounts.reduce((t, c) => t + c, 0);
        counts.map((c, k) => [c - floorCounts[k], k]).sort((a, b) => b[0] - a[0]).forEach(([, k]) => { if (left > 0) { floorCounts[k]++; left--; } });
        m.unitsByType = (m.unitsByType || []).map((u, k) => ({ ...u, count: floorCounts[k] }));
        if (unitStats) {
          const f = before ? m.units / before : 0;
          unitStats = { ...unitStats, beds: Math.round(unitStats.beds * f), baths: Math.round(unitStats.baths * f), efficiency: m.gsf > 0 ? m.nsf / m.gsf : 0 };
        }
      }
      if (m.keys) m.keys = scaled(m.keys);
      // Data halls lose IT load and generators with their floor area.
      if (m.itMw) {
        const gensPerMw = m.generators / m.itMw;
        m.itMw *= keep;
        m.generators = Math.ceil(m.itMw * gensPerMw - 1e-9);
      }
      if (type.yieldKind === 'units' || type.yieldKind === 'keys') m.parkingRequired = parkingNeed(s, m.units || m.keys);
      else if (type.yieldKind === 'sf') m.parkingRequired = parkingNeed(s, m.nsf / 1000);
      else m.parkingRequired = Math.ceil(m.parkingRequired * keep - 1e-9);
    }
  }

  const surface = netStalls(rawStalls);
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
  for (const r of allRows) byAngle.set(r.angle, (byAngle.get(r.angle) || 0) + r.perSide - r.removed.size / 2);
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
    ...(unitStats ? { unitLayout: unitStats } : {}),
  };

  const autoBuildings = shapes.buildings || [];
  const geometry = {
    setback: setbackGeom,
    // The zoning envelope for the 3D view: the setback line up to the
    // stepback, the stepped line above, to the height limit (if set).
    envelope: {
      lower: anySetback ? latLngRings(inset) : latLngRings(toFeature(boundary)),
      upper: envelopeUpper ? latLngRings(envelopeUpper) : null,
      stepFt: envelopeUpper ? (type.id === 'mf-podium' ? s.podiumLevels * PODIUM_LEVEL_HEIGHT : 0) + stepFloors * s.floorToFloor : null,
      topFt: s.maxHeight > 0 ? s.maxHeight : null,
    },
    stepbacks,
    buildings: best.buildingLatLngs || autoBuildings.map((r) => rectToLatLngs(r, angle, proj)),
    buildingHeights: best.buildingHeights || autoBuildings.map(() => m.heightFt || 0),
    parking: allRows.map((r) => rowGeometry(r, proj)),
    lots: (shapes.lots || []).map((r) => rectToLatLngs(r, angle, proj)),
    streets: (shapes.streets || []).map((r) => rectToLatLngs(r, angle, proj)),
    truckCourts: (shapes.truckCourts || []).map((r) => rectToLatLngs(r, angle, proj)),
    trailers: (shapes.trailers || []).map((r) => trailerGeometry(r, angle, proj)),
    yards: (shapes.yards || []).map((r) => rectToLatLngs(r, angle, proj)),
    courtyards: (shapes.courtyards || []).filter((r) => !(shapes.garages || []).includes(r)).map((r) => rectToLatLngs(r, angle, proj)),
    wrapGarages: (shapes.garages || []).map((r) => rectToLatLngs(r, angle, proj)),
    unitPlans: unitDrawings,
    unitTypes: isUnitLayout(type) && s.mix ? s.mix.map((u) => u.name) : [],
    drives: [
      ...(driveFeature ? piecesOf(driveFeature) : []),
      ...aisles.flatMap((x) => piecesOf(x.f)),
    ].map((poly) => poly.map((ring) => openRing(ring).map(([lng, lat]) => [lat, lng]))),
    aisleIssues: [...aisleIssues, ...flowIssues].map((issue) => ({ latlng: proj.toLatLng(issue.at), text: issue.text, kind: issue.kind, aisleId: issue.aisleId })),
    aisleArrows,
    routedAisles: [],
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
    flowIssues: flowIssues.map((issue) => ({ kind: issue.kind, text: issue.text })),
    oneWayCount,
    routedAisles: [],
    entries: entryInfo.map((e) => ({ id: e.id, auto: e.auto, reaches: e.reaches })),
    areas: areas.map((a) => {
      const rows = areaRows.filter((r) => r.areaId === a.id);
      const dominant = rows.slice().sort((x, y) => y.perSide - x.perSide)[0];
      return {
        id: a.id,
        stalls: rows.reduce((sum, r) => sum + 2 * r.perSide - (r.removed ? r.removed.size : 0), 0),
        orientationDeg: dominant ? Math.round(((dominant.angle * 180) / Math.PI) * 10) / 10 : null,
      };
    }),
    stallAngle: s.stallAngle,
    // Truck access for industrial: the court a WB-67 backs out of, and a
    // drive wide enough to get there - the perimeter loop or a truck aisle.
    truck: forTrucks && (shapes.buildings || []).length + placed.length > 0 ? {
      // Only a truck court actually in the plan counts.
      courtDepth: (shapes.truckCourts || []).length ? s.truckCourt : 0,
      courtNeeded: s.minTruckCourt,
      routeWidth: Math.max(driveFeature ? loopWidth : 0, ...aisles.filter((x) => x.a.truck).map((x) => aisleWidthOf(x.a, s)), 0),
      widthNeeded: truckWidth,
      truckAisles: aisles.filter((x) => x.a.truck).length,
    } : null,
  } : null;

  const result = {
    metrics,
    geometry,
    limits: best.limits,
    warnings: best.warnings || { outside: [], overlaps: [] },
    buildingRects,
    parking,
    // The site's edges with their setbacks, for the edge labels and picker.
    edges: edgeList(edges),
    proforma: proformaFor(type, s, metrics),
    error: null,
    type,
    settings: s,
  };

  // With routed aisles in hand, solve again with them in the plan; keep
  // that only if it works and connects more bays than before.
  if (routedPending) {
    const second = solvePart(boundary, { ...scheme, driveAisles: [...(scheme.driveAisles || []), ...routedPending], routed: true }, cutouts);
    const unconnectedBefore = driveEdge ? disconnected : allRows.length;
    if (!second.error && second.parking && second.parking.disconnected < unconnectedBefore) {
      second.parking.routedAisles = routedPending.map(({ line }) => line);
      second.geometry.routedAisles = routedPending.map(({ line }) => line.coordinates.map(([ln, la]) => [la, ln]));
      return second;
    }
  }
  return result;
}

const SUM_KEYS = ['footprintSf', 'buildingCount', 'gsf', 'nsf', 'units', 'keys', 'docks', 'trailerStalls', 'trailerRequired', 'itMw', 'generators',
  'parkingRequired', 'parkingSurface', 'parkingStructured', 'parkingGarage', 'parkingProvided', 'parkingPavedSf'];

// The zoning check rows (#4): each limit against the plan's totals.
// status is pass, fail, or none (no limit set).
function zoningChecks(s, totals, warnings, parkingParts) {
  const fmt = (n, d = 2) => (n || 0).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
  const row = (label, limit, actual, ok) => ({ label, limit, actual, status: limit === null ? 'none' : (ok ? 'pass' : 'fail'), category: 'zoning' });
  const rows = [
    row('Height', s.maxHeight > 0 ? `${fmt(s.maxHeight, 0)} ft` : null, `${fmt(totals.heightFt, 0)} ft`, totals.heightFt <= s.maxHeight + 1e-6),
    row('FAR', s.maxFar > 0 ? fmt(s.maxFar) : null, fmt(totals.far), totals.far <= s.maxFar + 1e-6),
    row('Lot coverage', s.maxCoverage > 0 ? `${fmt(s.maxCoverage, 0)}%` : null, `${fmt(totals.coverage * 100, 1)}%`, totals.coverage * 100 <= s.maxCoverage + 1e-6),
    {
      label: 'Parking',
      category: 'parking',
      limit: totals.sharedParking
        ? `${fmt(totals.parkingRequired, 0)} required (shared; ${fmt(totals.parkingRequiredRaw, 0)} separately)`
        : `${fmt(totals.parkingRequired, 0)} required`,
      actual: `${fmt(totals.parkingProvided, 0)} provided`,
      status: totals.parkingProvided >= totals.parkingRequired ? 'pass' : 'fail',
    },
    ...(s.maxDensity > 0 ? [row('Density', `${fmt(s.maxDensity, 1)} per acre`, `${fmt(totals.density, 1)} per acre`, totals.density <= s.maxDensity + 1e-6)] : []),
    {
      label: 'Setback',
      category: 'zoning',
      limit: s.setbackMode === 1 ? `${fmt(s.frontSetback, 0)} / ${fmt(s.setback, 0)} / ${fmt(s.rearSetback, 0)} ft (front / side / rear)` : `${fmt(s.setback, 0)} ft`,
      actual: warnings.outside.length ? `${warnings.outside.length} building${warnings.outside.length === 1 ? '' : 's'} over the line` : 'Clear',
      status: warnings.outside.length ? 'fail' : (s.setback > 0 || (s.setbackMode === 1 && (s.frontSetback > 0 || s.rearSetback > 0)) ? 'pass' : 'none'),
    },
  ];
  if (warnings.overlaps.length) {
    rows.push({ label: 'Buildings overlap', category: 'zoning', limit: 'None', actual: `${warnings.overlaps.length} pair${warnings.overlaps.length === 1 ? '' : 's'}`, status: 'fail' });
  }
  const withSurface = parkingParts.filter((p) => p && p.rawStalls > 0);
  if (withSurface.length) {
    const drive = withSurface.some((p) => p.hasDrive);
    const disconnected = withSurface.reduce((sum, p) => sum + p.disconnected, 0);
    const badEntries = withSurface.flatMap((p) => p.entries.filter((e) => !e.reaches));
    const aisleProblems = withSurface.flatMap((p) => p.aisleIssues || []);
    rows.push({
      label: 'Circulation',
      category: 'parking',
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
      rows.push({ label: 'Drawn aisles', category: 'parking', limit: `Turns ≥ ${fmt(s.turnRadius, 0)} ft radius, no dead ends`, actual: parts.join(', '), status: 'fail' });
    } else if (withSurface.some((p) => p.aisleCount > 0)) {
      rows.push({ label: 'Drawn aisles', category: 'parking', limit: `Turns ≥ ${fmt(s.turnRadius, 0)} ft radius, no dead ends`, actual: 'Clear', status: 'pass' });
    }
    const ada = withSurface.reduce((sum, p) => sum + (p.types.adaRequired ?? p.types.ada), 0);
    const van = withSurface.reduce((sum, p) => sum + (p.types.vanRequired ?? p.types.van), 0);
    const placedAda = withSurface.reduce((sum, p) => sum + p.adaPlaced, 0);
    rows.push({
      label: 'Accessible stalls',
      category: 'parking',
      limit: `${fmt(ada, 0)} required (${fmt(van, 0)} van)`,
      actual: `${fmt(placedAda, 0)} placed`,
      status: placedAda >= ada ? 'pass' : 'fail',
    });
  }
  for (const t of parkingParts.map((p) => p.truck).filter(Boolean)) {
    const courtOk = t.courtDepth >= t.courtNeeded;
    const routeOk = t.routeWidth >= t.widthNeeded;
    rows.push({
      label: 'Truck access',
      category: 'parking',
      limit: `${fmt(t.courtNeeded, 0)} ft court, ${fmt(t.widthNeeded, 0)} ft drive`,
      actual: [
        !t.courtDepth ? 'no truck court in the plan' : courtOk ? `${fmt(t.courtDepth, 0)} ft court` : `court only ${fmt(t.courtDepth, 0)} ft`,
        t.routeWidth ? (routeOk ? `${fmt(t.routeWidth, 0)} ft drive` : `drive only ${fmt(t.routeWidth, 0)} ft - widen it or draw a truck aisle`) : 'no truck drive - draw a truck aisle',
      ].join(', '),
      status: courtOk && routeOk ? 'pass' : 'fail',
    });
  }
  const oneWay = parkingParts.reduce((sum, p) => sum + (p.oneWayCount || 0), 0);
  if (oneWay > 0) {
    const flow = parkingParts.flatMap((p) => p.flowIssues || []);
    const count = (k) => flow.filter((x) => x.kind === k).length;
    const parts = [
      (count('in') + count('out')) && `${count('in') + count('out')} bay end${count('in') + count('out') === 1 ? '' : 's'} with no way through`,
      count('headon') && `${count('headon')} head-on meeting${count('headon') === 1 ? '' : 's'}`,
      count('entry') && `${count('entry')} entr${count('entry') === 1 ? 'y' : 'ies'} without both directions`,
    ].filter(Boolean);
    rows.push({
      label: 'One-way flow',
      category: 'parking',
      limit: 'Every one-way route has a way in and out',
      actual: parts.length ? parts.join(', ') : 'Flows through',
      status: parts.length ? 'fail' : 'pass',
    });
  }
  if (totals.trailerRequired > 0 || totals.trailerStalls > 0) {
    rows.push({
      label: 'Trailer parking',
      category: 'parking',
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

// A target yield (targetYield: units, keys, sf, MW or stalls): the most
// that fits is laid out first; with a target below it, the fewest floors
// (garage levels) that still reach it are used, and the plan counts the
// target exactly. result.target says whether the site can reach it.
const fmtTarget = (type, n) => {
  const v = (n || 0).toLocaleString('en-US', { maximumFractionDigits: type.yieldKind === 'mw' ? 1 : 0 });
  return `${v} ${{ units: type.mode === 'lots' ? 'homes' : 'units', keys: 'keys', sf: 'sf', mw: 'MW', stalls: 'stalls' }[type.yieldKind] || ''}`;
};
const yieldCount = (type, m) => ({ units: m.units, keys: m.keys, sf: m.nsf, mw: m.itMw, stalls: m.parkingProvided }[type.yieldKind] || 0);

function toTarget(boundary, scheme, cutouts, first) {
  const s = first.settings;
  const target = s && s.targetYield;
  if (!target || !first.metrics) return first;
  const type = first.type;
  const most = yieldCount(type, first.metrics);
  let r = first;
  // Fewer floors, when the plan has room to spare and isn't placed by hand.
  const key = type.mode === 'garage' ? 'levels' : 'floors';
  const floorsNow = key === 'levels' ? s.levels : first.metrics.floors;
  if (most > target && floorsNow > 1 && !(scheme.edits?.buildings?.length) && type.mode !== 'lots' && type.mode !== 'industrial' && type.mode !== 'parking') {
    let lo = 1;
    let hi = floorsNow;
    let found = null;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      const t = solvePart(boundary, { ...scheme, overrides: { ...scheme.overrides, [key]: mid } }, cutouts);
      if (t.metrics && yieldCount(type, t.metrics) >= target) {
        hi = mid;
        found = t;
      } else {
        lo = mid + 1;
      }
    }
    if (found && hi < floorsNow) r = { ...found, settings: s };
  }
  const got = yieldCount(type, r.metrics);
  const target0 = { target, most, fits: most >= target - 1e-9 };
  if (got <= target || type.yieldKind === 'stalls') return { ...r, target: target0 };
  // Count exactly the target; the extra room is left over (shown on the plan).
  const m = { ...r.metrics };
  const keep = target / got;
  if (type.yieldKind === 'units') {
    const counts = (m.unitsByType || []).map((u) => u.count * keep);
    const whole = counts.map(Math.floor);
    let left = Math.round(target) - whole.reduce((t, c) => t + c, 0);
    counts.map((c, k) => [c - whole[k], k]).sort((a, b) => b[0] - a[0]).forEach(([, k]) => { if (left > 0) { whole[k]++; left--; } });
    m.unitsByType = (m.unitsByType || []).map((u, k) => ({ ...u, count: whole[k] }));
    m.units = Math.round(target);
    m.nsf *= keep;
    if (m.unitLayout) m.unitLayout = { ...m.unitLayout, beds: Math.round(m.unitLayout.beds * keep), baths: Math.round(m.unitLayout.baths * keep) };
    m.parkingRequired = parkingNeed(s, m.units);
  } else if (type.yieldKind === 'keys') {
    m.keys = Math.round(target);
    m.parkingRequired = parkingNeed(s, m.keys);
  } else if (type.yieldKind === 'sf') {
    m.nsf = target;
    m.parkingRequired = parkingNeed(s, m.nsf / 1000);
  } else if (type.yieldKind === 'mw') {
    m.generators = Math.ceil(m.generators * keep - 1e-9);
    m.itMw = target;
    m.parkingRequired = Math.ceil(m.parkingRequired * keep - 1e-9);
  }
  m.density = m.siteAcres > 0 ? (m.units || m.keys) / m.siteAcres : 0;
  return { ...r, metrics: m, proforma: proformaFor(type, s, m), target: target0 };
}

// One solve of the whole plan. mainRequiredScale undoes a scaled parking
// ratio so the main part reports its standalone requirement; baseOverrides
// are the scheme's own settings (for what the panel shows).
function solveOnce(boundary, scheme, { mainRequiredScale = 1, baseOverrides = null } = {}) {
  const spaces = (scheme.spaces || []).filter((sp) => sp.polygon);
  const cutouts = spaces.map((sp) => sp.polygon);
  const main = toTarget(boundary, scheme, cutouts, solvePart(boundary, scheme, cutouts));
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
          // A space's edges aren't the site's: one setback all round.
          overrides: { perimeterDrive: 0, ...(sp.overrides || {}), setbackMode: 0 },
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

  // Unit-by-unit tabulation, over the uses that laid units out.
  // Only when every part with units laid them out, so the tabulation
  // covers the same units as the unit count beside it.
  const laidOut = parts.filter((p) => p.metrics.unitLayout);
  if (laidOut.length && laidOut.length < parts.filter((p) => p.metrics.units > 0).length) totals.unitLayout = null;
  else if (laidOut.length) {
    const sum = (k) => laidOut.reduce((t, p) => t + p.metrics.unitLayout[k], 0);
    const units = laidOut.reduce((t, p) => t + p.metrics.units, 0);
    const nsf = laidOut.reduce((t, p) => t + p.metrics.nsf, 0);
    const gsf = laidOut.reduce((t, p) => t + p.metrics.gsf, 0);
    totals.unitLayout = {
      beds: sum('beds'), baths: sum('baths'), elevators: sum('elevators'), stairs: sum('stairs'),
      efficiency: gsf > 0 ? nsf / gsf : 0,
      avgUnitSf: units ? nsf / units : 0,
      shapes: [...new Set(laidOut.flatMap((p) => p.metrics.unitLayout.shapes))],
    };
  }

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
      ...(main.target ? [{
        label: 'Target',
        category: 'zoning',
        limit: `${fmtTarget(main.type, main.target.target)}`,
        actual: main.target.fits ? `Met (room for ${fmtTarget(main.type, main.target.most)})` : `Only ${fmtTarget(main.type, main.target.most)} fit`,
        status: main.target.fits ? 'pass' : 'fail',
      }] : []),
      ...zoningChecks(main.settings, totals, main.warnings || { outside: [], overlaps: [] }, parkingParts),
      ...parts.filter((p) => p.garage).map((p) => ({
        label: 'Garage ramp',
        category: 'parking',
        limit: p.garage.rampType === 'none' ? 'Single deck - no ramp'
          : `${{ express: 'Express ramp', helix: 'Helix ramp', sloped: 'Sloped floors' }[p.garage.rampType]} at ${p.garage.slopePct}%`,
        actual: p.garage.fits ? `Fits (${Math.round(p.garage.longSide)} ft long)` : `Doesn't fit: ${p.garage.note}`,
        status: p.garage.fits ? 'pass' : 'fail',
      })),
    ],
  };
}
