import { SAMPLE_SITES } from './config/services.js';
import { queryHeritageLayers } from './services/arcgisClient.js';
import { geocodeQuery } from './services/geocoder.js';
import { evaluateConstraints } from './analysis/spatialEngine.js';
import { MapController } from './map/mapController.js';
import { ResultsView } from './ui/resultsView.js';
import { downloadMarkdown, downloadPDF, downloadGeoJSON } from './ui/exporter.js';

const state = {
  siteFeature: null,
  bufferMeters: 500,
  results: null,
};

let resultsView = null;

const map = new MapController('map', {
  onSiteChanged: async (feature) => {
    state.siteFeature = feature;
    await runScreening();
  },
  onAssetClicked: (feature) => {
    resultsView?.showTerrainProfile(state.siteFeature, feature);
  },
});

resultsView = new ResultsView('results-container', {
  onSelectAsset: (feature) => map.focusAsset(feature),
  onFilterCategory: (category) => map.syncPillFilter(category),
  onExportMarkdown: () => downloadMarkdown(state),
  onExportPDF: () => downloadPDF(state, map.captureSnapshot()),
  onExportGeoJSON: () => downloadGeoJSON(state),
});

async function runScreening() {
  if (!state.siteFeature) return;
  resultsView.setLoading(true);

  const { buffered, features, herCoverage, errors } = await queryHeritageLayers(
    state.siteFeature,
    state.bufferMeters
  );
  const analysis = evaluateConstraints(state.siteFeature, features, state.bufferMeters);

  state.results = { ...analysis, herCoverage, errors };
  map.renderResults(buffered, analysis.assets);
  resultsView.render(state);
}

// ---------------------------------------------------------------------------
// First-Use Open Data Disclaimer Modal & Intro.js Guided Tour
// ---------------------------------------------------------------------------
const WELCOME_STORAGE_KEY = 'hcs_welcome_seen_v1';

function startIntroTour() {
  if (typeof window.introJs !== 'function') return;

  const isCompact = window.innerWidth < 768;

  const candidateSteps = [
    {
      element: '#search-form',
      title: '1. Search Any UK Site',
      intro:
        'Enter a UK postcode, town name, or WGS84 coordinates to jump straight to a site and run an automated heritage constraints screen.',
      position: 'bottom',
    },
    {
      element: '#buffer-select',
      title: '2. Adjust Screening Radius',
      intro:
        'Change the search buffer from 250 m up to 2,000 m to evaluate nearby designated heritage assets and setting impacts.',
      position: 'bottom',
    },
    {
      element: '#draw-btn',
      title: '3. Define a Red-Line Boundary',
      intro:
        'Sketch your own red-line site polygon directly on the map or upload a GeoJSON boundary for accurate area and intersection checks.',
      position: 'bottom',
    },
    {
      element: '#sample-select',
      title: '4. Explore Sample Heritage Sites',
      intro:
        'Jump straight to pre-loaded case studies—such as Berkhamsted Castle, Stonehenge, Bath Spa Core, or Housesteads Fort—to see complex designations in action.',
      position: 'bottom',
    },
    {
      title: '5. Interactive Map & Asset Inspection',
      intro:
        'Click anywhere on the map to drop a site pin, or click any colored polygon or marker to inspect its designation record and generate a sightline height profile.',
    },
    {
      element: '.maplibregl-ctrl-bottom-right',
      title: '6. Toggle Map Key & Layers',
      intro:
        'Open the Map Key to toggle individual Historic England layers, Listed Building grades (I, II*, II), and ADS grey literature on or off.',
      position: 'top',
    },
    {
      element: '#results-pane',
      title: '7. Height Charts, Summary & Exports',
      intro:
        'Selecting an asset opens its terrain elevation & sightline height chart alongside designation details—and you can export the full brief as PDF, Markdown, or GeoJSON.',
      position: isCompact ? 'top' : 'left',
    },
  ];

  // Keep floating steps (no element) plus steps whose target elements are visible
  const visibleSteps = candidateSteps.filter((step) => {
    if (!step.element) return true;
    const el = document.querySelector(step.element);
    return el && el.offsetParent !== null;
  });

  const activateFirstResultCard = () => {
    const firstCard = document.querySelector('#results-container [data-idx="0"]');
    if (firstCard) {
      firstCard.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      firstCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return true;
    }

    const firstAsset = state.results?.assets?.[0];
    if (firstAsset && state.siteFeature) {
      map.focusAsset(firstAsset);
      resultsView?.showTerrainProfile(state.siteFeature, firstAsset);
      return true;
    }
    return false;
  };

  const tour = window.introJs().setOptions({
    steps: visibleSteps,
    showProgress: true,
    showBullets: false,
    scrollToElement: false,
    exitOnOverlayClick: true,
    nextLabel: 'Next →',
    prevLabel: '← Back',
    doneLabel: 'Finish',
  });

  tour.onafterchange(function (targetElement) {
    if (targetElement?.id !== 'results-pane') return;

    if (!activateFirstResultCard()) {
      setTimeout(activateFirstResultCard, 400);
    }
  });

  tour.start();
}

function initFirstUseModal() {
  const overlay = document.getElementById('welcome-modal-overlay');
  const tourBtn = document.getElementById('welcome-tour-btn');
  const skipBtn = document.getElementById('welcome-skip-btn');

  if (!overlay) return;

  const closeWelcome = (launchTour = false) => {
    overlay.classList.add('hidden');
    try {
      localStorage.setItem(WELCOME_STORAGE_KEY, '1');
    } catch {
      // Ignore storage restrictions in private browsing
    }
    if (launchTour) {
      requestAnimationFrame(() => startIntroTour());
    }
  };

  tourBtn?.addEventListener('click', () => closeWelcome(true));
  skipBtn?.addEventListener('click', () => closeWelcome(false));

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeWelcome(false);
  });

  let hasSeen = false;
  try {
    hasSeen = localStorage.getItem(WELCOME_STORAGE_KEY) === '1';
  } catch {
    hasSeen = false;
  }

  if (!hasSeen) {
    overlay.classList.remove('hidden');
    tourBtn?.focus();
  }
}

