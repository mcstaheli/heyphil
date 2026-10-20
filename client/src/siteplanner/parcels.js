// Parcels for the Site Planner. Lot lines everywhere come from Regrid's
// nationwide layer (a map overlay); the details behind a click - parcel
// ID, address, county, ownership type and the parcel's shape - come from
// Utah's statewide parcel service (UGRC), which allows browser requests.
import turfArea from '@turf/area';

export const UTAH_PARCELS_URL = 'https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services/UtahStatewideParcels/FeatureServer/0/query';
const SQM_PER_ACRE = 4046.8564224;
const MAX_POINTS = 1000; // the site boundary's limit

// Utah's rough extent, to say why a click elsewhere has no details.
export function inUtah(lat, lng) {
  return lat >= 36.99 && lat <= 42.01 && lng >= -114.06 && lng <= -109.03;
}

// The parcel's outline as a Polygon the site boundary accepts: the
// largest piece's outer ring, thinned if it has more points than allowed.
export function parcelBoundary(geometry) {
  if (!geometry) return null;
  let ring = null;
  if (geometry.type === 'Polygon') ring = geometry.coordinates[0];
  else if (geometry.type === 'MultiPolygon') {
    let bestArea = -1;
    for (const poly of geometry.coordinates) {
      const area = turfArea({ type: 'Polygon', coordinates: [poly[0]] });
      if (area > bestArea) {
        bestArea = area;
        ring = poly[0];
      }
    }
  }
  if (!ring || ring.length < 4) return null;
  let pts = ring.map(([lng, lat]) => [Number(lng.toFixed(7)), Number(lat.toFixed(7))]);
  if (pts.length > MAX_POINTS) {
    const step = Math.ceil(pts.length / (MAX_POINTS - 1));
    pts = pts.filter((_, i) => i % step === 0);
  }
  const [a] = pts;
  const b = pts[pts.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) pts.push([...a]);
  return pts.length >= 4 ? { type: 'Polygon', coordinates: [pts] } : null;
}

// What we show for a parcel, from the service's fields.
export function parcelInfo(props, geometry) {
  const boundary = parcelBoundary(geometry);
  return {
    id: props.PARCEL_ID || null,
    address: props.PARCEL_ADD || null,
    city: props.PARCEL_CITY || null,
    zip: props.PARCEL_ZIP || null,
    county: props.County || null,
    ownership: props.OWN_TYPE || null,
    countyUrl: props.CoParcel_URL || null,
    asOf: (() => {
      const d = props.ParcelsCur ? new Date(props.ParcelsCur) : null;
      return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
    })(),
    acres: boundary ? turfArea({ type: 'Feature', properties: {}, geometry: boundary }) / SQM_PER_ACRE : null,
    boundary,
  };
}

// The parcel under a point: { parcel } or { parcel: null, reason }.
export async function parcelAt(lat, lng, fetchImpl = fetch) {
  if (!inUtah(lat, lng)) {
    return { parcel: null, reason: 'Parcel details are available in Utah for now. Lot lines still show elsewhere - zoom in with the Parcels layer on.' };
  }
  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'PARCEL_ID,PARCEL_ADD,PARCEL_CITY,PARCEL_ZIP,OWN_TYPE,County,CoParcel_URL,ParcelsCur',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
  });
  const res = await fetchImpl(`${UTAH_PARCELS_URL}?${params}`);
  if (!res.ok) throw new Error('The parcel service didn\'t answer - try again in a moment.');
  const data = await res.json();
  const feature = (data.features || [])[0];
  if (!feature) return { parcel: null, reason: 'No parcel there - it may be a street or right-of-way.' };
  return { parcel: parcelInfo(feature.properties || {}, feature.geometry) };
}
