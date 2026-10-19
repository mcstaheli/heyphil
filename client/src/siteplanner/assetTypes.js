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

export const DEFAULT_MIX = [
  { name: 'Studio', size: 550, pct: 10 },
  { name: '1 BR', size: 750, pct: 45 },
  { name: '2 BR', size: 1050, pct: 35 },
  { name: '3 BR', size: 1300, pct: 10 },
];

// Zoning limits and stall geometry every type shares. 0 means no limit.
export const COMMON_FIELDS = [
  { key: 'setback', label: 'Setback', unit: 'ft', default: 20, group: 'Site' },
  { key: 'maxHeight', label: 'Max height', unit: 'ft', default: 0, hint: '0 = no limit', group: 'Zoning' },
  { key: 'maxFar', label: 'Max FAR', unit: '', default: 0, step: 0.1, hint: '0 = no limit', group: 'Zoning' },
  { key: 'maxCoverage', label: 'Max lot coverage', unit: '%', default: 0, hint: '0 = no limit', group: 'Zoning' },
  { key: 'stallWidth', label: 'Stall width', unit: 'ft', default: 9, step: 0.5, group: 'Parking' },
  { key: 'stallDepth', label: 'Stall depth', unit: 'ft', default: 18, step: 0.5, group: 'Parking' },
  { key: 'aisleWidth', label: 'Drive aisle', unit: 'ft', default: 24, group: 'Parking' },
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
      f('efficiency', 'Efficiency (net / gross)', '%', 85),
      f('parkingRatio', 'Parking required', 'per unit', 1.5, { step: 0.05 }),
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
];

export const ASSET_TYPE_IDS = ASSET_TYPES.map((t) => t.id);

export function getAssetType(id) {
  return ASSET_TYPES.find((t) => t.id === id) || ASSET_TYPES[0];
}

// Every field a type shows, shared ones last.
export function fieldsFor(type) {
  return [...type.fields, ...COMMON_FIELDS];
}

export function defaultsFor(type) {
  const out = Object.fromEntries(fieldsFor(type).map((fd) => [fd.key, fd.default]));
  if (type.hasMix) out.mix = DEFAULT_MIX;
  out.rotation = 'auto';
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
