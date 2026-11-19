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
    .filter(
      (f) =>
        Number.isFinite(f.properties._distanceMeters) &&
        f.properties._distanceMeters <= maxRadiusMeters
    )
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
    // Fall through to boundary distance if complex topology check fails
  }

  const siteBoundary =
    site.geometry.type === 'Point' || site.geometry.type === 'MultiPoint'
      ? turf.polygonToLine(turf.buffer(site, 0.001, { units: 'kilometers' }))
      : turf.polygonToLine(site);

  // Target is Point or MultiPoint
  if (target.geometry.type === 'Point' || target.geometry.type === 'MultiPoint') {
    let minMeters = Infinity;
    turf.coordEach(target, (coord) => {
      const d = minDistanceToLines(turf.point(coord), siteBoundary);
      if (d < minMeters) minMeters = d;
    });
    return minMeters;
  }

  // Target is Polygon or MultiPolygon
  const targetLines = turf.polygonToLine(target);
  let minMeters = Infinity;

  turf.coordEach(targetLines, (coord) => {
    const d = minDistanceToLines(turf.point(coord), siteBoundary);
    if (d < minMeters) minMeters = d;
  });

  turf.coordEach(siteBoundary, (coord) => {
    const d = minDistanceToLines(turf.point(coord), targetLines);
    if (d < minMeters) minMeters = d;
  });

  return minMeters;
}

/**
 * Flattens any FeatureCollection or MultiLineString into individual LineStrings
 * before calling turf.pointToLineDistance (required by Turf v7).
 */
function minDistanceToLines(pt, lineOrCollection) {
  if (!lineOrCollection) return Infinity;

  let min = Infinity;
  turf.flattenEach(lineOrCollection, (flatFeature) => {
    if (flatFeature?.geometry?.type !== 'LineString') return;
    const d = turf.pointToLineDistance(pt, flatFeature, { units: 'meters' });
    if (d < min) min = d;
  });

  return min;
}

function classifySensitivity(assets) {
  const intersecting = assets.filter((a) => a.properties._intersects);
  const within100m = assets.filter((a) => a.properties._distanceMeters <= 100);
  const atRisk = assets.filter((a) => a.properties._category === 'Heritage at Risk');

  if (intersecting.length > 0) {
    return {
      level: 'High (Direct Intersection)',
      badgeClass: 'bg-red-100 text-red-800 border-red-200',
      summary: `${intersecting.length} designated or recorded heritage constraint(s) directly intersect the red-line boundary${
        atRisk.length ? ` (including ${atRisk.length} on the Heritage at Risk Register)` : ''
      }.`,
    };
  }
  if (within100m.length > 0 || atRisk.length > 0) {
    return {
      level: 'Moderate–High (Immediate Setting / At Risk)',
      badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
      summary: `${within100m.length} asset(s) lie within 100 m and ${atRisk.length} asset(s) in the buffer appear on the Heritage at Risk Register; setting and conservation enhancement assessment likely required under NPPF Chapter 16.`,
    };
  }
  return {
    level: 'Low–Moderate (Wider Buffer)',
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    summary:
      'No direct intersections, Heritage at Risk entries, or assets within 100 m; check local HER for non-designated heritage assets.',
  };
}