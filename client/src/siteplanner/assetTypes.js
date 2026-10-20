// Asset types for the Site Planner, each with the standard defaults a
// scheme starts from. A scheme stores only the fields it changed
// (overrides); effectiveSettings() layers them over these.
//
// The ids mirror ASSET_TYPE_IDS in server/site-plan-rules.js - keep in sync.
//
// mode picks the layout the solver runs (solver.js):
//   bars       - building bars of a set depth alternating with parking bays
//   lots       - rows of lots facing internal streets
//   industrial - one deep building with a truck court and car parking
//   parking    - parking bays only
//   garage     - a parking structure filling its site
//   datacenter - data halls with an equipment yard, sized by IT load

import { SHAPES } from './buildings';

export const DEFAULT_MIX = [
  { name: 'Studio', size: 550, pct: 10, beds: 0, baths: 1 },
  { name: '1 BR', size: 750, pct: 45, beds: 1, baths: 1 },
  { name: '2 BR', size: 1050, pct: 35, beds: 2, baths: 2 },
  { name: '3 BR', size: 1300, pct: 10, beds: 3, baths: 2 },
];

// Beds and baths for a unit type, for mixes saved before they were set:
// the default type of the same name, else read from the name ("2 BR"),
// else guessed from the size.
export function bedsBaths(u) {
  const known = DEFAULT_MIX.find((d) => d.name.toLowerCase() === String(u.name || '').trim().toLowerCase());
  const named = /studio/i.test(u.name || '') ? 0 : Number((String(u.name || '').match(/(\d+)\s*(br|bd|bed)/i) || [])[1]);
  const guess = Number.isFinite(named) ? named : u.size < 600 ? 0 : u.size < 900 ? 1 : u.size < 1200 ? 2 : 3;
  const beds = Number.isFinite(u.beds) ? u.beds : known ? known.beds : guess;
  const baths = Number.isFinite(u.baths) ? u.baths : known ? known.baths : (beds >= 2 ? 2 : 1);
  return { beds, baths };
}

// Building shapes for multifamily (buildings.js). Bars is the original
// layout; the rest are laid out as wings with units along corridors.
const SHAPE_OPTIONS = SHAPES.map((x) => [x.id, x.label]);
const mfLayoutFields = () => [
  f('buildingShape', 'Building shape', '', 0, { options: SHAPE_OPTIONS, group: 'Building' }),
  f('corridorWidth', 'Corridor width', 'ft', 6, { step: 0.5, group: 'Building' }),
  f('courtyardMin', 'Smallest courtyard', 'ft', 60, { group: 'Building' }),
  f('stairSpacing', 'Max stair spacing', 'ft', 200, { group: 'Building' }),
  f('unitsPerElevator', 'Units per elevator', '', 80, { group: 'Building' }),
  f('amenitySf', 'Ground-floor amenity', 'sf', 2500, { step: 100, group: 'Building' }),
];

