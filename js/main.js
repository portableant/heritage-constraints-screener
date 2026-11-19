// js/main.js
import { queryHeritageLayers } from './services/arcgisClient.js';
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