import { HERITAGE_LAYERS } from '../config/services.js';

async function fetchWithRetry(url, retries = 2, baseDelayMs = 400) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url);
    if (response.ok) return response;

    const retryable = [429, 502, 503, 504].includes(response.status);
    if (!retryable || attempt === retries) {
      throw new Error(`HTTP ${response.status}`);
    }

    await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt + Math.random() * 150));
  }
}

/**
 * Converts an Esri JSON feature (Point, Polyline, or Polygon rings)
 * into a standard GeoJSON Feature.
 */
function esriFeatureToGeoJSON(esriFeat) {
  const g = esriFeat.geometry;
  if (!g) return null;

  let geometry = null;
  if (typeof g.x === 'number' && typeof g.y === 'number') {
    geometry = { type: 'Point', coordinates: [g.x, g.y] };
  } else if (Array.isArray(g.rings) && g.rings.length > 0) {
    geometry = { type: 'Polygon', coordinates: g.rings };
  } else if (Array.isArray(g.paths) && g.paths.length > 0) {
    geometry =
      g.paths.length === 1
        ? { type: 'LineString', coordinates: g.paths[0] }
        : { type: 'MultiLineString', coordinates: g.paths };
  }

  if (!geometry) return null;

  return {
    type: 'Feature',
    geometry,
    properties: esriFeat.attributes || {},
  };
}

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
      f: 'json',
    });

    const response = await fetchWithRetry(`${layer.url}/query?${params}`);
    const data = await response.json();

    if (data.error) {
      throw new Error(`${layer.category}: ${data.error.message || 'ArcGIS error'}`);
    }

    return (data.features || [])
      .map(esriFeatureToGeoJSON)
      .filter(Boolean)
      .map((f) => ({
        ...f,
        properties: {
          ...f.properties,
          _layerId: layer.id,
          _category: layer.category,
          _color: layer.color,
          _dedupeKey: layer.dedupeKey ? f.properties?.[layer.dedupeKey] : null,
          _priority: layer.priority ?? 1,
        },
      }));
  });

  const settled = await Promise.allSettled(requests);
  const rawFeatures = [];
  const errors = [];

  settled.forEach((res, idx) => {
    const layer = HERITAGE_LAYERS[idx];
    if (res.status === 'fulfilled') {
      rawFeatures.push(...res.value);
    } else if (!layer.optional) {
      errors.push({ layer: layer.category, message: res.reason.message });
    }
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