// Zoning limits and stall geometry every type shares. 0 means no limit.
export const COMMON_FIELDS = [
  { key: 'setbackMode', label: 'Setbacks', unit: '', default: 0, group: 'Site', options: [[0, 'Same on every edge'], [1, 'Front, side and rear']] },
  { key: 'setback', label: 'Setback', unit: 'ft', default: 20, group: 'Site', hint: 'side setback when front, side and rear differ' },
  { key: 'frontSetback', label: 'Front setback', unit: 'ft', default: 25, group: 'Site', showIf: (s) => s.setbackMode === 1 },
  { key: 'rearSetback', label: 'Rear setback', unit: 'ft', default: 20, group: 'Site', showIf: (s) => s.setbackMode === 1 },
  { key: 'maxHeight', label: 'Max height', unit: 'ft', default: 0, hint: '0 = no limit', group: 'Zoning' },
  { key: 'maxFar', label: 'Max FAR', unit: '', default: 0, step: 0.1, hint: '0 = no limit', group: 'Zoning' },
  { key: 'maxCoverage', label: 'Max lot coverage', unit: '%', default: 0, hint: '0 = no limit', group: 'Zoning' },
  { key: 'maxDensity', label: 'Max density', unit: 'per acre', default: 0, step: 0.5, hint: 'units (or hotel keys) per acre; 0 = no limit', group: 'Zoning' },
  { key: 'stepbackAbove', label: 'Step back above', unit: 'floors', default: 0, hint: 'upper floors set back further; 0 = no stepback', group: 'Zoning' },
  { key: 'stepbackDepth', label: 'Stepback', unit: 'ft', default: 10, group: 'Zoning', showIf: (s) => s.stepbackAbove > 0 },
  { key: 'stallAngle', label: 'Stall angle', unit: '', default: 90, group: 'Parking', options: [[90, '90° · two-way aisle'], [60, '60° · one-way aisle'], [45, '45° · one-way aisle']] },
  { key: 'stallWidth', label: 'Stall width', unit: 'ft', default: 9, step: 0.5, group: 'Parking' },
  { key: 'stallDepth', label: 'Stall depth', unit: 'ft', default: 18, step: 0.5, group: 'Parking' },
  { key: 'aisleWidth', label: 'Drive aisle (90°)', unit: 'ft', default: 24, group: 'Parking' },
  { key: 'aisle60', label: 'One-way aisle (60°)', unit: 'ft', default: 18, group: 'Parking' },
  { key: 'aisle45', label: 'One-way aisle (45°)', unit: 'ft', default: 13, group: 'Parking' },
  { key: 'turnRadius', label: 'Min turning radius', unit: 'ft', default: 25, hint: 'inside radius a drawn aisle\'s turns must allow', group: 'Parking' },
  { key: 'perimeterDrive', label: 'Perimeter drive', unit: '', default: 1, group: 'Parking', options: [[1, 'On - a loop road inside the setback'], [0, 'Off']] },
  { key: 'autoAisles', label: 'Route aisles automatically', unit: '', default: 1, group: 'Parking', options: [[1, 'On - connect every bay to a drive'], [0, 'Off - flag bays that can\'t reach one']] },
  { key: 'islandEvery', label: 'Landscape island every', unit: 'stalls', default: 0, hint: '0 = none', group: 'Parking' },
  { key: 'endIslands', label: 'Landscaped end caps', unit: '', default: 0, group: 'Parking', options: [[0, 'Off - stalls run to the end'], [1, 'At both ends of each row (planted)']] },
  { key: 'compactPct', label: 'Compact stalls', unit: '%', default: 0, group: 'Parking' },
  { key: 'compactWidth', label: 'Compact stall width', unit: 'ft', default: 8, step: 0.5, group: 'Parking' },
  { key: 'evPct', label: 'EV-ready stalls', unit: '%', default: 0, group: 'Parking' },
  { key: 'sharedParking', label: 'Shared parking (mixed use)', unit: '', default: 1, group: 'Parking', options: [[1, 'On - uses share by time of day'], [0, 'Off - add up each use']] },
];

const f = (key, label, unit, def, extra = {}) => ({ key, label, unit, default: def, group: 'Program', ...extra });