document.getElementById('tour-btn')?.addEventListener('click', () => {
  startIntroTour();
});

// ---------------------------------------------------------------------------
// Centered Screen Feedback Overlay (Search & GeoJSON Errors)
// ---------------------------------------------------------------------------
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
let dismissTimer = null;

function getOrCreateFeedbackModal() {
  let overlay = document.getElementById('search-feedback-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'search-feedback-overlay';
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'search-feedback-title');
    overlay.className =
      'hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 backdrop-blur-2xs p-4';

    overlay.innerHTML = `
      <div class="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-2xl space-y-3 text-slate-900">
        <div class="flex items-start gap-3">
          <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 font-bold text-sm">
            !
          </div>
          <div class="space-y-1 min-w-0 flex-1">
            <h3 id="search-feedback-title" class="text-sm font-semibold text-slate-900">
              Location Not Found
            </h3>
            <p id="search-feedback-text" class="text-xs leading-relaxed text-slate-600"></p>
          </div>
        </div>
        <div class="flex justify-end pt-1">
          <button
            type="button"
            id="search-feedback-close"
            class="rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            Try Again
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
  }

  if (!overlay.dataset.backdropBound) {
    overlay.dataset.backdropBound = 'true';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) clearSearchError();
    });
  }

  return overlay;
}

function showSearchError(message, title = 'Location Not Found') {
  clearTimeout(dismissTimer);

  const overlay = getOrCreateFeedbackModal();
  const titleEl = overlay.querySelector('#search-feedback-title');
  const textEl = overlay.querySelector('#search-feedback-text');
  const closeBtn = overlay.querySelector('#search-feedback-close');

  if (titleEl) titleEl.textContent = title;
  if (textEl) textEl.textContent = message;

  overlay.classList.remove('hidden');
  searchInput?.classList.add('border-rose-500', 'ring-2', 'ring-rose-200');
  closeBtn?.focus();

  dismissTimer = setTimeout(clearSearchError, 6000);
}

function clearSearchError() {
  clearTimeout(dismissTimer);
  const overlay = document.getElementById('search-feedback-overlay');
  if (overlay && !overlay.classList.contains('hidden')) {
    overlay.classList.add('hidden');
    searchInput?.focus();
  }
  searchInput?.classList.remove('border-rose-500', 'ring-2', 'ring-rose-200');
}

document.addEventListener('click', (e) => {
  if (e.target?.id === 'search-feedback-close') clearSearchError();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    clearSearchError();
    const welcomeOverlay = document.getElementById('welcome-modal-overlay');
    if (welcomeOverlay && !welcomeOverlay.classList.contains('hidden')) {
      welcomeOverlay.classList.add('hidden');
      try {
        localStorage.setItem(WELCOME_STORAGE_KEY, '1');
      } catch {}
    }
  }
});

searchInput?.addEventListener('input', () => {
  searchInput.classList.remove('border-rose-500', 'ring-2', 'ring-rose-200');
});

searchForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearSearchError();

  const query = searchInput?.value?.trim();
  if (!query) {
    showSearchError(
      'Enter a UK postcode, town, or WGS84 coordinates (e.g. HP4 2EL).',
      'Search Query Required'
    );
    return;
  }

  const submitBtn = searchForm.querySelector('button[type="submit"]');
  const originalBtnText = submitBtn?.textContent;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Locating...';
  }

  try {
    const point = await geocodeQuery(query);
    point.properties = { ...(point.properties || {}), label: query };
    map.setSite(point, { fly: true, zoom: 15 });
  } catch (err) {
    const friendlyMessage =
      err?.message && !/failed to fetch/i.test(err.message)
        ? `${err.message}. Check the postcode or try a nearby town name.`
        : 'Unable to reach the geocoding service right now. Try clicking directly on the map.';
    showSearchError(friendlyMessage, 'Location Not Found');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalBtnText;
    }
  }
});

document.getElementById('buffer-select')?.addEventListener('change', async (e) => {
  state.bufferMeters = Number(e.target.value);
  if (state.siteFeature) await runScreening();
});

document.getElementById('draw-btn')?.addEventListener('click', () => {
  map.startDrawing();
});

document.getElementById('sample-select')?.addEventListener('change', (e) => {
  clearSearchError();
  const sample = SAMPLE_SITES[e.target.value];
  if (!sample) return;
  map.setSite(turf.point(sample.center), { fly: true, zoom: sample.zoom });
});

document.getElementById('geojson-input')?.addEventListener('change', async (e) => {
  clearSearchError();
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const feature = parsed.type === 'FeatureCollection' ? parsed.features[0] : parsed;
    if (!feature) {
      showSearchError(
        'The uploaded GeoJSON file does not contain any valid features.',
        'Invalid GeoJSON File'
      );
      return;
    }
    map.setSite(feature, { fly: true, zoom: 15 });
  } catch {
    showSearchError(
      'Could not parse that GeoJSON file. Check that it is valid JSON.',
      'Invalid GeoJSON File'
    );
  }
});

// Initialize first-use modal and automatically screen a default site on page load
initFirstUseModal();
map.setSite(turf.point(SAMPLE_SITES.berkhamsted.center), {
  fly: true,
  zoom: SAMPLE_SITES.berkhamsted.zoom,
});