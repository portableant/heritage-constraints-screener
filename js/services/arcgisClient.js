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

function esriFeatureToGeoJSON(esriFeat) {
  const g = esriFeat.geometry;
  if (!g) return null;

  let geometry = null;
  if (typeof g.x === 'number' && typeof g.y === 'number') {
    geometry = { type: 'Point', coordinates: [g.x, g.y] };
  } else if (Array.isArray(g.points) && g.points.length > 0) {
    geometry =
      g.points.length === 1
        ? { type: 'Point', coordinates: g.points[0] }
        : { type: 'MultiPoint', coordinates: g.points };
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

  const envelope = JSON.stringify({
    xmin: minX,
    ymin: minY,
    xmax: maxX,
    ymax: maxY,
    spatialReference: { wkid: 4326 },
  });

  const requests = HERITAGE_LAYERS.map(async (layer) => {
    const queryFormat = layer.format || 'geojson';
    const params = new URLSearchParams({
      where: '1=1',
      geometry: envelope,
      geometryType: 'esriGeometryEnvelope',
      spatialRel: 'esriSpatialRelIntersects',
      inSR: '4326',
      outSR: '4326',
      outFields: '*',
      f: queryFormat,
    });

    const response = await fetchWithRetry(`${layer.url}/query?${params}`);
    const data = await response.json();

    if (data.error) {
      throw new Error(`${layer.category}: ${data.error.message || 'ArcGIS error'}`);
    }

    const features =
      queryFormat === 'json'
        ? (data.features || []).map(esriFeatureToGeoJSON).filter(Boolean)
        : data.features || [];

    return features.map((f) => {
      const rawDedupeVal = layer.dedupeKey
        ? f.properties?.[layer.dedupeKey] ?? f.properties?.[layer.dedupeKey.toUpperCase()]
        : null;
      const dedupeKey =
        rawDedupeVal !== null && rawDedupeVal !== undefined && String(rawDedupeVal).trim() !== ''
          ? String(rawDedupeVal).trim()
          : null;

      return {
        ...f,
        properties: {
          ...f.properties,
          _layerId: layer.id,
          _layerUrl: layer.url,
          _layerFormat: queryFormat,
          _category: layer.category,
          _color: layer.color,
          _dedupeKey: dedupeKey,
          _priority: layer.priority ?? 1,
        },
      };
    });
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

export async function fetchFullFeatureGeoJSON(feature) {
  const layerUrl = feature?.properties?._layerUrl;
  const objectId = feature?.properties?.OBJECTID;
  const queryFormat = feature?.properties?._layerFormat || 'geojson';
  if (!layerUrl || objectId == null) return feature;

  const params = new URLSearchParams({
    objectIds: String(objectId),
    outFields: '*',
    outSR: '4326',
    f: queryFormat,
  });

  try {
    const response = await fetchWithRetry(`${layerUrl}/query?${params}`);
    const data = await response.json();
    const raw = data?.features?.[0];
    if (!raw) return feature;

    const full = queryFormat === 'json' ? esriFeatureToGeoJSON(raw) : raw;
    if (!full) return feature;

    return {
      ...full,
      properties: {
        ...feature.properties,
        ...full.properties,
      },
    };
  } catch {
    return feature;
  }
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