export const ASSET_TYPES = [
  {
    id: 'mf-garden',
    label: 'Multifamily - garden / walk-up',
    mode: 'bars',
    yieldKind: 'units',
    hasMix: true,
    fields: [
      f('floors', 'Floors', '', 3, { max: 100 }),
      f('floorToFloor', 'Floor-to-floor', 'ft', 10.5, { step: 0.5 }),
      f('buildingDepth', 'Building depth', 'ft', 65),
      f('maxBuildingLength', 'Max building length', 'ft', 300),
      f('buildingGap', 'Gap between buildings', 'ft', 30),
      f('efficiency', 'Efficiency (net / gross)', '%', 85, { hint: 'used for bars before units are laid out' }),
      f('parkingRatio', 'Parking required', 'per unit', 1.5, { step: 0.05 }),
      ...mfLayoutFields(),
    ],
  },
  {
    id: 'mf-podium',
    label: 'Multifamily - wrap / podium',
    mode: 'bars',
    yieldKind: 'units',
    hasMix: true,
    fields: [
      f('floors', 'Residential floors', '', 5, { max: 100 }),
      f('podiumLevels', 'Structured parking levels', '', 1, { max: 100 }),
      f('floorToFloor', 'Floor-to-floor', 'ft', 10.5, { step: 0.5 }),
      f('buildingDepth', 'Building depth', 'ft', 130),
      f('maxBuildingLength', 'Max building length', 'ft', 400),
      f('buildingGap', 'Gap between buildings', 'ft', 40),
      f('efficiency', 'Efficiency (net / gross)', '%', 80),
      f('sfPerStructuredStall', 'Garage area per stall', 'sf', 350),
      f('parkingRatio', 'Parking required', 'per unit', 1.25, { step: 0.05 }),
      ...mfLayoutFields(),
    ],
  },
  {
    id: 'townhome',
    label: 'Townhomes',
    mode: 'lots',
    yieldKind: 'units',
    fields: [
      f('lotWidth', 'Lot width', 'ft', 24),
      f('lotDepth', 'Lot depth', 'ft', 80),
      f('streetWidth', 'Street width', 'ft', 28),
      f('homeSize', 'Home size', 'sf', 1800),
      f('floors', 'Floors', '', 3, { max: 100 }),
      f('garageStalls', 'Garage stalls', 'per home', 2),
      f('parkingRatio', 'Parking required', 'per home', 2, { step: 0.05 }),
    ],
  },
  {
    id: 'sfr',
    label: 'Single-family lots',
    mode: 'lots',
    yieldKind: 'units',
    fields: [
      f('lotWidth', 'Lot width', 'ft', 50),
      f('lotDepth', 'Lot depth', 'ft', 110),
      f('streetWidth', 'Street right-of-way', 'ft', 50),
      f('homeSize', 'Home size', 'sf', 2400),
      f('floors', 'Floors', '', 2, { max: 100 }),
      f('garageStalls', 'Garage stalls', 'per home', 2),
      f('parkingRatio', 'Parking required', 'per home', 2, { step: 0.05 }),
    ],
  },
  {
    id: 'hotel',
    label: 'Hotel',
    mode: 'bars',
    yieldKind: 'keys',
    fields: [
      f('floors', 'Floors', '', 4, { max: 100 }),
      f('floorToFloor', 'Floor-to-floor', 'ft', 10, { step: 0.5 }),
      f('buildingDepth', 'Building depth', 'ft', 62),
      f('maxBuildingLength', 'Max building length', 'ft', 280),
      f('buildingGap', 'Gap between buildings', 'ft', 30),
      f('grossPerKey', 'Gross area per key', 'sf', 600),
      f('parkingRatio', 'Parking required', 'per key', 0.8, { step: 0.05 }),
    ],
  },
  {
    id: 'industrial',
    label: 'Industrial',
    mode: 'industrial',
    yieldKind: 'sf',
    fields: [
      f('clearHeight', 'Clear height', 'ft', 32),
      f('minBuildingDepth', 'Min building depth', 'ft', 160),
      f('maxBuildingDepth', 'Max building depth', 'ft', 600),
      f('truckCourt', 'Truck court depth', 'ft', 130),
      f('dockSpacing', 'Dock door spacing', 'ft', 12),
      f('trailerStallsPerDock', 'Trailer stalls required', 'per dock', 0.5, { step: 0.05 }),
      f('minTruckCourt', 'Truck court needed (WB-67)', 'ft', 120, { hint: 'depth a 53 ft trailer needs to back into a dock' }),
      f('truckAisleWidth', 'Truck drive width', 'ft', 30),
      f('truckTurnRadius', 'Truck turning radius', 'ft', 45, { hint: 'centre-line radius for a WB-67 tractor-trailer' }),
      f('trailerDepth', 'Trailer stall depth', 'ft', 53),
      f('parkingRatio', 'Car parking required', 'per 1,000 sf', 1, { step: 0.05 }),
    ],
  },
  {
    id: 'retail',
    label: 'Retail',
    mode: 'bars',
    yieldKind: 'sf',
    fields: [
      f('floors', 'Floors', '', 1, { max: 100 }),
      f('floorToFloor', 'Floor-to-floor', 'ft', 18, { step: 0.5 }),
      f('buildingDepth', 'Building depth', 'ft', 100),
      f('maxBuildingLength', 'Max building length', 'ft', 400),
      f('buildingGap', 'Gap between buildings', 'ft', 40),
      f('efficiency', 'Leasable share (GLA / gross)', '%', 95),
      f('parkingRatio', 'Parking required', 'per 1,000 sf', 4, { step: 0.05 }),
    ],
  },
  {
    id: 'parking',
    label: 'Surface parking',
    mode: 'parking',
    yieldKind: 'stalls',
    fields: [],
  },
  {
    id: 'garage',
    label: 'Parking garage',
    mode: 'garage',
    yieldKind: 'stalls',
    fields: [
      f('levels', 'Levels', '', 4, { max: 20 }),
      f('floorToFloor', 'Floor-to-floor', 'ft', 10.5, { step: 0.5 }),
      f('rampType', 'Ramp', '', 0, { options: [[0, 'Sloped floors - parking on the ramp'], [1, 'Express ramp - flat floors'], [2, 'Helix ramp - flat floors']] }),
      f('rampSlope', 'Ramp slope', '%', 5, { step: 0.5, hint: 'parking ramps 6.67% max; express ramps up to 12-15%' }),
      f('rampWidth', 'Ramp lane width', 'ft', 24),
      f('helixRadius', 'Helix inside radius', 'ft', 25),
      f('cores', 'Stair / elevator cores', '', 2, { max: 6 }),
      f('coreSize', 'Core size', 'ft', 20),
    ],
  },
  {
    id: 'datacenter',
    label: 'Data center',
    mode: 'datacenter',
    yieldKind: 'mw',
    fields: [
      f('floors', 'Floors', '', 1, { max: 4 }),
      f('floorToFloor', 'Floor-to-floor', 'ft', 24, { step: 0.5 }),
      f('minBuildingDepth', 'Min building depth', 'ft', 200),
      f('maxBuildingDepth', 'Max building depth', 'ft', 400),
      f('yardDepth', 'Equipment yard depth', 'ft', 90, { hint: 'generators, chillers, transformers along the building' }),
      f('whiteSpacePct', 'Data hall share of floor area', '%', 50),
      f('wattsPerSf', 'IT load density', 'W / sf of data hall', 200),
      f('generatorMw', 'Generator size', 'MW', 3, { step: 0.25 }),
      f('redundancyPct', 'Generator redundancy', '%', 25),
      f('parkingRatio', 'Parking required', 'per 1,000 sf', 0.3, { step: 0.05 }),
    ],
  },
];

