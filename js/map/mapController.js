import { normalizeAssetMeta } from '../ui/exporter.js';
import { fetchFullFeatureGeoJSON } from '../services/arcgisClient.js';

export class MapController {
  constructor(containerId, { onSiteChanged }) {
    this.containerId = containerId;
    this.onSiteChanged = onSiteChanged;
    this.isDrawing = false;
    this.drawCoords = [];
    this.isLoaded = false;
    this.pendingSite = null;
    this.assetLookup = new Map();
    this.popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true });

    this.map = new maplibregl.Map({
      container: containerId,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          },
        },
        layers: [{ id: 'osm-base', type: 'raster', source: 'osm' }],
      },
      center: [-1.45, 52.35],
      zoom: 6,
    });

    this.map.addControl(new maplibregl.NavigationControl(), 'top-right');
    this.map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    this.map.on('load', () => {
      this.isLoaded = true;
      this._initSourcesAndLayers();
      this._bindMapEvents();

      if (this.pendingSite) {
        const { feature, options } = this.pendingSite;
        this.pendingSite = null;
        this.setSite(feature, options);
      }
    });
  }

  _initSourcesAndLayers() {
    const empty = { type: 'FeatureCollection', features: [] };

    this.map.addSource('buffer-src', { type: 'geojson', data: empty });
    this.map.addSource('assets-src', { type: 'geojson', data: empty });
    this.map.addSource('selected-asset-src', { type: 'geojson', data: empty });
    this.map.addSource('site-src', { type: 'geojson', data: empty });
    this.map.addSource('draw-src', { type: 'geojson', data: empty });

    // Search buffer ring
    this.map.addLayer({
      id: 'buffer-fill',
      type: 'fill',
      source: 'buffer-src',
      paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.1 },
    });
    this.map.addLayer({
      id: 'buffer-line',
      type: 'line',
      source: 'buffer-src',
      paint: { 'line-color': '#2563eb', 'line-width': 2, 'line-dasharray': [3, 2] },
    });

    // Heritage asset polygons & points
    this.map.addLayer({
      id: 'assets-fill',
      type: 'fill',
      source: 'assets-src',
      filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
      paint: { 'fill-color': ['get', '_color'], 'fill-opacity': 0.25 },
    });
    this.map.addLayer({
      id: 'assets-outline',
      type: 'line',
      source: 'assets-src',
      filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
      paint: { 'line-color': ['get', '_color'], 'line-width': 1.5 },
    });
    this.map.addLayer({
      id: 'assets-points',
      type: 'circle',
      source: 'assets-src',
      filter: ['in', ['geometry-type'], ['literal', ['Point', 'MultiPoint']]],
      paint: {
        'circle-radius': 6,
        'circle-color': ['get', '_color'],
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#ffffff',
      },
    });

    // Highlighted / Selected Heritage Asset (on card or map click)
    this.map.addLayer({
      id: 'selected-asset-fill',
      type: 'fill',
      source: 'selected-asset-src',
      filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
      paint: { 'fill-color': '#facc15', 'fill-opacity': 0.35 },
    });
    this.map.addLayer({
      id: 'selected-asset-casing',
      type: 'line',
      source: 'selected-asset-src',
      filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
      paint: { 'line-color': '#0f172a', 'line-width': 5 },
    });
    this.map.addLayer({
      id: 'selected-asset-outline',
      type: 'line',
      source: 'selected-asset-src',
      filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
      paint: { 'line-color': '#facc15', 'line-width': 2.5 },
    });
    this.map.addLayer({
      id: 'selected-asset-point',
      type: 'circle',
      source: 'selected-asset-src',
      filter: ['in', ['geometry-type'], ['literal', ['Point', 'MultiPoint']]],
      paint: {
        'circle-radius': 10,
        'circle-color': '#facc15',
        'circle-stroke-width': 2.5,
        'circle-stroke-color': '#0f172a',
      },
    });

    // Red-line site boundary / pin
    this.map.addLayer({
      id: 'site-fill',
      type: 'fill',
      source: 'site-src',
      filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
      paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.22 },
    });
    this.map.addLayer({
      id: 'site-line',
      type: 'line',
      source: 'site-src',
      filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
      paint: { 'line-color': '#dc2626', 'line-width': 2.5 },
    });
    this.map.addLayer({
      id: 'site-point',
      type: 'circle',
      source: 'site-src',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 8,
        'circle-color': '#dc2626',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    });

    // Active polygon sketch preview
    this.map.addLayer({
      id: 'draw-line',
      type: 'line',
      source: 'draw-src',
      paint: { 'line-color': '#dc2626', 'line-width': 2, 'line-dasharray': [2, 2] },
    });
  }

  _bindMapEvents() {
    this.map.on('click', async (e) => {
      if (this.isDrawing) {
        this.drawCoords.push([e.lngLat.lng, e.lngLat.lat]);
        this._updateDrawPreview();
        return;
      }

      const hit = this.map.queryRenderedFeatures(e.point, {
        layers: ['assets-fill', 'assets-points'],
      });
      if (hit.length > 0) {
        const uid = hit[0].properties?._uid;
        const cachedFeature = (uid && this.assetLookup.get(uid)) || hit[0];
        this._highlightAsset(cachedFeature);
        this._showAssetPopup(cachedFeature, e.lngLat);

        const fullFeature = await fetchFullFeatureGeoJSON(cachedFeature);
        if (uid) this.assetLookup.set(uid, fullFeature);
        this._highlightAsset(fullFeature);
        return;
      }

      const pointFeature = turf.point([e.lngLat.lng, e.lngLat.lat]);
      this.setSite(pointFeature);
    });

    this.map.on('dblclick', (e) => {
      if (!this.isDrawing) return;
      e.preventDefault();
      this.finishDrawing();
    });

    ['assets-fill', 'assets-points'].forEach((layerId) => {
      this.map.on('mouseenter', layerId, () => {
        if (!this.isDrawing) this.map.getCanvas().style.cursor = 'pointer';
      });
      this.map.on('mouseleave', layerId, () => {
        if (!this.isDrawing) this.map.getCanvas().style.cursor = '';
      });
    });
  }

  startDrawing() {
    this.isDrawing = true;
    this.drawCoords = [];
    this.map.doubleClickZoom.disable();
    document.getElementById(this.containerId)?.classList.add('drawing-mode');
    document.getElementById('draw-hint')?.classList.remove('hidden');
  }

  finishDrawing() {
    this.isDrawing = false;
    this.map.doubleClickZoom.enable();
    document.getElementById(this.containerId)?.classList.remove('drawing-mode');
    document.getElementById('draw-hint')?.classList.add('hidden');
    this.map.getSource('draw-src')?.setData({ type: 'FeatureCollection', features: [] });

    if (this.drawCoords.length >= 3) {
      const closed = [...this.drawCoords, this.drawCoords[0]];
      const poly = turf.polygon([closed]);
      this.setSite(poly);
    }
    this.drawCoords = [];
  }

  _updateDrawPreview() {
    if (this.drawCoords.length < 2) return;
    const line = turf.lineString(this.drawCoords);
    this.map.getSource('draw-src')?.setData({ type: 'FeatureCollection', features: [line] });
  }

  setSite(feature, options = {}) {
    if (!this.isLoaded) {
      this.pendingSite = { feature, options };
      return;
    }

    this.map.getSource('selected-asset-src')?.setData({
      type: 'FeatureCollection',
      features: [],
    });

    const { fly = false, zoom = 15 } = options;
    this.map.getSource('site-src')?.setData({
      type: 'FeatureCollection',
      features: [feature],
    });

    if (fly) {
      const [lng, lat] = turf.centroid(feature).geometry.coordinates;
      this.map.flyTo({ center: [lng, lat], zoom });
    }

    this.onSiteChanged?.(feature);
  }

  renderResults(bufferedFeature, assets) {
    if (!this.isLoaded) return;

    this.assetLookup.clear();
    const indexedAssets = (assets || []).map((feat, i) => {
      const uid = `${feat.properties._layerId}-${feat.properties.OBJECTID ?? i}`;
      feat.properties._uid = uid;
      this.assetLookup.set(uid, feat);
      return feat;
    });

    this.map.getSource('selected-asset-src')?.setData({
      type: 'FeatureCollection',
      features: [],
    });
    this.map.getSource('buffer-src')?.setData({
      type: 'FeatureCollection',
      features: bufferedFeature ? [bufferedFeature] : [],
    });
    this.map.getSource('assets-src')?.setData({
      type: 'FeatureCollection',
      features: indexedAssets,
    });

    if (bufferedFeature) {
      const bbox = turf.bbox(bufferedFeature);
      this.map.fitBounds(bbox, { padding: 40, maxZoom: 16 });
    }
  }

  _highlightAsset(feature) {
    this.map.getSource('selected-asset-src')?.setData({
      type: 'FeatureCollection',
      features: feature ? [feature] : [],
    });
  }

  async focusAsset(feature) {
    if (!this.isLoaded || !feature) return;

    // Immediately show cached geometry and zoom to it
    this._highlightAsset(feature);

    const [lng, lat] = turf.centroid(feature).geometry.coordinates;
    if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
      const bbox = turf.bbox(feature);
      this.map.fitBounds(bbox, { padding: 80, maxZoom: 18 });
    } else {
      this.map.flyTo({ center: [lng, lat], zoom: 17 });
    }

    this._showAssetPopup(feature, { lng, lat });

    // Fetch full-resolution GeoJSON feature directly from Historic England server
    const fullFeature = await fetchFullFeatureGeoJSON(feature);
    const uid = feature.properties?._uid;
    if (uid) this.assetLookup.set(uid, fullFeature);
    this._highlightAsset(fullFeature);
  }

  _showAssetPopup(feature, lngLat) {
    const meta = normalizeAssetMeta(feature);
    const dist = meta.intersects ? '0 m (Intersects)' : `${meta.distanceMeters} m`;
    const linkLabel = meta.isResearchReport ? 'Open Research Report' : 'Open NHLE Record';
    const linkHtml = meta.hyperlink
      ? `<div class="pt-1">
           <a href="${meta.hyperlink}" target="_blank" rel="noopener noreferrer" class="text-amber-700 underline font-medium">${linkLabel} &rarr;</a>
         </div>`
      : '';

    this.popup
      .setLngLat(lngLat)
      .setHTML(`
        <div class="text-xs space-y-1">
          <div class="font-semibold text-slate-900 leading-snug">${meta.name}</div>
          <div class="text-slate-600">${meta.category}${meta.listEntry !== 'N/A' ? ` · ${meta.listEntry}` : ''}</div>
          ${meta.subtitle ? `<div class="text-[11px] text-slate-500">${meta.subtitle}</div>` : ''}
          <div class="text-slate-700">Distance: <strong>${dist}</strong></div>
          ${linkHtml}
        </div>
      `)
      .addTo(this.map);
  }
}