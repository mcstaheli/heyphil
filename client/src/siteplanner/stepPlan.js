// The editor's steps for an asset type, in the order a test fit gets
// built: the site, what goes on it, the limits, the ground set aside,
// the buildings, then trucks / parking, the money, and the answer. Each
// step lists the settings it shows, so every setting lives in exactly
// one step, and the steps change with the type: a garage has decks and
// ramps instead of buildings, industrial adds a truck court, lots are
// lots and streets.
import { fieldsFor } from './assetTypes';

// What the use is - the program's demand side.
const USE_KEYS = ['mix', 'efficiency', 'grossPerKey', 'homeSize', 'whiteSpacePct', 'wattsPerSf', 'generatorMw', 'redundancyPct'];
const TRUCK_KEYS = ['truckCourt', 'dockSpacing', 'trailerStallsPerDock', 'minTruckCourt', 'truckAisleWidth', 'truckTurnRadius', 'trailerDepth'];
// How many stalls the use needs, and podium parking's area per stall.
const PARKING_PROGRAM_KEYS = ['parkingRatio', 'garageStalls', 'sfPerStructuredStall'];

function buildingsTitle(type) {
  if (type.mode === 'lots') return 'Lots & streets';
  if (type.mode === 'industrial') return 'Building';
  if (type.mode === 'datacenter') return 'Data halls & yard';
  return type.hasMix ? 'Buildings & units' : 'Buildings';
}

export function modelSteps(type) {
  const fields = fieldsFor(type);
  const keysIn = (group) => fields.filter((f) => f.group === group).map((f) => f.key);
  const program = [...keysIn('Program'), ...keysIn('Building')];
  const pick = (list) => program.filter((k) => list.includes(k));
  const use = [...(type.hasMix ? ['mix'] : []), ...pick(USE_KEYS)];
  const trucks = type.mode === 'industrial' ? pick(TRUCK_KEYS) : [];
  const parkingProgram = pick(PARKING_PROGRAM_KEYS);
  const massing = program.filter((k) => !USE_KEYS.includes(k) && !trucks.includes(k) && !parkingProgram.includes(k));
  // Homes park in their own garages; the surface parking settings don't apply.
  const parkingKeys = [...parkingProgram, ...(type.mode === 'lots' ? [] : keysIn('Parking'))];

  const steps = [
    { id: 'site', title: 'Site', keys: keysIn('Site') },
    { id: 'use', title: 'Use', keys: use },
    { id: 'zoning', title: 'Zoning', keys: keysIn('Zoning') },
    { id: 'spaces', title: 'Spaces', keys: [] },
  ];
  if (type.mode === 'garage') steps.push({ id: 'garage', title: 'Decks & ramps', keys: massing });
  else if (type.mode !== 'parking') steps.push({ id: 'buildings', title: buildingsTitle(type), keys: massing });
  if (trucks.length) steps.push({ id: 'trucks', title: 'Truck court & trailers', keys: trucks });
  steps.push(
    { id: 'parking', title: type.mode === 'parking' ? 'Parking lot' : type.mode === 'lots' ? 'Parking' : type.mode === 'garage' ? 'Stalls' : 'Parking', keys: parkingKeys },
    { id: 'proforma', title: 'Pro forma', keys: keysIn('Pro forma') },
    { id: 'results', title: 'Results', keys: [] },
  );
  return steps.map((st, i) => ({ ...st, index: i + 1 }));
}

// Which step holds the editor for something selected on the map.
export function stepForSelection(kind, steps) {
  const has = (id) => steps.some((st) => st.id === id);
  if (kind === 'building' || kind === 'auto') return has('buildings') ? 'buildings' : null;
  if (kind === 'space') return 'spaces';
  if (kind === 'area' || kind === 'aisle' || kind === 'bay') return 'parking';
  return null;
}