export const ASSET_TYPE_IDS = ASSET_TYPES.map((t) => t.id);

// Pro forma inputs (proforma.js). Rental types end in a value from NOI
// and an exit cap; for-sale homes in sale revenue. Rough starting points
// to override, not market data.
const pf = (key, label, unit, def, extra = {}) => ({ key, label, unit, default: def, group: 'Pro forma', max: 1e10, ...extra });
const COST_FIELDS = (hardCost) => [
  pf('landCost', 'Land cost', '$', 0, { step: 10000 }),
  pf('hardCostPerSf', 'Hard cost', '$ / sf', hardCost),
  pf('softCostPct', 'Soft costs', '% of hard', 25),
  pf('surfaceStallCost', 'Surface stall cost', '$', 5000, { step: 500 }),
  pf('structuredStallCost', 'Structured stall cost', '$', 30000, { step: 1000 }),
];
const RENTAL_FIELDS = (vacancy, opex, cap) => [
  pf('vacancyPct', 'Vacancy', '%', vacancy, { step: 0.5 }),
  pf('opexPct', 'Operating costs', '% of income', opex),
  pf('exitCapPct', 'Exit cap rate', '%', cap, { step: 0.05 }),
];

export const PROFORMA_FIELDS = {
  'mf-garden': [...COST_FIELDS(165), pf('rentPerSfMonth', 'Rent', '$ / sf / mo', 1.95, { step: 0.05 }), pf('otherIncomePerUnitMonth', 'Other income', '$ / unit / mo', 50), ...RENTAL_FIELDS(5, 35, 5.5)],
  'mf-podium': [...COST_FIELDS(215), pf('rentPerSfMonth', 'Rent', '$ / sf / mo', 2.4, { step: 0.05 }), pf('otherIncomePerUnitMonth', 'Other income', '$ / unit / mo', 75), ...RENTAL_FIELDS(5, 35, 5.25)],
  townhome: [...COST_FIELDS(160), pf('lotDevCost', 'Lot development', '$ / home', 45000, { step: 1000 }), pf('salePrice', 'Sale price', '$ / home', 475000, { step: 5000 }), pf('sellingCostPct', 'Selling costs', '%', 6, { step: 0.5 })],
  sfr: [...COST_FIELDS(145), pf('lotDevCost', 'Lot development', '$ / home', 60000, { step: 1000 }), pf('salePrice', 'Sale price', '$ / home', 650000, { step: 5000 }), pf('sellingCostPct', 'Selling costs', '%', 6, { step: 0.5 })],
  hotel: [...COST_FIELDS(230), pf('adr', 'Average daily rate', '$', 160), pf('occupancyPct', 'Occupancy', '%', 70), pf('opexPct', 'Operating costs', '% of revenue', 70), pf('exitCapPct', 'Exit cap rate', '%', 7.5, { step: 0.05 })],
  industrial: [...COST_FIELDS(85), pf('rentPerSfYear', 'Rent (NNN)', '$ / sf / yr', 9, { step: 0.25 }), ...RENTAL_FIELDS(5, 8, 5.75)],
  retail: [...COST_FIELDS(160), pf('rentPerSfYear', 'Rent (NNN)', '$ / sf / yr', 28, { step: 0.5 }), ...RENTAL_FIELDS(7, 10, 6.5)],
  parking: [...COST_FIELDS(0), pf('revenuePerStallMonth', 'Revenue', '$ / stall / mo', 75), ...RENTAL_FIELDS(10, 20, 7)],
  garage: [...COST_FIELDS(0), pf('revenuePerStallMonth', 'Revenue', '$ / stall / mo', 110), ...RENTAL_FIELDS(10, 25, 7)],
  datacenter: [...COST_FIELDS(0), pf('costPerMw', 'Build cost', '$ / MW of IT load', 11000000, { step: 100000 }), pf('rentPerKwMonth', 'Rent', '$ / kW / mo', 140), ...RENTAL_FIELDS(2, 30, 6.25)],
};

