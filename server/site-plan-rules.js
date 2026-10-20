// Rules for the Site Planner (Dev Tools -> Site Planner): a drawn site
// boundary plus one or more schemes, each an asset type with the defaults
// it overrides. The layout itself is worked out in the browser
// (client/src/siteplanner/solver.js); the server only stores and checks
// the inputs. Kept free of database imports so scripts/tests can check
// them directly.

// Mirrors the ids in client/src/siteplanner/assetTypes.js - keep in sync.
export const ASSET_TYPE_IDS = ['mf-garden', 'mf-podium', 'townhome', 'sfr', 'hotel', 'industrial', 'retail', 'parking', 'garage'];

export const MAX_NAME_LENGTH = 200;
export const MAX_SCHEMES = 12;
export const MAX_BOUNDARY_POINTS = 1000;
// One scheme's overrides, serialized - generous for a unit mix plus every
// numeric field, small enough that a row can't balloon.
export const MAX_OVERRIDES_BYTES = 8000;

export const MAX_SETTING_VALUE = 1e10;
export const MAX_PLACED_BUILDINGS = 100;
export const MAX_SPACES = 20;
export const SPACE_KINDS = ['no-build', 'asset'];
export const MAX_PARKING_AREAS = 30;
export const MAX_ENTRIES = 10;
export const STALL_ANGLES = [90, 60, 45];
export const MAX_DRIVE_AISLES = 30;
export const MAX_AISLE_POINTS = 200;

export class SitePlanValidationError extends Error {}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function validateName(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new SitePlanValidationError('A site needs a name.');
  if (text.length > MAX_NAME_LENGTH) {
    throw new SitePlanValidationError(`Keep the name under ${MAX_NAME_LENGTH} characters.`);
  }
  return text;
}

// A project is optional; '' or null clears it.
export function validateProjectId(value) {
  if (value === null || value === undefined || value === '') return null;
  if (!isUuid(value)) throw new SitePlanValidationError('That project id isn\'t valid.');
  return value;
}

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

// GeoJSON Polygon (outer ring only) in [lng, lat], or null before one is
// drawn. The ring is returned closed.
export function validateBoundary(value) {
  if (value === null || value === undefined) return null;
  if (!value || value.type !== 'Polygon' || !Array.isArray(value.coordinates) || !Array.isArray(value.coordinates[0])) {
    throw new SitePlanValidationError('The site boundary must be a polygon.');
  }
  const ring = value.coordinates[0];
  if (ring.length > MAX_BOUNDARY_POINTS) {
    throw new SitePlanValidationError(`Keep the site boundary under ${MAX_BOUNDARY_POINTS} points.`);
  }
  for (const pt of ring) {
    if (!Array.isArray(pt) || pt.length < 2 || !isFiniteNumber(pt[0]) || !isFiniteNumber(pt[1])
      || Math.abs(pt[0]) > 180 || Math.abs(pt[1]) > 90) {
      throw new SitePlanValidationError('The site boundary has a point that isn\'t a valid location.');
    }
  }
  const points = ring.map((pt) => [pt[0], pt[1]]);
  const [first] = points;
  const last = points[points.length - 1];
  if (first && (first[0] !== last[0] || first[1] !== last[1])) points.push([first[0], first[1]]);
  if (points.length < 4) throw new SitePlanValidationError('The site boundary needs at least three corners.');
  return { type: 'Polygon', coordinates: [points] };
}

// Where the map was last looking, so a site with no boundary yet reopens
// at the address that was searched.
export function validateMapView(value) {
  if (value === null || value === undefined) return null;
  const { lat, lng, zoom } = value || {};
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng) || !isFiniteNumber(zoom)
    || Math.abs(lat) > 90 || Math.abs(lng) > 180 || zoom < 0 || zoom > 22) {
    throw new SitePlanValidationError('The map view isn\'t valid.');
  }
  return { lat, lng, zoom };
}

// Overrides are the fields a scheme changed from its asset type's
// defaults: numbers, plus an optional unit mix. Anything else is refused
// rather than stored.
function validateOverrides(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new SitePlanValidationError('A scheme\'s overrides must be an object.');
  }
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(key)) throw new SitePlanValidationError(`Unknown setting "${key}".`);
    if (key === 'mix') {
      if (!Array.isArray(v) || v.length === 0 || v.length > 12) {
        throw new SitePlanValidationError('A unit mix needs 1 to 12 unit types.');
      }
      out.mix = v.map((u) => {
        if (!u || typeof u.name !== 'string' || !u.name.trim() || u.name.length > 40
          || !isFiniteNumber(u.size) || u.size <= 0 || u.size > 100000
          || !isFiniteNumber(u.pct) || u.pct < 0 || u.pct > 100) {
          throw new SitePlanValidationError('Each unit type needs a name, a size and a percentage.');
        }
        return { name: u.name.trim(), size: u.size, pct: u.pct };
      });
    } else if (key === 'rotation' || key === 'parkingRotation') {
      if (v !== 'auto' && !(isFiniteNumber(v) && v >= -360 && v <= 360)) {
        throw new SitePlanValidationError('Orientation must be auto or an angle in degrees.');
      }
      out[key] = v;
    } else {
      // Up to 10 billion: land cost and other pro forma dollar inputs.
      if (!isFiniteNumber(v) || v < 0 || v > MAX_SETTING_VALUE) {
        throw new SitePlanValidationError(`"${key}" must be a number from 0 up.`);
      }
      out[key] = v;
    }
  }
  if (JSON.stringify(out).length > MAX_OVERRIDES_BYTES) {
    throw new SitePlanValidationError('A scheme has too many settings.');
  }
  return out;
}

