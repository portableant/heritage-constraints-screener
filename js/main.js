import { SAMPLE_SITES } from './config/services.js';
import { queryHeritageLayers } from './services/arcgisClient.js';
import { geocodeQuery } from './services/geocoder.js';
import { evaluateConstraints } from './analysis/spatialEngine.js';
import { MapController } from './map/mapController.js';
import { ResultsView } from './ui/resultsView.js';
import { downloadMarkdown, downloadGeoJSON } from './ui/exporter.js';

const state = {
  siteFeature: null,
  bufferMeters: 500,
  results: null,
};

const map = new MapController('map', {
  onSiteChanged: async (feature) => {
    state.siteFeature = feature;
    await runScreening();
  },
});

const resultsView = new ResultsView('results-container', {
  onSelectAsset: (feature) => map.focusAsset(feature),
  onExportMarkdown: () => downloadMarkdown(state),
  onExportGeoJSON: () => downloadGeoJSON(state),
});

async function runScreening() {
  if (!state.siteFeature) return;
  resultsView.setLoading(true);

  const { buffered, features, errors } = await queryHeritageLayers(
    state.siteFeature,
    state.bufferMeters
  );
  const analysis = evaluateConstraints(state.siteFeature, features, state.bufferMeters);

  state.results = { ...analysis, errors };
  map.renderResults(buffered, analysis.assets);
  resultsView.render(state);
}

// Toolbar event listeners
document.getElementById('search-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('search-input');
  try {
    const point = await geocodeQuery(input.value);
    map.setSite(point, { fly: true, zoom: 15 });
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('buffer-select')?.addEventListener('change', async (e) => {
  state.bufferMeters = Number(e.target.value);
  if (state.siteFeature) await runScreening();
});

document.getElementById('draw-btn')?.addEventListener('click', () => {
  map.startDrawing();
});

document.getElementById('sample-select')?.addEventListener('change', (e) => {
  const sample = SAMPLE_SITES[e.target.value];
  if (!sample) return;
  map.setSite(turf.point(sample.center), { fly: true, zoom: sample.zoom });
});

document.getElementById('geojson-input')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  const parsed = JSON.parse(text);
  const feature = parsed.type === 'FeatureCollection' ? parsed.features[0] : parsed;
  if (feature) map.setSite(feature, { fly: true, zoom: 15 });
});