export function getAssetType(id) {
  return ASSET_TYPES.find((t) => t.id === id) || ASSET_TYPES[0];
}

// Every field a type shows: its program, the shared site/zoning/parking
// fields, then its pro forma.
// The target yield, labelled for the type (0 = the most that fits), and
// a stall count to provide instead of the ratio, for types with one.
const TARGET_LABELS = { units: 'Target units', keys: 'Target keys', sf: 'Target leasable sf', mw: 'Target IT load', stalls: 'Target stalls' };
function targetFields(type) {
  const label = type.mode === 'lots' ? 'Target homes' : type.mode === 'industrial' ? 'Target building sf' : TARGET_LABELS[type.yieldKind];
  const out = [{
    key: 'targetYield', label, unit: type.yieldKind === 'mw' ? 'MW' : '', default: 0, step: type.yieldKind === 'mw' ? 0.5 : 1,
    hint: '0 = the most that fits; set a number to build exactly that', group: 'Program',
  }];
  if (type.fields.some((f) => f.key === 'parkingRatio')) {
    out.push({ key: 'parkingFixed', label: 'Stalls to provide', unit: '', default: 0, hint: '0 = what the parking ratio requires', group: 'Program' });
  }
  return out;
}

export function fieldsFor(type) {
  return [...type.fields, ...targetFields(type), ...COMMON_FIELDS, ...(PROFORMA_FIELDS[type.id] || [])];
}

export function defaultsFor(type) {
  const out = Object.fromEntries(fieldsFor(type).map((fd) => [fd.key, fd.default]));
  if (type.hasMix) out.mix = DEFAULT_MIX;
  // The front edge and a corner lot's second front (envelope.js), set on
  // the map or in the Site step rather than as fields; 0 = longest / none.
  out.frontEdge = 0;
  out.frontEdge2 = 0;
  out.rotation = 'auto';
  out.parkingRotation = 'auto';
  return out;
}

// The settings a scheme actually runs with. Overrides that aren't a field
// of the scheme's type (left from an earlier type) are ignored.
export function effectiveSettings(scheme) {
  const type = getAssetType(scheme.assetType);
  const defaults = defaultsFor(type);
  const out = { ...defaults };
  for (const [key, value] of Object.entries(scheme.overrides || {})) {
    if (key in defaults) out[key] = value;
  }
  return out;
}
