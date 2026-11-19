import { HERITAGE_LAYERS } from '../config/services.js';
import { normalizeAssetMeta } from '../ui/exporter.js';
import { fetchFullFeatureGeoJSON } from '../services/arcgisClient.js';

class MapLegendControl {
  constructor(onToggleCategories) {
    this.onToggleCategories = onToggleCategories;
    this.enabledCategories = new Set();
  }

  onAdd(map) {
    this._map = map;
    this._collapsed = false;

    this._container = document.createElement('div');
    this._container.className =
      'maplibregl-ctrl bg-white/95 backdrop-blur-xs border border-slate-200 rounded-lg shadow-md text-xs text-slate-800 p-2.5 max-w-[235px] select-none';

    const uniqueCategories = [];
    const seen = new Set();
    for (const layer of HERITAGE_LAYERS) {
      if (!seen.has(layer.category)) {
        seen.add(layer.category);
        uniqueCategories.push({ category: layer.category, color: layer.color });
      }
    }
    uniqueCategories.push({ category: 'ADS Grey Literature', color: '#4f46e5' });

    uniqueCategories.forEach((c) => this.enabledCategories.add(c.category));

    const categoryRows = uniqueCategories
      .map(
        ({ category, color }) => `
          <label class="flex items-center gap-2 cursor-pointer hover:bg-slate-50 rounded px-1 py-0.5">
            <input type="checkbox" data-legend-cat="${category}" checked class="rounded border-slate-300 text-slate-900 focus:ring-0" />
            <span class="inline-block w-2.5 h-2.5 rounded-full shrink-0 border border-white shadow-2xs" style="background-color: ${color};"></span>
            <span class="truncate text-[11px] text-slate-700">${category}</span>
          </label>
        `
      )
      .join('');

    this._container.innerHTML = `
      <div class="flex items-center justify-between gap-3">
        <span class="font-semibold text-[11px] uppercase tracking-wider text-slate-600">Map Key &amp; Layers</span>
        <button type="button" id="legend-toggle-btn" class="text-[11px] text-slate-500 hover:text-slate-900 font-medium">
          Hide
        </button>
      </div>
      <div id="legend-body" class="mt-2 space-y-2">
        <div class="space-y-0.5">
          ${categoryRows}
        </div>
        <div class="pt-1.5 border-t border-slate-200 space-y-1">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Listed Building Grades</div>
          <div class="flex items-center gap-2">
            <span class="inline-block w-2.5 h-2.5 rounded-full shrink-0" style="background-color: #9333ea;"></span>
            <span class="text-[11px] text-slate-700">Grade I</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="inline-block w-2.5 h-2.5 rounded-full shrink-0" style="background-color: #ea580c;"></span>
            <span class="text-[11px] text-slate-700">Grade II*</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="inline-block w-2.5 h-2.5 rounded-full shrink-0" style="background-color: #d97706;"></span>
            <span class="text-[11px] text-slate-700">Grade II</span>
          </div>
        </div>
        <div class="pt-1.5 border-t border-slate-200 space-y-1">
          <div class="flex items-center gap-2">
            <span class="inline-block w-3 h-2 border-2 border-red-600 bg-red-500/20 shrink-0"></span>
            <span class="text-[11px] text-slate-700">Site Boundary</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="inline-block w-3 h-2 border border-dashed border-blue-600 bg-blue-600/10 shrink-0"></span>
            <span class="text-[11px] text-slate-700">Search Buffer</span>
          </div>
        </div>
      </div>
    `;

    const toggleBtn = this._container.querySelector('#legend-toggle-btn');
    const body = this._container.querySelector('#legend-body');
    toggleBtn?.addEventListener('click', () => {
      this._collapsed = !this._collapsed;
      body.classList.toggle('hidden', this._collapsed);
      toggleBtn.textContent = this._collapsed ? 'Show' : 'Hide';
    });

    this._container.querySelectorAll('input[data-legend-cat]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const cat = cb.dataset.legendCat;
        if (cb.checked) {
          this.enabledCategories.add(cat);
        } else {
          this.enabledCategories.delete(cat);
        }
        this.onToggleCategories?.([...this.enabledCategories]);
      });
    });

    return this._container;
  }

  syncCheckboxes(activeCategory) {
    if (!this._container) return;
    this.enabledCategories.clear();
    this._container.querySelectorAll('input[data-legend-cat]').forEach((cb) => {
      const cat = cb.dataset.legendCat;
      const shouldCheck = activeCategory === 'ALL' || cat === activeCategory;
      cb.checked = shouldCheck;
      if (shouldCheck) this.enabledCategories.add(cat);
    });
  }

  onRemove() {
    this._container?.parentNode?.removeChild(this._container);
    this._map = undefined;
  }
}

