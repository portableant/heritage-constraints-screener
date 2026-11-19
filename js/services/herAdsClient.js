const HE_HER_BOUNDARIES_URL =
  'https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/ArcGIS/rest/services/HER_boundaries_ODH/FeatureServer/2';

/**
 * Queries the CORS-enabled DataCite REST API for Archaeological Data Service (ADS)
 * grey literature reports and archives (DOI prefix 10.5284) within the buffer envelope.
 */
async function queryADSRadius(minX, minY, maxX, maxY, placeHint = '') {
  const centerLng = (minX + maxX) / 2;
  const centerLat = (minY + maxY) / 2;

  const spatialQuery =
    `geoLocations.geoLocationPoint.pointLongitude:[${minX.toFixed(4)} TO ${maxX.toFixed(4)}] ` +
    `AND geoLocations.geoLocationPoint.pointLatitude:[${minY.toFixed(4)} TO ${maxY.toFixed(4)}]`;

  const params = new URLSearchParams({
    prefix: '10.5284',
    query: spatialQuery,
    'page[size]': '25',
    sort: '-created',
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`https://api.datacite.org/dois?${params}`, {
      headers: { Accept: 'application/vnd.api+json' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) return [];
    const payload = await response.json();
    let records = payload?.data || [];

    if (records.length === 0 && placeHint) {
      const cleanPlace = placeHint.replace(/["()[\]]/g, '').trim();
      if (cleanPlace) {
        const textParams = new URLSearchParams({
          prefix: '10.5284',
          query: `"${cleanPlace}"`,
          'page[size]': '15',
          sort: '-created',
        });
        const textRes = await fetch(`https://api.datacite.org/dois?${textParams}`, {
          headers: { Accept: 'application/vnd.api+json' },
        });
        if (textRes.ok) {
          const textPayload = await textRes.json();
          records = textPayload?.data || [];
        }
      }
    }

    return records
      .map((item, idx) => {
        const attr = item.attributes || {};
        const geoPt = attr.geoLocations?.[0]?.geoLocationPoint;
        const lon = Number(geoPt?.pointLongitude ?? centerLng);
        const lat = Number(geoPt?.pointLatitude ?? centerLat);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

        const title = attr.titles?.[0]?.title || 'ADS Grey Literature / Archive Record';
        const authors = (attr.creators || [])
          .map((c) => c.name)
          .filter(Boolean)
          .join('; ');
        const description = attr.descriptions?.[0]?.description || null;
        const subjects = (attr.subjects || [])
          .map((s) => s.subject)
          .filter(Boolean)
          .slice(0, 6)
          .join(', ');
        const doi = attr.doi || item.id;

        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [lon, lat] },
          properties: {
            OBJECTID: doi || `ads-${idx}`,
            Name: title,
            ListEntry: doi,
            Author_s_: authors || null,
            Year: attr.publicationYear || null,
            Simple_Report_type: attr.types?.resourceType || 'ADS Grey Literature / Archive',
            Brief_description: description,
            Keyword: subjects || null,
            Hyperlink: attr.url || (doi ? `https://doi.org/${doi}` : null),
            _layerId: 'ads-records',
            _layerUrl: null,
            _category: 'ADS Grey Literature',
            _color: '#4f46e5',
            _dedupeKey: doi ? `ads-${doi}` : null,
            _priority: 2,
          },
        };
      })
      .filter(Boolean);
  } catch {
    clearTimeout(timer);
    return [];
  }
}

/**
 * Queries Historic England's HER Boundaries FeatureServer (Layer 2) to identify
 * the exact local Historic Environment Record (HER) covering the site.
 */
async function queryLocalHERBoundary(siteFeature) {
  const [lng, lat] = turf.centroid(siteFeature).geometry.coordinates;

  const params = new URLSearchParams({
    where: '1=1',
    geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    spatialRel: 'esriSpatialRelIntersects',
    inSR: '4326',
    outSR: '4326',
    outFields: '*',
    returnGeometry: 'false',
    f: 'json',
  });

  try {
    const response = await fetch(`${HE_HER_BOUNDARIES_URL}/query?${params}`);
    if (!response.ok) return null;
    const data = await response.json();
    const attrs = data?.features?.[0]?.attributes;
    if (!attrs) return null;

    const herName =
      attrs.HER_NAME ||
      attrs.HER_Name ||
      attrs.NAME ||
      attrs.Name ||
      attrs.ORGANISATION ||
      attrs.Organisation ||
      Object.entries(attrs).find(
        ([k, v]) => /name|her|org/i.test(k) && typeof v === 'string' && v.trim()
      )?.[1] ||
      'Local Authority Historic Environment Record';

    const herUrl =
      attrs.URL ||
      attrs.WEBSITE ||
      attrs.Website ||
      attrs.Hyperlink ||
      Object.values(attrs).find((v) => typeof v === 'string' && /^https?:\/\//i.test(v)) ||
      null;

    const herEmail =
      attrs.EMAIL ||
      attrs.Email ||
      Object.values(attrs).find((v) => typeof v === 'string' && v.includes('@')) ||
      null;

    return {
      herName: String(herName).trim(),
      herUrl,
      herEmail,
      rawAttributes: attrs,
    };
  } catch {
    return null;
  }
}

/**
 * Generates direct deep-links to Heritage Gateway and ADS ArchSearch for the site's
 * coordinates so the exported brief includes actionable local HER lookup links.
 */
function buildExternalHERLinks(siteFeature, bufferMeters = 500) {
  const [lng, lat] = turf.centroid(siteFeature).geometry.coordinates;
  return {
    heritageGatewayUrl: `https://www.heritagegateway.org.uk/Gateway/Results_Application.aspx?lat=${lat.toFixed(5)}&lon=${lng.toFixed(5)}&radius=${bufferMeters}`,
    adsLibraryUrl: `https://archaeologydataservice.ac.uk/archsearch/browser.xhtml`,
  };
}

export {
  queryADSRadius,
  queryLocalHERBoundary,
  buildExternalHERLinks,
};