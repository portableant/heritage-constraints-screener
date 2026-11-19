export function evaluateConstraints(siteFeature, candidateFeatures, maxRadiusMeters) {
  const enriched = candidateFeatures
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
    .filter((f) => f.properties._distanceMeters <= maxRadiusMeters)
    .sort((a, b) => a.properties._distanceMeters - b.properties._distanceMeters);

  return {
    assets: enriched,
    sensitivity: classifySensitivity(enriched),
  };
}

export function computeEdgeDistance(site, target) {
  if (turf.booleanIntersects(site, target)) return 0;

  const siteLine = turf.polygonToLine(site.geometry.type === 'Point'
    ? turf.buffer(site, 0.001, { units: 'kilometers' })
    : site);

  const targetGeom = target.geometry.type === 'Point'
    ? target
    : turf.polygonToLine(target);

  // Convert both to point/line representations for accurate boundary-to-boundary distance
  if (targetGeom.geometry.type === 'Point') {
    return turf.pointToLineDistance(targetGeom, siteLine, { units: 'meters' });
  }

  let minMeters = Infinity;
  turf.coordEach(targetGeom, (coord) => {
    const d = turf.pointToLineDistance(turf.point(coord), siteLine, { units: 'meters' });
    if (d < minMeters) minMeters = d;
  });
  return minMeters;
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