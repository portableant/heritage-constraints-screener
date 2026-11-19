import { HERITAGE_LAYERS } from '../config/services.js';

export async function queryHeritageLayers(siteFeature, bufferMeters) {
  const buffered = turf.buffer(siteFeature, bufferMeters / 1000, { units: 'kilometers' });
  const [minX, minY, maxX, maxY] = turf.bbox(buffered);
  const envelope = `${minX},${minY},${maxX},${maxY}`;

  const requests = HERITAGE_LAYERS.map(async (layer) => {
    const params = new URLSearchParams({
      where: '1=1',
      geometry: envelope,
      geometryType: 'esriGeometryEnvelope',
      spatialRel: 'esriSpatialRelIntersects',
      inSR: '4326',
      outSR: '4326',
      outFields: '*',
      f: 'geojson',
    });

    const response = await fetch(`${layer.url}/query?${params}`);
    if (!response.ok) throw new Error(`${layer.category}: HTTP ${response.status}`);
    const geojson = await response.json();

    return (geojson.features || []).map((f) => ({
      ...f,
      properties: {
        ...f.properties,
        _layerId: layer.id,
        _category: layer.category,
        _color: layer.color,
        _dedupeKey: layer.dedupeKey ? f.properties[layer.dedupeKey] : null,
        _priority: layer.priority ?? 1,
      },
    }));
  });

  const settled = await Promise.allSettled(requests);
  const rawFeatures = [];
  const errors = [];

  settled.forEach((res, idx) => {
    if (res.status === 'fulfilled') rawFeatures.push(...res.value);
    else errors.push({ layer: HERITAGE_LAYERS[idx].category, message: res.reason.message });
  });

  return {
    buffered,
    features: deduplicateFeatures(rawFeatures),
    errors,
  };
}

function deduplicateFeatures(features) {
  const seen = new Map();
  const output = [];

  for (const feat of features) {
    const key = feat.properties._dedupeKey;
    if (!key) {
      output.push(feat);
      continue;
    }
    const existing = seen.get(key);
    if (!existing || feat.properties._priority < existing.properties._priority) {
      seen.set(key, feat);
    }
  }

  return [...output, ...seen.values()];
}