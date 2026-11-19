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
 * Formats an ArcGIS epoch timestamp (ms) or date string into YYYY-MM-DD.
 */
function formatArcGISDate(rawDate) {
  if (!rawDate) return null;
  if (typeof rawDate === 'number') {
    return new Date(rawDate).toISOString().split('T')[0];
  }
  const str = String(rawDate).trim();
  return str || null;
}

/**
 * Normalizes disparate Historic England ArcGIS attribute schemas into
 * rich, consistent display fields for map popups, sidebar cards, and exports.
 */
export function normalizeAssetMeta(feature) {
  const p = feature.properties || {};
  const isResearchReport =
    p._layerId === 'research-reports' || Boolean(p.Report_Num || p.Report_title);
  const isHeritageAtRisk =
    p._category === 'Heritage at Risk' ||
    Boolean(p.Condition || p.Vulnerability || p.PriorityCategory);

  const name =
    p.Name ||
    p.NAME ||
    p.SiteName ||
    p.SITE_NAME ||
    p.Report_title ||
    p.TITLE ||
    p.Title ||
    p.MONUMENT_NAME ||
    'Unnamed Heritage Asset';

  const listEntry =
    p.ListEntry ||
    p.LISTENTRY ||
    p.HAR_ID ||
    p.Report_Num ||
    p.UID ||
    p.REPORT_NO ||
    null;

  const grade = p.Grade || p.GRADE || null;

  const hyperlink =
    p.Hyperlink ||
    p.HYPERLINK ||
    p.Report_URL ||
    p.URL ||
    (listEntry && /^\d+$/.test(String(listEntry)) && !isResearchReport
      ? `https://historicengland.org.uk/listing/the-list/list-entry/${listEntry}`
      : null);

  // Enhanced Research Report metadata (Layer 475: All_Reports_05_05_2026_ODH)
  const authors = p.Author_s_ ? String(p.Author_s_).trim() : null;
  const year = p.Year ? String(Math.round(Number(p.Year))) : null;
  const reportType = p.Simple_Report_type || p.Project_type || null;
  const description = p.Brief_description ? String(p.Brief_description).trim() : null;
  const keywords = p.Keyword ? String(p.Keyword).trim() : null;
  const pages = p.Pages ? String(p.Pages).trim() : null;
  const sizeMb = p.Size_in_MB ? String(p.Size_in_MB).trim() : null;

  // Enhanced Heritage at Risk metadata
  const condition = p.Condition || p.CONDITION || null;
  const occupancy = p.Occupancy || p.OCCUPANCY || null;
  const vulnerability = p.Vulnerability || p.VULNERABILITY || null;
  const priorityCategory = p.PriorityCategory || p.Priority || p.PRIORITY || null;

  // Enhanced NHLE / Conservation Area metadata
  const listDate = formatArcGISDate(p.ListDate || p.LISTDATE || p.DesignationDate);
  const amendDate = formatArcGISDate(p.AmendDate || p.AMENDDATE);
  const localAuthority = p.LocalAuthority || p.LPA || p.District || null;
  const ngr = p.NGR || null;

  // Build concise subtitle & detail lines for UI cards and reports
  const detailParts = [];
  if (grade) detailParts.push(`Grade ${grade}`);
  if (isHeritageAtRisk && condition) detailParts.push(`Condition: ${condition}`);
  if (isHeritageAtRisk && priorityCategory) detailParts.push(`Priority: ${priorityCategory}`);
  if (isHeritageAtRisk && vulnerability) detailParts.push(`Vulnerability: ${vulnerability}`);
  if (reportType) detailParts.push(reportType);
  if (authors) detailParts.push(authors);
  if (year) detailParts.push(year);
  if (listDate) detailParts.push(`Listed ${listDate}`);
  if (localAuthority) detailParts.push(localAuthority);

  const fileSpecParts = [];
  if (pages) fileSpecParts.push(`${pages} pp.`);
  if (sizeMb) fileSpecParts.push(`${sizeMb} MB`);

  return {
    name: String(name).trim(),
    category: p._category || 'Heritage Constraint',
    isResearchReport,
    isHeritageAtRisk,
    listEntry: listEntry ? String(listEntry).trim() : 'N/A',
    grade: grade ? `Grade ${grade}` : null,
    distanceMeters: p._distanceMeters ?? null,
    intersects: Boolean(p._intersects),
    hyperlink,
    authors,
    year,
    reportType,
    description,
    keywords,
    pages,
    sizeMb,
    fileSpec: fileSpecParts.length > 0 ? fileSpecParts.join(', ') : null,
    condition,
    occupancy,
    vulnerability,
    priorityCategory,
    listDate,
    amendDate,
    localAuthority,
    ngr,
    subtitle: detailParts.join(' · '),
  };
}

/**
 * Builds the structured Markdown Heritage Constraints Brief string
 * used by both Markdown and PDF exporters.
 */