// Buildings placed by hand (Edit layout): a rectangle each, by centre,
// length and depth in feet, and angle in degrees; floors optional.
function validateEdits(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || !Array.isArray(value.buildings)) {
    throw new SitePlanValidationError('Layout edits must list buildings.');
  }
  if (value.buildings.length > MAX_PLACED_BUILDINGS) {
    throw new SitePlanValidationError(`Keep it to ${MAX_PLACED_BUILDINGS} buildings.`);
  }
  const ids = new Set();
  const buildings = value.buildings.map((b) => {
    if (!b || typeof b.id !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(b.id) || ids.has(b.id)) {
      throw new SitePlanValidationError('Each building needs its own id.');
    }
    ids.add(b.id);
    const c = b.center;
    if (!Array.isArray(c) || !isFiniteNumber(c[0]) || !isFiniteNumber(c[1]) || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) {
      throw new SitePlanValidationError('A building is placed somewhere that isn\'t a valid location.');
    }
    for (const [key, min, max] of [['length', 1, 5000], ['depth', 1, 5000], ['angle', -360, 360]]) {
      if (!isFiniteNumber(b[key]) || b[key] < min || b[key] > max) {
        throw new SitePlanValidationError(`A building's ${key} must be between ${min} and ${max}.`);
      }
    }
    const out = { id: b.id, center: [c[0], c[1]], length: b.length, depth: b.depth, angle: b.angle };
    if (b.floors !== undefined && b.floors !== null) {
      if (!Number.isInteger(b.floors) || b.floors < 1 || b.floors > 100) {
        throw new SitePlanValidationError('A building\'s floors must be a whole number from 1 to 100.');
      }
      out.floors = b.floors;
    }
    return out;
  });
  return { buildings };
}

// Spaces drawn on the site: no-build areas, or areas with their own asset
// type and settings.
function validateSpaces(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SitePlanValidationError('Spaces must be a list.');
  if (value.length > MAX_SPACES) throw new SitePlanValidationError(`Keep it to ${MAX_SPACES} spaces.`);
  const ids = new Set();
  return value.map((sp) => {
    if (!sp || typeof sp.id !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(sp.id) || ids.has(sp.id)) {
      throw new SitePlanValidationError('Each space needs its own id.');
    }
    ids.add(sp.id);
    const name = typeof sp.name === 'string' ? sp.name.trim() : '';
    if (!name || name.length > 100) throw new SitePlanValidationError('Each space needs a name under 100 characters.');
    if (!SPACE_KINDS.includes(sp.kind)) throw new SitePlanValidationError(`A space's kind must be one of ${SPACE_KINDS.join(', ')}`);
    const polygon = validateBoundary(sp.polygon);
    if (!polygon) throw new SitePlanValidationError('Each space needs a shape.');
    const out = { id: sp.id, name, kind: sp.kind, polygon };
    if (sp.kind === 'asset') {
      if (!ASSET_TYPE_IDS.includes(sp.assetType)) {
        throw new SitePlanValidationError(`assetType must be one of ${ASSET_TYPE_IDS.join(', ')}`);
      }
      out.assetType = sp.assetType;
      out.overrides = validateOverrides(sp.overrides);
    }
    return out;
  });
}

// Parking areas drawn by hand: a shape each, with a stall orientation
// ('auto' or degrees) and optionally their own stall angle.
function validateParkingAreas(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SitePlanValidationError('Parking areas must be a list.');
  if (value.length > MAX_PARKING_AREAS) throw new SitePlanValidationError(`Keep it to ${MAX_PARKING_AREAS} parking areas.`);
  const ids = new Set();
  return value.map((a) => {
    if (!a || typeof a.id !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(a.id) || ids.has(a.id)) {
      throw new SitePlanValidationError('Each parking area needs its own id.');
    }
    ids.add(a.id);
    const polygon = validateBoundary(a.polygon);
    if (!polygon) throw new SitePlanValidationError('Each parking area needs a shape.');
    const angle = a.angle === undefined || a.angle === null ? 'auto' : a.angle;
    if (angle !== 'auto' && !(isFiniteNumber(angle) && angle >= -360 && angle <= 360)) {
      throw new SitePlanValidationError('A parking area\'s orientation must be auto or an angle in degrees.');
    }
    const out = { id: a.id, polygon, angle };
    if (a.stallAngle !== undefined && a.stallAngle !== null) {
      if (!STALL_ANGLES.includes(a.stallAngle)) throw new SitePlanValidationError(`Stall angle must be one of ${STALL_ANGLES.join(', ')}.`);
      out.stallAngle = a.stallAngle;
    }
    return out;
  });
}

