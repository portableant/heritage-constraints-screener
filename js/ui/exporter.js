/**
 * Triggers a browser file download from string content.
 */
function triggerDownload(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Normalizes disparate Historic England ArcGIS attribute schemas into
 * consistent display fields for reports and exports.
 */
export function normalizeAssetMeta(feature) {
  const p = feature.properties || {};

  const name =
    p.Name ||
    p.NAME ||
    p.TITLE ||
    p.Title ||
    p.SITE_NAME ||
    p.MONUMENT_NAME ||
    'Unnamed Heritage Asset';

  const listEntry = p.ListEntry || p.LISTENTRY || p.UID || p.REPORT_NO || null;
  const grade = p.Grade || p.GRADE || null;
  const hyperlink =
    p.Hyperlink ||
    p.HYPERLINK ||
    p.URL ||
    (listEntry && /^\d+$/.test(String(listEntry))
      ? `https://historicengland.org.uk/listing/the-list/list-entry/${listEntry}`
      : null);

  return {
    name: String(name).trim(),
    category: p._category || 'Heritage Constraint',
    listEntry: listEntry ? String(listEntry) : 'N/A',
    grade: grade ? `Grade ${grade}` : null,
    distanceMeters: p._distanceMeters ?? null,
    intersects: Boolean(p._intersects),
    hyperlink,
  };
}

/**
 * Generates and downloads a structured Markdown Heritage Constraints Brief.
 */
export function downloadMarkdown(state) {
  if (!state?.siteFeature || !state?.results) return;

  const { siteFeature, bufferMeters, results } = state;
  const { assets, sensitivity, errors = [] } = results;
  const timestamp = new Date().toISOString().split('T')[0];

  const centroid = turf.centroid(siteFeature).geometry.coordinates;
  const siteAreaSqM =
    siteFeature.geometry.type === 'Point'
      ? null
      : Math.round(turf.area(siteFeature));

  const lines = [
    `# Automated Heritage Constraints Screening Brief`,
    ``,
    `- **Date:** ${timestamp}`,
    `- **Site Centroid (WGS84):** ${centroid[1].toFixed(6)}, ${centroid[0].toFixed(6)}`,
    siteAreaSqM !== null
      ? `- **Site Boundary Area:** ${siteAreaSqM.toLocaleString('en-GB')} m² (${(siteAreaSqM / 10000).toFixed(2)} ha)`
      : `- **Site Geometry:** Point location`,
    `- **Search Buffer Radius:** ${bufferMeters} m`,
    `- **Initial Sensitivity Rating:** **${sensitivity.level}**`,
    ``,
    `> ${sensitivity.summary}`,
    ``,
    `## Summary by Constraint Category`,
    ``,
    `| Category | Total Within ${bufferMeters} m | Intersecting Site | Nearest Distance |`,
    `| :--- | :---: | :---: | :---: |`,
  ];

  // Group counts by category
  const grouped = new Map();
  for (const asset of assets) {
    const meta = normalizeAssetMeta(asset);
    if (!grouped.has(meta.category)) {
      grouped.set(meta.category, []);
    }
    grouped.get(meta.category).push({ feature: asset, meta });
  }

  for (const [category, items] of grouped.entries()) {
    const intersectingCount = items.filter((i) => i.meta.intersects).length;
    const nearest = items[0]?.meta.intersects
      ? '0 m (Intersects)'
      : `${items[0]?.meta.distanceMeters} m`;
    lines.push(
      `| ${category} | ${items.length} | ${intersectingCount} | ${nearest} |`
    );
  }

  if (assets.length === 0) {
    lines.push(`| *None identified* | 0 | 0 | — |`);
  }

  lines.push(``, `## Detailed Schedule of Identified Assets`, ``);

  if (assets.length === 0) {
    lines.push(
      `No designated heritage assets or Historic England spatial research reports were returned within ${bufferMeters} m of the site boundary.`
    );
  } else {
    assets.forEach((asset, index) => {
      const m = normalizeAssetMeta(asset);
      const distLabel = m.intersects
        ? '**0 m (Directly Intersects Site)**'
        : `${m.distanceMeters} m`;
      const gradeTag = m.grade ? ` (${m.grade})` : '';
      const idTag = m.listEntry !== 'N/A' ? ` — ID: \`${m.listEntry}\`` : '';
      const linkPart = m.hyperlink ? ` — [View Record](${m.hyperlink})` : '';

      lines.push(
        `${index + 1}. **${m.name}**${gradeTag} — *${m.category}*${idTag}  \n   Distance: ${distLabel}${linkPart}`
      );
    });
  }

  if (errors.length > 0) {
    lines.push(``, `## Data Retrieval Warnings`, ``);
    for (const err of errors) {
      lines.push(`- **${err.layer}:** ${err.message}`);
    }
  }

  lines.push(
    ``,
    `---`,
    `## Planning & Data Caveats`,
    ``,
    `- **Data Currency:** Live spatial data queried from Historic England Open Data ArcGIS FeatureServices on ${timestamp}.`,
    `- **Non-Designated Heritage Assets:** This screening covers national designations and Historic England datasets. Consult the relevant local authority **Historic Environment Record (HER)** for non-designated archaeological monuments, findspots, and historic landscape characterization.`,
    `- **Setting & Significance:** Spatial proximity does not equate to harm. Assessment of setting impacts must follow *Historic Environment Good Practice Advice in Planning Note 3 (The Setting of Heritage Assets)* and NPPF Chapter 16.`
  );

  triggerDownload(
    lines.join('\n'),
    `heritage-constraints-brief-${timestamp}.md`,
    'text/markdown;charset=utf-8'
  );
}

/**
 * Generates and downloads a GIS-ready GeoJSON FeatureCollection containing
 * the site boundary, search buffer, and all screened heritage features.
 */
export function downloadGeoJSON(state) {
  if (!state?.siteFeature || !state?.results) return;

  const { siteFeature, bufferMeters, results } = state;
  const timestamp = new Date().toISOString();

  const bufferedSite = turf.buffer(siteFeature, bufferMeters / 1000, {
    units: 'kilometers',
  });

  const collection = {
    type: 'FeatureCollection',
    metadata: {
      generatedAt: timestamp,
      bufferMeters,
      sensitivity: results.sensitivity.level,
      totalAssets: results.assets.length,
    },
    features: [
      {
        ...siteFeature,
        properties: {
          ...(siteFeature.properties || {}),
          _role: 'site_boundary',
          _label: 'Red-Line Site Boundary',
        },
      },
      {
        ...bufferedSite,
        properties: {
          _role: 'search_buffer',
          _bufferMeters: bufferMeters,
        },
      },
      ...results.assets.map((asset) => {
        const meta = normalizeAssetMeta(asset);
        return {
          ...asset,
          properties: {
            ...asset.properties,
            _role: 'heritage_constraint',
            _normalizedName: meta.name,
            _grade: meta.grade,
            _recordUrl: meta.hyperlink,
          },
        };
      }),
    ],
  };

  const dateSlug = timestamp.split('T')[0];
  triggerDownload(
    JSON.stringify(collection, null, 2),
    `heritage-constraints-${dateSlug}.geojson`,
    'application/geo+json;charset=utf-8'
  );
}