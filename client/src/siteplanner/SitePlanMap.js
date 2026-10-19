import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import { makeProjection, rectCorners } from './geometry';

// The Site Planner's map: satellite imagery, the site boundary and any
// spaces you draw (Geoman: draw, reshape, drag, rotate), hand-placed
// buildings with their own handles (move, stretch, rotate), the solver's
// layout on top, and flood / wetland overlays. Leaflet is driven directly
// rather than through a React wrapper; React hands it what to show and
// gets edits back through callbacks.

const SATELLITE = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
};
const STREETS = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};

// Public ArcGIS map services, drawn as tiles from their export endpoint.
// Each only draws once zoomed in past its own scale limit.
const OVERLAYS = [
  {
    label: 'FEMA flood zones (zoom in)',
    url: 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer',
    layerId: 28,
    minZoom: 14,
    attribution: 'Flood zones: FEMA National Flood Hazard Layer',
  },
  {
    label: 'Wetlands (zoom in)',
    url: 'https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer',
    layerId: 0,
    minZoom: 11,
    attribution: 'Wetlands: U.S. Fish &amp; Wildlife Service NWI',
  },
];

const ArcGISExportLayer = L.TileLayer.extend({
  getTileUrl(coords) {
    const size = this.getTileSize();
    const nw = coords.scaleBy(size);
    const se = nw.add(size);
    const crs = this._map.options.crs;
    const a = crs.project(this._map.unproject(nw, coords.z));
    const b = crs.project(this._map.unproject(se, coords.z));
    const bbox = [a.x, b.y, b.x, a.y].join(',');
    return `${this._url}/export?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=${size.x},${size.y}`
      + `&format=png32&transparent=true&layers=show:${this.options.layerId}&f=image`;
  },
});

const US_VIEW = { lat: 39.5, lng: -98.35, zoom: 4 };
const MAX_SIDE = 5000; // ft, the server's limit for a placed building

const STYLES = {
  boundary: { color: '#ff9f1c', weight: 3, fillOpacity: 0.05 },
  setback: { color: '#ffffff', weight: 1.5, dashArray: '6 6', fill: false, interactive: false, pmIgnore: true },
  building: { color: '#4c3ce0', weight: 1.5, fillColor: '#7b6cf6', fillOpacity: 0.75, pmIgnore: true },
  placed: { color: '#4c3ce0', weight: 2, fillColor: '#7b6cf6', fillOpacity: 0.8, pmIgnore: true },
  placedSelected: { color: '#facc15', weight: 3, fillColor: '#8b5cf6', fillOpacity: 0.85, pmIgnore: true },
  placedBad: { color: '#ef4444', weight: 3, fillColor: '#f87171', fillOpacity: 0.75, pmIgnore: true },
  parking: { color: '#e5e7eb', weight: 1, fillColor: '#374151', fillOpacity: 0.55, pmIgnore: true, interactive: false },
  stall: { color: '#f9fafb', weight: 0.75, opacity: 0.9, pmIgnore: true, interactive: false },
  lot: { color: '#16a34a', weight: 1, fillColor: '#4ade80', fillOpacity: 0.45, pmIgnore: true },
  street: { color: '#9ca3af', weight: 1, fillColor: '#6b7280', fillOpacity: 0.6, pmIgnore: true, interactive: false },
  truck: { color: '#d1d5db', weight: 1, fillColor: '#9ca3af', fillOpacity: 0.45, dashArray: '4 4', pmIgnore: true, interactive: false },
  spaceNoBuild: { color: '#10b981', weight: 2, dashArray: '5 4', fillColor: '#34d399', fillOpacity: 0.3 },
  spaceAsset: { color: '#f43f5e', weight: 2, fillColor: '#fb7185', fillOpacity: 0.25 },
};

const geoToLatLngs = (geometry) => geometry.coordinates[0].slice(0, -1).map(([lng, lat]) => [lat, lng]);

// A placed building's corners as [lat, lng], from its centre ([lng, lat]),
// length, depth (ft) and angle (degrees).
function buildingLatLngs(b) {
  const proj = makeProjection([b.center]);
  return rectCorners(0, 0, b.length, b.depth, (b.angle * Math.PI) / 180).map((p) => proj.toLatLng(p));
}

