// Rules for the Site Planner (Dev Tools -> Site Planner): a drawn site
// boundary plus one or more schemes, each an asset type with the defaults
// it overrides. The layout itself is worked out in the browser
// (client/src/siteplanner/solver.js); the server only stores and checks
// the inputs. Kept free of database imports so scripts/tests can check
// them directly.

// Mirrors the ids in client/src/siteplanner/assetTypes.js - keep in sync.
export const ASSET_TYPE_IDS = ['mf-garden', 'mf-podium', 'townhome', 'sfr', 'hotel', 'industrial', 'retail', 'parking'];

export const MAX_NAME_LENGTH = 200;
export const MAX_SCHEMES = 12;
export const MAX_BOUNDARY_POINTS = 1000;
// One scheme's overrides, serialized - generous for a unit mix plus every
// numeric field, small enough that a row can't balloon.
export const MAX_OVERRIDES_BYTES = 8000;

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
    } else if (key === 'rotation') {
      if (v !== 'auto' && !(isFiniteNumber(v) && v >= -360 && v <= 360)) {
        throw new SitePlanValidationError('Orientation must be auto or an angle in degrees.');
      }
      out.rotation = v;
    } else {
      if (!isFiniteNumber(v) || v < 0 || v > 1000000) {
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
    return { id: s.id, name, assetType: s.assetType, overrides: validateOverrides(s.overrides) };
  });
}

// The scheme a new site starts with.
export function defaultSchemes() {
  return [{ id: 'a', name: 'Scheme A', assetType: 'mf-garden', overrides: {} }];
}
