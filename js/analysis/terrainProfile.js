const TILE_CACHE = new Map();

function lngLatToTile(lng, lat, zoom) {
  const n = 2 ** zoom;
  const xFloat = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const yFloat =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

  const tileX = Math.floor(xFloat);
  const tileY = Math.floor(yFloat);
  const pixelX = Math.min(255, Math.max(0, Math.floor((xFloat - tileX) * 256)));
  const pixelY = Math.min(255, Math.max(0, Math.floor((yFloat - tileY) * 256)));

  return { tileX, tileY, pixelX, pixelY };
}

async function loadTerrariumTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (TILE_CACHE.has(key)) return TILE_CACHE.get(key);

  const promise = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, 256, 256).data);
    };
    img.onerror = () => reject(new Error(`Elevation tile failed: ${key}`));
    img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
  });

  TILE_CACHE.set(key, promise);
  return promise;
}

async function getElevationMeters(lng, lat, zoom = 14) {
  const { tileX, tileY, pixelX, pixelY } = lngLatToTile(lng, lat, zoom);
  const data = await loadTerrariumTile(zoom, tileX, tileY);
  const idx = (pixelY * 256 + pixelX) * 4;
  const r = data[idx];
  const g = data[idx + 1];
  const b = data[idx + 2];
  // Terrarium elevation formula: (R * 256 + G + B / 256) - 32768
  return r * 256 + g + b / 256 - 32768;
}

/**
 * Samples terrain elevation along the sightline from siteFeature to assetFeature
 * and checks whether intermediate topography blocks a 2m observer-to-target sightline.
 */
export async function computeElevationProfile(siteFeature, assetFeature, samples = 36) {
  const startCoord = turf.centroid(siteFeature).geometry.coordinates;
  const endCoord = turf.pointOnFeature(assetFeature).geometry.coordinates;

  const line = turf.lineString([startCoord, endCoord]);
  const totalMeters = turf.length(line, { units: 'meters' });

  if (totalMeters < 5) {
    const elev = await getElevationMeters(startCoord[0], startCoord[1]);
    return {
      totalMeters: 0,
      points: [{ distance: 0, elevation: Math.round(elev * 10) / 10 }],
      minElev: elev,
      maxElev: elev,
      deltaElev: 0,
      obstructed: false,
    };
  }

  const coords = [];
  for (let i = 0; i <= samples; i++) {
    const dist = (totalMeters * i) / samples;
    const pt = turf.along(line, dist, { units: 'meters' }).geometry.coordinates;
    coords.push({ distance: dist, lng: pt[0], lat: pt[1] });
  }

  const elevations = await Promise.all(
    coords.map((c) => getElevationMeters(c.lng, c.lat, 14))
  );

  const points = coords.map((c, idx) => ({
    distance: Math.round(c.distance),
    elevation: Math.round(elevations[idx] * 10) / 10,
  }));

  const minElev = Math.min(...elevations);
  const maxElev = Math.max(...elevations);
  const startEye = elevations[0] + 2.0; // 2m observer height at site
  const endTarget = elevations[elevations.length - 1] + 5.0; // 5m structure/monument height

  let obstructed = false;
  for (let i = 1; i < points.length - 1; i++) {
    const t = i / (points.length - 1);
    const losHeight = startEye + (endTarget - startEye) * t;
    if (elevations[i] > losHeight) {
      obstructed = true;
      break;
    }
  }

  return {
    totalMeters: Math.round(totalMeters),
    points,
    minElev: Math.round(minElev * 10) / 10,
    maxElev: Math.round(maxElev * 10) / 10,
    deltaElev: Math.round((elevations[elevations.length - 1] - elevations[0]) * 10) / 10,
    obstructed,
  };
}

/**
 * Renders an inline SVG elevation cross-section card for GPA3 Setting assessments.
 */
export function renderProfileSVG(profile, assetName) {
  const { points, minElev, maxElev, deltaElev, totalMeters, obstructed } = profile;
  const w = 320;
  const h = 92;
  const padL = 28;
  const padR = 10;
  const padT = 10;
  const padB = 18;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const spanElev = Math.max(5, maxElev - minElev);
  const yMin = minElev - spanElev * 0.15;
  const yMax = maxElev + spanElev * 0.2;

  const toX = (d) => padL + (totalMeters > 0 ? (d / totalMeters) * plotW : 0);
  const toY = (e) => padT + plotH - ((e - yMin) / (yMax - yMin)) * plotH;

  const polyPts = points.map((p) => `${toX(p.distance).toFixed(1)},${toY(p.elevation).toFixed(1)}`);
  const areaPath = `M ${padL},${padT + plotH} L ${polyPts.join(' L ')} L ${padL + plotW},${padT + plotH} Z`;
  const linePath = `M ${polyPts.join(' L ')}`;

  const startPt = points[0];
  const endPt = points[points.length - 1];
  const losX1 = toX(startPt.distance).toFixed(1);
  const losY1 = toY(startPt.elevation + 2).toFixed(1);
  const losX2 = toX(endPt.distance).toFixed(1);
  const losY2 = toY(endPt.elevation + 5).toFixed(1);

  const badge = obstructed
    ? `<span class="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 font-medium">Terrain Screened</span>`
    : `<span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium">Direct Terrain LOS</span>`;

  return `
    <div class="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
      <div class="flex items-center justify-between gap-2">
        <span class="text-[11px] font-bold uppercase tracking-wide text-slate-700">GPA3 Setting Terrain Profile</span>
        <span class="text-[10px]">${badge}</span>
      </div>
      <div class="text-[11px] text-slate-600 truncate">Site &rarr; <strong>${assetName}</strong> (${totalMeters} m)</div>
      <svg viewBox="0 0 ${w} ${h}" class="w-full h-24 bg-white border border-slate-200 rounded">
        <path d="${areaPath}" fill="#fef3c7" />
        <path d="${linePath}" fill="none" stroke="#d97706" stroke-width="2" />
        <line x1="${losX1}" y1="${losY1}" x2="${losX2}" y2="${losY2}" stroke="${
          obstructed ? '#64748b' : '#dc2626'
        }" stroke-width="1.2" stroke-dasharray="3 2" />
        <circle cx="${losX1}" cy="${toY(startPt.elevation).toFixed(1)}" r="3" fill="#dc2626" />
        <circle cx="${losX2}" cy="${toY(endPt.elevation).toFixed(1)}" r="3" fill="#0f172a" />
        <text x="4" y="${padT + 8}" font-size="8" fill="#64748b">${Math.round(maxElev)}m</text>
        <text x="4" y="${padT + plotH}" font-size="8" fill="#64748b">${Math.round(minElev)}m</text>
        <text x="${padL}" y="${h - 4}" font-size="8" fill="#64748b">Site (0m)</text>
        <text x="${w - 42}" y="${h - 4}" font-size="8" fill="#64748b">${totalMeters}m</text>
      </svg>
      <div class="flex justify-between text-[10px] text-slate-500">
        <span>Site: <strong>${startPt.elevation} m AOD</strong></span>
        <span>Asset: <strong>${endPt.elevation} m AOD</strong> (${deltaElev >= 0 ? '+' : ''}${deltaElev} m)</span>
      </div>
    </div>
  `;
}