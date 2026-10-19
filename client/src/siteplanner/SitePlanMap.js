import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';

// The Site Planner's map: satellite imagery, a site boundary you draw or
// reshape (Geoman), and the solver's layout drawn on top. Leaflet is
// driven directly rather than through a React wrapper; React only hands
// it the boundary, the layout and where to look.

const SATELLITE = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
};
const STREETS = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};

const US_VIEW = { lat: 39.5, lng: -98.35, zoom: 4 };

const STYLES = {
  boundary: { color: '#ff9f1c', weight: 3, fillOpacity: 0.05 },
  setback: { color: '#ffffff', weight: 1.5, dashArray: '6 6', fill: false, interactive: false, pmIgnore: true },
  building: { color: '#4c3ce0', weight: 1.5, fillColor: '#7b6cf6', fillOpacity: 0.75, pmIgnore: true },
  parking: { color: '#e5e7eb', weight: 1, fillColor: '#374151', fillOpacity: 0.55, pmIgnore: true, interactive: false },
  stall: { color: '#f9fafb', weight: 0.75, opacity: 0.9, pmIgnore: true, interactive: false },
  lot: { color: '#16a34a', weight: 1, fillColor: '#4ade80', fillOpacity: 0.45, pmIgnore: true },
  street: { color: '#9ca3af', weight: 1, fillColor: '#6b7280', fillOpacity: 0.6, pmIgnore: true, interactive: false },
  truck: { color: '#d1d5db', weight: 1, fillColor: '#9ca3af', fillOpacity: 0.45, dashArray: '4 4', pmIgnore: true, interactive: false },
};

function boundaryToLatLngs(boundary) {
  const ring = boundary.coordinates[0];
  return ring.slice(0, -1).map(([lng, lat]) => [lat, lng]);
}

function SitePlanMap({ boundary, initialView, layout, flyTo, onBoundaryChange, buildingLabel }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const boundaryLayerRef = useRef(null);
  const layoutGroupRef = useRef(null);
  const lastEmittedRef = useRef(null);
  const onChangeRef = useRef(onBoundaryChange);
  onChangeRef.current = onBoundaryChange;

  // Hooks the drawn boundary up so reshaping or dragging it reports back.
  const adoptBoundary = (layer) => {
    const map = mapRef.current;
    if (boundaryLayerRef.current && boundaryLayerRef.current !== layer) map.removeLayer(boundaryLayerRef.current);
    boundaryLayerRef.current = layer;
    layer.setStyle(STYLES.boundary);
    const emit = () => {
      const geometry = layer.toGeoJSON().geometry;
      lastEmittedRef.current = JSON.stringify(geometry);
      onChangeRef.current(geometry);
    };
    layer.on('pm:edit', emit);
    layer.on('pm:dragend', emit);
    return emit;
  };

  useEffect(() => {
    const map = L.map(elRef.current, { preferCanvas: true, zoomControl: true, maxZoom: 21 });
    mapRef.current = map;
    const satellite = L.tileLayer(SATELLITE.url, { attribution: SATELLITE.attribution, maxNativeZoom: 19, maxZoom: 21 });
    const streets = L.tileLayer(STREETS.url, { attribution: STREETS.attribution, maxNativeZoom: 19, maxZoom: 21 });
    satellite.addTo(map);
    L.control.layers({ Satellite: satellite, Streets: streets }, null, { position: 'topright' }).addTo(map);
    L.control.scale({ imperial: true, metric: false }).addTo(map);
    layoutGroupRef.current = L.layerGroup().addTo(map);

    map.pm.addControls({
      position: 'topleft',
      drawMarker: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawCircle: false,
      drawText: false,
      cutPolygon: false,
      rotateMode: false,
      removalMode: false,
      drawRectangle: true,
      drawPolygon: true,
      editMode: true,
      dragMode: true,
    });
    map.pm.setGlobalOptions({ allowSelfIntersection: false, snappable: true });
    map.on('pm:create', (e) => {
      adoptBoundary(e.layer)();
    });

    if (boundary) {
      const layer = L.polygon(boundaryToLatLngs(boundary));
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
    // The map is built once; later boundary changes are synced below.
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
      const layer = L.polygon(boundaryToLatLngs(boundary));
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

  useEffect(() => {
    const group = layoutGroupRef.current;
    if (!group) return;
    group.clearLayers();
    if (!layout) return;
    if (layout.setback) L.polygon(layout.setback, STYLES.setback).addTo(group);
    layout.streets.forEach((r) => L.polygon(r, STYLES.street).addTo(group));
    layout.truckCourts.forEach((r) => L.polygon(r, STYLES.truck).addTo(group));
    layout.parking.forEach((p) => {
      L.polygon(p.outline, STYLES.parking).addTo(group);
      p.stalls.forEach((line) => L.polyline(line, STYLES.stall).addTo(group));
    });
    layout.lots.forEach((r) => L.polygon(r, STYLES.lot).addTo(group));
    layout.buildings.forEach((r, i) => {
      const poly = L.polygon(r, STYLES.building).addTo(group);
      if (buildingLabel) poly.bindTooltip(buildingLabel(i), { sticky: true });
    });
    // The boundary stays on top so it can still be grabbed and edited.
    if (boundaryLayerRef.current) boundaryLayerRef.current.bringToFront();
  }, [layout, buildingLabel]);

  return <div ref={elRef} className="siteplan-map" />;
}

export default SitePlanMap;
