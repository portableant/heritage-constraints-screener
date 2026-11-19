export function evaluateConstraints(siteFeature, candidateFeatures, maxRadiusMeters) {
  if (!siteFeature?.geometry) {
    return { assets: [], sensitivity: classifySensitivity([]) };
  }

  const enriched = (candidateFeatures || [])
    .filter((feature) => Boolean(feature?.geometry))
    .map((feature) => {
      const distanceMeters = computeEdgeDistance(siteFeature, feature);
      return {
        ...feature,
        properties: {
          ...feature.properties,
          _distanceMeters: Math.round(distanceMeters),
          _intersects: distanceMeters === 0,
        },
      };
    })
    .filter((f) => Number.isFinite(f.properties._distanceMeters) && f.properties._distanceMeters <= maxRadiusMeters)
    .sort((a, b) => a.properties._distanceMeters - b.properties._distanceMeters);

  return {
    assets: enriched,
    sensitivity: classifySensitivity(enriched),
  };
}

export function computeEdgeDistance(site, target) {
  if (!site?.geometry || !target?.geometry) return Infinity;

  try {
    if (turf.booleanIntersects(site, target)) return 0;
  } catch {
    // Fall through to coordinate/line distance if complex topology check fails
  }

  const siteBoundary =
    site.geometry.type === 'Point' || site.geometry.type === 'MultiPoint'
      ? turf.polygonToLine(turf.buffer(site, 0.001, { units: 'kilometers' }))
      : turf.polygonToLine(site);

  // If target is Point or MultiPoint, measure directly to site boundary
  if (target.geometry.type === 'Point' || target.geometry.type === 'MultiPoint') {
    let minMeters = Infinity;
    turf.coordEach(target, (coord) => {
      const d = minDistanceToLines(turf.point(coord), siteBoundary);
      if (d < minMeters) minMeters = d;
    });
    return minMeters;
  }

  // Target is Polygon or MultiPolygon: measure boundary vertices against site boundary
  const targetLines = turf.polygonToLine(target);
  let minMeters = Infinity;

  turf.coordEach(targetLines, (coord) => {
    const d = minDistanceToLines(turf.point(coord), siteBoundary);
    if (d < minMeters) minMeters = d;
  });

  // Also check site vertices against target boundary in case target has long straight edges
  turf.coordEach(siteBoundary, (coord) => {
    const d = minDistanceToLines(turf.point(coord), targetLines);
    if (d < minMeters) minMeters = d;
  });

  return minMeters;
}

/**
 * Safely computes point-to-line distance whether `lineOrCollection`
 * is a LineString/MultiLineString Feature or a FeatureCollection (from MultiPolygon).
 */
function minDistanceToLines(pt, lineOrCollection) {
  if (!lineOrCollection) return Infinity;

  if (lineOrCollection.type === 'FeatureCollection') {
    let min = Infinity;
    for (const feat of lineOrCollection.features || []) {
      if (!feat?.geometry) continue;
      const d = turf.pointToLineDistance(pt, feat, { units: 'meters' });
      if (d < min) min = d;
    }
    return min;
  }

  if (!lineOrCollection.geometry) return Infinity;
  return turf.pointToLineDistance(pt, lineOrCollection, { units: 'meters' });
}

function classifySensitivity(assets) {
  const intersecting = assets.filter((a) => a.properties._intersects);
  const within100m = assets.filter((a) => a.properties._distanceMeters <= 100);

  if (intersecting.length > 0) {
    return {
      level: 'High (Direct Intersection)',
      badgeClass: 'bg-red-100 text-red-800 border-red-200',
      summary: `${intersecting.length} designated or recorded heritage constraint(s) directly intersect the red-line boundary.`,
    };
  }
  if (within100m.length > 0) {
    return {
      level: 'Moderate–High (Immediate Setting)',
      badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
      summary: `${within100m.length} asset(s) lie within 100 m; setting and intervisibility assessment likely required under NPPF para. 200.`,
    };
  }
  return {
    level: 'Low–Moderate (Wider Buffer)',
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    summary: 'No direct intersections or assets within 100 m; check local HER for non-designated heritage assets.',
  };
}