export function buildMarkdownBrief(state) {
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

  lines.push(``, `## Detailed Schedule of Identified Assets & Grey Literature`, ``);

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
      const idLabel = m.isResearchReport ? 'Report No.' : 'List Entry';
      const idTag = m.listEntry !== 'N/A' ? ` — ${idLabel}: \`${m.listEntry}\`` : '';
      const linkLabel = m.isResearchReport ? 'Download / View Report' : 'View NHLE Record';
      const linkPart = m.hyperlink ? ` — [${linkLabel}](${m.hyperlink})` : '';

      lines.push(
        `${index + 1}. **${m.name}**${gradeTag} — *${m.category}*${idTag}  \n   Distance: ${distLabel}${linkPart}`
      );

      // Append rich secondary metadata lines when available
      const metaBullets = [];
      if (m.condition) metaBullets.push(`Condition: **${m.condition}**`);
      if (m.priorityCategory) metaBullets.push(`Priority: ${m.priorityCategory}`);
      if (m.vulnerability) metaBullets.push(`Vulnerability: ${m.vulnerability}`);
      if (m.occupancy) metaBullets.push(`Occupancy: ${m.occupancy}`);
      if (m.authors || m.year) {
        const citation = [m.authors, m.year ? `(${m.year})` : null].filter(Boolean).join(' ');
        metaBullets.push(`Authors / Year: ${citation}`);
      }
      if (m.reportType) metaBullets.push(`Investigation Type: ${m.reportType}`);
      if (m.fileSpec) metaBullets.push(`Document: ${m.fileSpec}`);
      if (m.listDate) metaBullets.push(`Designation Date: ${m.listDate}`);
      if (m.ngr) metaBullets.push(`NGR: \`${m.ngr}\``);
      if (m.keywords) metaBullets.push(`Keywords: *${m.keywords}*`);

      if (metaBullets.length > 0) {
        lines.push(`   ${metaBullets.join(' | ')}`);
      }
      if (m.description) {
        lines.push(`   > ${m.description}`);
      }
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
    `- **Non-Designated Heritage Assets:** This screening covers national designations, the Heritage at Risk Register, and Historic England Research Reports. Consult the relevant local authority **Historic Environment Record (HER)** for non-designated archaeological monuments, findspots, and historic landscape characterization.`,
    `- **Setting & Significance:** Spatial proximity does not equate to harm. Assessment of setting impacts must follow *Historic Environment Good Practice Advice in Planning Note 3 (The Setting of Heritage Assets)* and NPPF Chapter 16.`
  );

  return lines.join('\n');
}

/**
 * Generates and downloads a structured Markdown Heritage Constraints Brief.
 */
export function downloadMarkdown(state) {
  if (!state?.siteFeature || !state?.results) return;
  const timestamp = new Date().toISOString().split('T')[0];
  const markdown = buildMarkdownBrief(state);

  triggerDownload(
    markdown,
    `heritage-constraints-brief-${timestamp}.md`,
    'text/markdown;charset=utf-8'
  );
}

/**
 * Converts the Markdown brief into styled HTML and exports a paginated A4 PDF.
 */
export async function downloadPDF(state) {
  if (!state?.siteFeature || !state?.results) return;

  const timestamp = new Date().toISOString().split('T')[0];
  const markdown = buildMarkdownBrief(state);
  const renderedHtml = window.marked
    ? window.marked.parse(markdown)
    : `<pre>${markdown}</pre>`;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <style>
      .pdf-report {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #0f172a;
        font-size: 11pt;
        line-height: 1.5;
      }
      .pdf-report h1 {
        font-size: 18pt;
        font-weight: 700;
        border-bottom: 2px solid #0f172a;
        padding-bottom: 6px;
        margin: 0 0 12px 0;
      }
      .pdf-report h2 {
        font-size: 13pt;
        font-weight: 700;
        color: #1e293b;
        margin: 18px 0 8px 0;
        page-break-after: avoid;
      }
      .pdf-report p, .pdf-report li {
        font-size: 10pt;
        margin-bottom: 6px;
      }
      .pdf-report li {
        page-break-inside: avoid;
      }
      .pdf-report blockquote {
        margin: 8px 0;
        padding: 8px 12px;
        background: #f8fafc;
        border-left: 3px solid #d97706;
        color: #334155;
        font-size: 9.5pt;
      }
      .pdf-report table {
        width: 100%;
        border-collapse: collapse;
        margin: 10px 0 14px 0;
        font-size: 9.5pt;
      }
      .pdf-report th, .pdf-report td {
        border: 1px solid #cbd5e1;
        padding: 6px 8px;
        text-align: left;
      }
      .pdf-report th {
        background: #f1f5f9;
        font-weight: 600;
      }
      .pdf-report code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        background: #f1f5f9;
        padding: 1px 4px;
        border-radius: 3px;
        font-size: 9pt;
      }
      .pdf-report a {
        color: #b45309;
        text-decoration: underline;
      }
      .pdf-report hr {
        border: none;
        border-top: 1px solid #cbd5e1;
        margin: 16px 0;
      }
    </style>
    <div class="pdf-report">${renderedHtml}</div>
  `;

  if (window.html2pdf) {
    const options = {
      margin: [14, 14, 16, 14],
      filename: `heritage-constraints-brief-${timestamp}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
    };
    await window.html2pdf().set(options).from(wrapper).save();
  } else {
    window.print();
  }
}

/**
 * Generates and downloads a GIS-ready GeoJSON FeatureCollection containing
 * the site boundary, search buffer, and all screened heritage features
 * with normalized metadata properties.
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
            _identifier: meta.listEntry,
            _grade: meta.grade,
            _condition: meta.condition,
            _priorityCategory: meta.priorityCategory,
            _vulnerability: meta.vulnerability,
            _reportType: meta.reportType,
            _authors: meta.authors,
            _year: meta.year,
            _description: meta.description,
            _keywords: meta.keywords,
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