export class MapController {
  constructor(containerId, { onSiteChanged, onAssetClicked }) {
    this.containerId = containerId;
    this.onSiteChanged = onSiteChanged;
    this.onAssetClicked = onAssetClicked;
    this.isDrawing = false;
    this.drawCoords = [];
    this.isLoaded = false;
    this.pendingSite = null;
    this.assetLookup = new Map();
    this.popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true });

    this.map = new maplibregl.Map({
      container: containerId,
      preserveDrawingBuffer: true,
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

    this.legendControl = new MapLegendControl((enabledCategories) => {
      this.setVisibleCategories(enabledCategories);
    });

    this.map.addControl(new maplibregl.NavigationControl(), 'top-right');
    this.map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    this.map.addControl(this.legendControl, 'bottom-right');

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
    this.map.addSource('asset-markers-src', { type: 'geojson', data: empty });
    this.map.addSource('selected-asset-src', { type: 'geojson', data: empty });
    this.map.addSource('site-src', { type: 'geojson', data: empty });
    this.map.addSource('draw-src', { type: 'geojson', data: empty });

    // 1. Search buffer ring
    this.map.addLayer({
      id: 'buffer-fill',
      type: 'fill',
      source: 'buffer-src',
      paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.08 },
    });
    this.map.addLayer({
      id: 'buffer-line',
      type: 'line',
      source: 'buffer-src',
      paint: { 'line-color': '#2563eb', 'line-width': 2, 'line-dasharray': [3, 2] },
    });

    // 2. All available heritage asset polygons within the radius
    this.map.addLayer({
      id: 'assets-fill',
      type: 'fill',
      source: 'assets-src',
      filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
      paint: {
        'fill-color': [
          'case',
          ['==', ['get', '_category'], 'Listed Buildings'],
          [
            'match',
            ['coalesce', ['get', 'Grade'], ['get', 'GRADE'], ''],
            'I', '#9333ea',
            'II*', '#ea580c',
            'II', '#d97706',
            ['get', '_color'],
          ],
          ['get', '_color'],
        ],
        'fill-opacity': [
          'case',
          ['==', ['get', '_category'], 'Listed Buildings'],
          0.35,
          0.16,
        ],
      },
    });
    this.map.addLayer({
      id: 'assets-outline',
      type: 'line',
      source: 'assets-src',
      filter: ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]],
      paint: {
        'line-color': [
          'case',
          ['==', ['get', '_category'], 'Listed Buildings'],
          [
            'match',
            ['coalesce', ['get', 'Grade'], ['get', 'GRADE'], ''],
            'I', '#9333ea',
            'II*', '#ea580c',
            'II', '#d97706',
            ['get', '_color'],
          ],
          ['get', '_color'],
        ],
        'line-width': [
          'case',
          ['==', ['get', '_category'], 'Listed Buildings'],
          2,
          1.5,
        ],
      },
    });

    // 3. Highlighted / Selected Heritage Asset (on card or map click)
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

    // 4. Point marker for EVERY feature in the radius (rendered on top of polygons)
    this.map.addLayer({
      id: 'asset-markers',
      type: 'circle',
      source: 'asset-markers-src',
      paint: {
        'circle-radius': [
          'case',
          ['==', ['get', '_category'], 'Listed Buildings'],
          6.5,
          5.5,
        ],
        'circle-color': [
          'match',
          ['coalesce', ['get', 'Grade'], ['get', 'GRADE'], ''],
          'I', '#9333ea',
          'II*', '#ea580c',
          'II', '#d97706',
          ['get', '_color'],
        ],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    });

    // Selected marker ring highlight
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

    // 5. Red-line site boundary / pin
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

    // 6. Active polygon sketch preview
    this.map.addLayer({
      id: 'draw-line',
      type: 'line',
      source: 'draw-src',
      paint: { 'line-color': '#dc2626', 'line-width': 2, 'line-dasharray': [2, 2] },
    });
  }

  /**
   * Filters map polygons and markers to match active category pills or legend checkboxes.
   */
  setVisibleCategories(categories) {
    if (!this.isLoaded) return;

    const catFilter = ['in', ['get', '_category'], ['literal', categories]];
    const polyGeomFilter = ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]];

    this.map.setFilter('assets-fill', ['all', polyGeomFilter, catFilter]);
    this.map.setFilter('assets-outline', ['all', polyGeomFilter, catFilter]);
    this.map.setFilter('asset-markers', catFilter);
  }

  syncPillFilter(activeCategory) {
    this.legendControl.syncCheckboxes(activeCategory);
    if (activeCategory === 'ALL') {
      this.setVisibleCategories([...this.legendControl.enabledCategories]);
    } else {
      this.setVisibleCategories([activeCategory]);
    }
  }

  /**
   * Captures a PNG data URL of the live MapLibre canvas for the PDF report.
   */
  captureSnapshot() {
    if (!this.isLoaded) return null;
    try {
      return this.map.getCanvas().toDataURL('image/png');
    } catch {
      return null;
    }
  }

  _bindMapEvents() {
    this.map.on('click', async (e) => {
      if (this.isDrawing) {
        this.drawCoords.push([e.lngLat.lng, e.lngLat.lat]);
        this._updateDrawPreview();
        return;
      }

      const hit = this.map.queryRenderedFeatures(e.point, {
        layers: ['asset-markers', 'assets-fill'],
      });
      if (hit.length > 0) {
        const uid = hit[0].properties?._uid;
        const cachedFeature = (uid && this.assetLookup.get(uid)) || hit[0];
        this._highlightAsset(cachedFeature);
        this._showAssetPopup(cachedFeature, e.lngLat);
        this.onAssetClicked?.(cachedFeature);

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

    ['asset-markers', 'assets-fill'].forEach((layerId) => {
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

  _toMarkerPoint(feature) {
    if (!feature?.geometry) return null;

    if (feature.geometry.type === 'Point') {
      return {
        type: 'Feature',
        geometry: feature.geometry,
        properties: feature.properties,
      };
    }

    if (feature.geometry.type === 'MultiPoint') {
      const coords = feature.geometry.coordinates?.[0];
      if (!coords) return null;
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: coords },
        properties: feature.properties,
      };
    }

    try {
      const pt = turf.pointOnFeature(feature);
      return {
        type: 'Feature',
        geometry: pt.geometry,
        properties: feature.properties,
      };
    } catch {
      const pt = turf.centroid(feature);
      return {
        type: 'Feature',
        geometry: pt.geometry,
        properties: feature.properties,
      };
    }
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

    const markerFeatures = indexedAssets
      .map((feat) => this._toMarkerPoint(feat))
      .filter(Boolean);

    this.legendControl.syncCheckboxes('ALL');
    this.setVisibleCategories([...this.legendControl.enabledCategories]);

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
    this.map.getSource('asset-markers-src')?.setData({
      type: 'FeatureCollection',
      features: markerFeatures,
    });

    if (bufferedFeature) {
      const bbox = turf.bbox(bufferedFeature);
      this.map.fitBounds(bbox, { padding: 40, maxZoom: 16 });
    }
  }

  _highlightAsset(feature) {
    if (!feature) {
      this.map.getSource('selected-asset-src')?.setData({
        type: 'FeatureCollection',
        features: [],
      });
      return;
    }

    const highlightFeatures = [feature];
    if (
      feature.geometry?.type === 'Polygon' ||
      feature.geometry?.type === 'MultiPolygon'
    ) {
      const markerPt = this._toMarkerPoint(feature);
      if (markerPt) highlightFeatures.push(markerPt);
    }

    this.map.getSource('selected-asset-src')?.setData({
      type: 'FeatureCollection',
      features: highlightFeatures,
    });
  }

  async focusAsset(feature) {
    if (!this.isLoaded || !feature) return;

    this._highlightAsset(feature);

    const markerPt = this._toMarkerPoint(feature);
    const [lng, lat] = markerPt
      ? markerPt.geometry.coordinates
      : turf.centroid(feature).geometry.coordinates;

    if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
      const bbox = turf.bbox(feature);
      this.map.fitBounds(bbox, { padding: 80, maxZoom: 18 });
    } else {
      this.map.flyTo({ center: [lng, lat], zoom: 17 });
    }

    this._showAssetPopup(feature, { lng, lat });

    const fullFeature = await fetchFullFeatureGeoJSON(feature);
    const uid = feature.properties?._uid;
    if (uid) this.assetLookup.set(uid, fullFeature);
    this._highlightAsset(fullFeature);
  }

  _showAssetPopup(feature, lngLat) {
    const meta = normalizeAssetMeta(feature);
    const dist = meta.intersects ? '0 m (Intersects)' : `${meta.distanceMeters} m`;
    const hasPolygon =
      feature.geometry?.type === 'Polygon' ||
      feature.geometry?.type === 'MultiPolygon';
    const geomBadge = hasPolygon
      ? `<span class="inline-block px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px]">Polygon Boundary</span>`
      : `<span class="inline-block px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px]">Point Location</span>`;

    const linkLabel = meta.isResearchReport ? 'Open Research Report' : 'Open Record';
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
          <div class="flex items-center justify-between gap-2 text-slate-700">
            <span>Distance: <strong>${dist}</strong></span>
            ${geomBadge}
          </div>
          ${linkHtml}
        </div>
      `)
      .addTo(this.map);
  }
}