// Driveway entries: a point each on (or near) the boundary.
function validateEntries(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SitePlanValidationError('Entries must be a list.');
  if (value.length > MAX_ENTRIES) throw new SitePlanValidationError(`Keep it to ${MAX_ENTRIES} entries.`);
  const ids = new Set();
  return value.map((e) => {
    if (!e || typeof e.id !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(e.id) || ids.has(e.id)) {
      throw new SitePlanValidationError('Each entry needs its own id.');
    }
    ids.add(e.id);
    const p = e.point;
    if (!Array.isArray(p) || !isFiniteNumber(p[0]) || !isFiniteNumber(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) {
      throw new SitePlanValidationError('An entry is somewhere that isn\'t a valid location.');
    }
    return { id: e.id, point: [p[0], p[1]] };
  });
}

// Drive aisles drawn by hand: a line each, with an optional width (ft)
// and whether it's two-way.
function validateDriveAisles(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SitePlanValidationError('Drive aisles must be a list.');
  if (value.length > MAX_DRIVE_AISLES) throw new SitePlanValidationError(`Keep it to ${MAX_DRIVE_AISLES} drive aisles.`);
  const ids = new Set();
  return value.map((a) => {
    if (!a || typeof a.id !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(a.id) || ids.has(a.id)) {
      throw new SitePlanValidationError('Each drive aisle needs its own id.');
    }
    ids.add(a.id);
    const coords = a.line && a.line.type === 'LineString' && Array.isArray(a.line.coordinates) ? a.line.coordinates : null;
    if (!coords || coords.length < 2 || coords.length > MAX_AISLE_POINTS) {
      throw new SitePlanValidationError(`A drive aisle must be a line of 2 to ${MAX_AISLE_POINTS} points.`);
    }
    for (const p of coords) {
      if (!Array.isArray(p) || !isFiniteNumber(p[0]) || !isFiniteNumber(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) {
        throw new SitePlanValidationError('A drive aisle has a point that isn\'t a valid location.');
      }
    }
    const out = { id: a.id, line: { type: 'LineString', coordinates: coords.map((p) => [p[0], p[1]]) }, twoWay: a.twoWay !== false };
    if (a.width !== undefined && a.width !== null) {
      if (!isFiniteNumber(a.width) || a.width < 8 || a.width > 80) throw new SitePlanValidationError('A drive aisle\'s width must be 8 to 80 ft.');
      out.width = a.width;
    }
    return out;
  });
}

export function validateSchemes(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new SitePlanValidationError('A site needs at least one scheme.');
  }
  if (value.length > MAX_SCHEMES) throw new SitePlanValidationError(`Keep it to ${MAX_SCHEMES} schemes.`);
  const ids = new Set();
  return value.map((s) => {
    if (!s || typeof s !== 'object') throw new SitePlanValidationError('Each scheme must be an object.');
    if (typeof s.id !== 'string' || !/^[a-zA-Z0-9_-]{1,40}$/.test(s.id) || ids.has(s.id)) {
      throw new SitePlanValidationError('Each scheme needs its own id.');
    }
    ids.add(s.id);
    const name = typeof s.name === 'string' ? s.name.trim() : '';
    if (!name || name.length > 100) throw new SitePlanValidationError('Each scheme needs a name under 100 characters.');
    if (!ASSET_TYPE_IDS.includes(s.assetType)) {
      throw new SitePlanValidationError(`assetType must be one of ${ASSET_TYPE_IDS.join(', ')}`);
    }
    const out = { id: s.id, name, assetType: s.assetType, overrides: validateOverrides(s.overrides) };
    const edits = validateEdits(s.edits);
    if (edits) out.edits = edits;
    const spaces = validateSpaces(s.spaces);
    if (spaces.length) out.spaces = spaces;
    const parkingAreas = validateParkingAreas(s.parkingAreas);
    if (parkingAreas.length) out.parkingAreas = parkingAreas;
    const entries = validateEntries(s.entries);
    if (entries.length) out.entries = entries;
    const driveAisles = validateDriveAisles(s.driveAisles);
    if (driveAisles.length) out.driveAisles = driveAisles;
    return out;
  });
}

// A saved preset (#4): an asset type and the settings it overrides,
// reusable on any site.
export function validatePreset({ name, assetType, overrides }) {
  const text = typeof name === 'string' ? name.trim() : '';
  if (!text || text.length > 100) throw new SitePlanValidationError('A preset needs a name under 100 characters.');
  if (!ASSET_TYPE_IDS.includes(assetType)) {
    throw new SitePlanValidationError(`assetType must be one of ${ASSET_TYPE_IDS.join(', ')}`);
  }
  return { name: text, assetType, overrides: validateOverrides(overrides) };
}

// The scheme a new site starts with.
export function defaultSchemes() {
  return [{ id: 'a', name: 'Scheme A', assetType: 'mf-garden', overrides: {} }];
}