// Where a building's handles sit, as [lat, lng].
function handlePoints(b) {
  const proj = makeProjection([b.center]);
  const a = (b.angle * Math.PI) / 180;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  return {
    move: proj.toLatLng([0, 0]),
    length: proj.toLatLng([(b.length / 2) * ux, (b.length / 2) * uy]),
    depth: proj.toLatLng([(-b.depth / 2) * uy, (b.depth / 2) * ux]),
    rotate: proj.toLatLng([(b.length / 2 + 30) * ux, (b.length / 2 + 30) * uy]),
  };
}

const handleIcon = (kind) => L.divIcon({
  className: `siteplan-handle siteplan-handle-${kind}`,
  html: { move: '✥', length: '↔', depth: '↕', rotate: '⟳' }[kind],
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

function SitePlanMap({
  boundary, initialView, layout, spaceLayouts, flyTo, onBoundaryChange, buildingLabel,
  spaces, selectedSpaceId, onSelectSpace, onSpaceChange, onSpaceDrawn, drawRequest,
  placed, badBuildingIds, selectedBuildingId, onSelectBuilding, onBuildingChange,
}) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const svgRef = useRef(null);
  const boundaryLayerRef = useRef(null);
  const layoutGroupRef = useRef(null);
  const spaceGroupRef = useRef(null);
  const spaceLayersRef = useRef(new Map()); // id -> { layer, json }
  const placedGroupRef = useRef(null);
  const lastEmittedRef = useRef(null);
  const drawTargetRef = useRef(null);
  // Callbacks change every render; the map's listeners read them here.
  const cb = useRef({});
  cb.current = { onBoundaryChange, onSelectSpace, onSpaceChange, onSpaceDrawn, onSelectBuilding, onBuildingChange };

  // Hooks the drawn boundary up so reshaping, dragging or rotating it
  // reports back.
  const adoptBoundary = (layer) => {
    const map = mapRef.current;
    if (boundaryLayerRef.current && boundaryLayerRef.current !== layer) map.removeLayer(boundaryLayerRef.current);
    boundaryLayerRef.current = layer;
    layer.setStyle(STYLES.boundary);
    const emit = () => {
      const geometry = layer.toGeoJSON().geometry;
      lastEmittedRef.current = JSON.stringify(geometry);
      cb.current.onBoundaryChange(geometry);
    };
    layer.on('pm:edit', emit);
    layer.on('pm:dragend', emit);
    layer.on('pm:rotateend', emit);
    return emit;
  };

  useEffect(() => {
    const map = L.map(elRef.current, { preferCanvas: true, zoomControl: true, maxZoom: 21 });
    mapRef.current = map;
    // Hand-placed buildings use SVG so they take mouse presses for dragging.
    svgRef.current = L.svg({ padding: 0.5 });
    const satellite = L.tileLayer(SATELLITE.url, { attribution: SATELLITE.attribution, maxNativeZoom: 19, maxZoom: 21 });
    const streets = L.tileLayer(STREETS.url, { attribution: STREETS.attribution, maxNativeZoom: 19, maxZoom: 21 });
    satellite.addTo(map);
    const overlays = Object.fromEntries(OVERLAYS.map((o) => [
      o.label,
      new ArcGISExportLayer(o.url, { layerId: o.layerId, minZoom: o.minZoom, maxZoom: 21, opacity: 0.55, attribution: o.attribution }),
    ]));
    L.control.layers({ Satellite: satellite, Streets: streets }, overlays, { position: 'topright' }).addTo(map);
    L.control.scale({ imperial: true, metric: false }).addTo(map);
    layoutGroupRef.current = L.layerGroup().addTo(map);
    spaceGroupRef.current = L.featureGroup().addTo(map);
    placedGroupRef.current = L.layerGroup().addTo(map);

    map.pm.addControls({
      position: 'topleft',
      drawMarker: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawCircle: false,
      drawText: false,
      cutPolygon: false,
      removalMode: false,
      drawRectangle: true,
      drawPolygon: true,
      editMode: true,
      dragMode: true,
      rotateMode: true,
    });
    map.pm.setGlobalOptions({ allowSelfIntersection: false, snappable: true });
    map.on('pm:create', (e) => {
      if (drawTargetRef.current === 'space') {
        drawTargetRef.current = null;
        const geometry = e.layer.toGeoJSON().geometry;
        map.removeLayer(e.layer); // it comes back as a space once saved
        cb.current.onSpaceDrawn(geometry);
        return;
      }
      adoptBoundary(e.layer)();
    });
    map.on('pm:drawend', () => { drawTargetRef.current = null; });
    map.on('click', () => {
      cb.current.onSelectBuilding?.(null);
      cb.current.onSelectSpace?.(null);
    });

    if (boundary) {
      const layer = L.polygon(geoToLatLngs(boundary));
      layer.addTo(map);
      adoptBoundary(layer);
      lastEmittedRef.current = JSON.stringify(boundary);
      map.fitBounds(layer.getBounds(), { padding: [40, 40] });
    } else {
      const view = initialView || US_VIEW;
      map.setView([view.lat, view.lng], view.zoom);
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // The map is built once; later changes are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A boundary that arrives from outside (cleared, or reloaded) replaces
  // the drawn one; the map's own edits come back here unchanged and are
  // skipped.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const json = boundary ? JSON.stringify(boundary) : null;
    if (json === lastEmittedRef.current) return;
    lastEmittedRef.current = json;
    if (boundaryLayerRef.current) {
      map.removeLayer(boundaryLayerRef.current);
      boundaryLayerRef.current = null;
    }
    if (boundary) {
      const layer = L.polygon(geoToLatLngs(boundary));
      layer.addTo(map);
      adoptBoundary(layer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundary]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    map.setView([flyTo.lat, flyTo.lng], flyTo.zoom);
  }, [flyTo]);

  // "+ Space" asks the map to start drawing one.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !drawRequest) return;
    drawTargetRef.current = 'space';
    map.pm.enableDraw(drawRequest.shape || 'Rectangle', { snappable: true });
  }, [drawRequest]);

  // Spaces: one Geoman-editable polygon each. A layer is rebuilt only when
  // its shape changed from outside; its own edits are recognised and kept.
  useEffect(() => {
    const group = spaceGroupRef.current;
    if (!group) return;
    const layers = spaceLayersRef.current;
    const wanted = new Map((spaces || []).map((sp) => [sp.id, sp]));
    for (const [id, entry] of layers) {
      if (!wanted.has(id)) {
        group.removeLayer(entry.layer);
        layers.delete(id);
      }
    }
    for (const sp of wanted.values()) {
      const json = JSON.stringify(sp.polygon);
      let entry = layers.get(sp.id);
      if (entry && entry.json !== json) {
        group.removeLayer(entry.layer);
        entry = null;
      }
      if (!entry) {
        const layer = L.polygon(geoToLatLngs(sp.polygon));
        const emit = () => {
          const geometry = layer.toGeoJSON().geometry;
          layers.get(sp.id).json = JSON.stringify(geometry);
          cb.current.onSpaceChange(sp.id, geometry);
        };
        layer.on('pm:edit', emit);
        layer.on('pm:dragend', emit);
        layer.on('pm:rotateend', emit);
        layer.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          cb.current.onSelectSpace(sp.id);
        });
        group.addLayer(layer);
        entry = { layer, json };
        layers.set(sp.id, entry);
      }
      const style = sp.kind === 'no-build' ? STYLES.spaceNoBuild : STYLES.spaceAsset;
      entry.layer.setStyle({ ...style, weight: sp.id === selectedSpaceId ? 4 : style.weight });
      entry.layer.unbindTooltip();
      entry.layer.bindTooltip(sp.name, { permanent: true, direction: 'center', className: 'siteplan-space-label' });
    }
  }, [spaces, selectedSpaceId]);

  // The solver's layout (and each asset space's). With buildings placed
  // by hand, those are drawn by the placed-building layer instead.
  useEffect(() => {
    const group = layoutGroupRef.current;
    if (!group) return;
    group.clearLayers();
    const draw = (g, withBuildings) => {
      if (!g) return;
      (g.streets || []).forEach((r) => L.polygon(r, STYLES.street).addTo(group));
      (g.truckCourts || []).forEach((r) => L.polygon(r, STYLES.truck).addTo(group));
      (g.parking || []).forEach((p) => {
        L.polygon(p.outline, STYLES.parking).addTo(group);
        p.stalls.forEach((line) => L.polyline(line, STYLES.stall).addTo(group));
      });
      (g.lots || []).forEach((r) => L.polygon(r, STYLES.lot).addTo(group));
      if (withBuildings) {
        (g.buildings || []).forEach((r, i) => {
          const poly = L.polygon(r, STYLES.building).addTo(group);
          if (buildingLabel && g === layout) poly.bindTooltip(buildingLabel(i), { sticky: true });
        });
      }
    };
    if (layout?.setback) layout.setback.forEach((ring) => L.polygon(ring, STYLES.setback).addTo(group));
    draw(layout, !placed);
    (spaceLayouts || []).forEach((g) => draw(g, true));
    // The boundary stays on top so it can still be grabbed and edited.
    if (boundaryLayerRef.current) boundaryLayerRef.current.bringToFront();
  }, [layout, spaceLayouts, buildingLabel, placed]);

  // Hand-placed buildings: click to select; drag the body or the ✥
  // handle to move, ↔ / ↕ to stretch, ⟳ to rotate. Changes show live and
  // are reported when the drag ends.
  useEffect(() => {
    const map = mapRef.current;
    const group = placedGroupRef.current;
    if (!map || !group) return;
    group.clearLayers();
    if (!placed) return;
    const bad = new Set(badBuildingIds || []);
    for (const original of placed) {
      let b = { ...original };
      const selected = b.id === selectedBuildingId;
      const poly = L.polygon(buildingLatLngs(b), {
        ...(selected ? STYLES.placedSelected : bad.has(b.id) ? STYLES.placedBad : STYLES.placed),
        renderer: svgRef.current,
      }).addTo(group);
      if (buildingLabel) poly.bindTooltip(buildingLabel(placed.indexOf(original), b), { sticky: true });
      const handles = {};
      const redraw = () => {
        poly.setLatLngs(buildingLatLngs(b));
        const pts = handlePoints(b);
        Object.entries(handles).forEach(([k, m]) => m.setLatLng(pts[k]));
      };

      // Dragging the body moves it.
      // Selecting waits for the release: selecting redraws this layer, which
      // would cut a drag short.
      poly.on('mousedown', (e) => {
        L.DomEvent.stopPropagation(e);
        map.dragging.disable();
        const start = e.latlng;
        const startCenter = [...b.center];
        let moved = false;
        const onMove = (ev) => {
          moved = true;
          b = { ...b, center: [startCenter[0] + (ev.latlng.lng - start.lng), startCenter[1] + (ev.latlng.lat - start.lat)] };
          redraw();
        };
        // Released anywhere, even outside the map.
        const onUp = () => {
          map.off('mousemove', onMove);
          L.DomEvent.off(document, 'mouseup', onUp);
          map.dragging.enable();
          if (moved) cb.current.onBuildingChange(b.id, { center: b.center });
          cb.current.onSelectBuilding(b.id);
        };
        map.on('mousemove', onMove);
        L.DomEvent.on(document, 'mouseup', onUp);
      });
      poly.on('click', (e) => L.DomEvent.stopPropagation(e));

      if (selected) {
        const pts = handlePoints(b);
        for (const kind of ['move', 'length', 'depth', 'rotate']) {
          const m = L.marker(pts[kind], { icon: handleIcon(kind), draggable: true, pmIgnore: true, zIndexOffset: 1000 }).addTo(group);
          handles[kind] = m;
          m.on('drag', (ev) => {
            const { lat, lng } = ev.target.getLatLng();
            if (kind === 'move') {
              b = { ...b, center: [lng, lat] };
            } else {
              const [x, y] = makeProjection([b.center]).toFeet([lng, lat]);
              const a = (b.angle * Math.PI) / 180;
              const along = x * Math.cos(a) + y * Math.sin(a);
              const across = -x * Math.sin(a) + y * Math.cos(a);
              if (kind === 'length') b = { ...b, length: Math.min(MAX_SIDE, Math.max(20, Math.round(2 * along))) };
              if (kind === 'depth') b = { ...b, depth: Math.min(MAX_SIDE, Math.max(10, Math.round(2 * across))) };
              if (kind === 'rotate') b = { ...b, angle: Math.round(((Math.atan2(y, x) * 180) / Math.PI) * 10) / 10 };
            }
            redraw();
          });
          m.on('dragend', () => {
            const { center, length, depth, angle } = b;
            cb.current.onBuildingChange(b.id, { center, length, depth, angle });
          });
        }
      }
    }
  }, [placed, selectedBuildingId, badBuildingIds, buildingLabel]);

  return <div ref={elRef} className="siteplan-map" />;
}

export default SitePlanMap;
