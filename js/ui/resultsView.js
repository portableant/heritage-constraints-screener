import { normalizeAssetMeta } from './exporter.js';

export class ResultsView {
  constructor(containerId, { onSelectAsset, onExportMarkdown, onExportGeoJSON }) {
    this.container = document.getElementById(containerId);
    this.onSelectAsset = onSelectAsset;
    this.onExportMarkdown = onExportMarkdown;
    this.onExportGeoJSON = onExportGeoJSON;
    this.activeFilter = 'ALL';
    this.lastState = null;
  }

  setLoading(isLoading) {
    if (!isLoading || !this.container) return;
    this.container.innerHTML = `
      <div class="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
        <div class="w-4 h-4 border-2 border-amber-600 border-t-transparent rounded-full animate-spin"></div>
        <span>Querying Historic England FeatureServers...</span>
      </div>
    `;
  }

  render(state) {
    this.lastState = state;
    if (!this.container || !state?.results) return;

    const { assets, sensitivity, errors = [] } = state.results;
    const categories = ['ALL', ...new Set(assets.map((a) => a.properties._category))];
    const filtered =
      this.activeFilter === 'ALL'
        ? assets
        : assets.filter((a) => a.properties._category === this.activeFilter);

    const errorHtml = errors.length
      ? `<div class="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800">
           <strong>Layer warnings:</strong> ${errors.map((e) => e.layer).join(', ')} failed to respond.
         </div>`
      : '';

    const pillsHtml = categories
      .map((cat) => {
        const active = cat === this.activeFilter;
        const count =
          cat === 'ALL'
            ? assets.length
            : assets.filter((a) => a.properties._category === cat).length;
        return `
          <button
            data-filter="${cat}"
            class="filter-pill px-2.5 py-1 rounded-full text-xs font-medium border ${
              active
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
            }"
          >
            ${cat} (${count})
          </button>
        `;
      })
      .join('');

    const cardsHtml =
      filtered.length === 0
        ? `<div class="text-xs text-slate-500 p-4 border border-dashed border-slate-300 rounded-lg text-center">
             No heritage assets found in this category within ${state.bufferMeters} m.
           </div>`
        : filtered
            .map((asset, idx) => {
              const m = normalizeAssetMeta(asset);
              const badge = m.intersects
                ? `<span class="px-2 py-0.5 rounded bg-red-100 text-red-800 font-semibold">0 m · Intersects</span>`
                : `<span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">${m.distanceMeters} m</span>`;

              return `
                <div data-idx="${idx}" class="asset-card p-3 bg-white border border-slate-200 rounded-lg hover:border-slate-400 cursor-pointer space-y-1.5">
                  <div class="flex items-start justify-between gap-2">
                    <div class="text-xs font-semibold text-slate-900 leading-snug">${m.name}</div>
                    <div class="shrink-0 text-[11px]">${badge}</div>
                  </div>
                  <div class="flex items-center justify-between text-[11px] text-slate-500">
                    <span>${m.category}${m.grade ? ` · <strong>${m.grade}</strong>` : ''}</span>
                    ${
                      m.hyperlink
                        ? `<a href="${m.hyperlink}" target="_blank" rel="noopener" onclick="event.stopPropagation()" class="text-amber-700 hover:underline">NHLE &nearr;</a>`
                        : ''
                    }
                  </div>
                </div>
              `;
            })
            .join('');

    this.container.innerHTML = `
      <div class="p-3.5 rounded-lg border ${sensitivity.badgeClass} space-y-1.5">
        <div class="text-xs font-bold uppercase tracking-wide">${sensitivity.level}</div>
        <p class="text-xs leading-relaxed">${sensitivity.summary}</p>
      </div>

      <div class="flex flex-wrap gap-2 no-print">
        <button id="btn-export-md" class="flex-1 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium py-2 px-3 rounded">
          Download Markdown Brief
        </button>
        <button id="btn-export-geojson" class="flex-1 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 text-xs font-medium py-2 px-3 rounded">
          Download GeoJSON
        </button>
      </div>

      ${errorHtml}

      <div class="flex flex-wrap gap-1.5 no-print">${pillsHtml}</div>

      <div class="space-y-2">${cardsHtml}</div>
    `;

    this.container.querySelector('#btn-export-md')?.addEventListener('click', () => {
      this.onExportMarkdown?.();
    });
    this.container.querySelector('#btn-export-geojson')?.addEventListener('click', () => {
      this.onExportGeoJSON?.();
    });

    this.container.querySelectorAll('.filter-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeFilter = btn.dataset.filter;
        this.render(this.lastState);
      });
    });

    this.container.querySelectorAll('.asset-card').forEach((card) => {
      card.addEventListener('click', () => {
        this.container.querySelectorAll('.asset-card').forEach((c) => c.classList.remove('is-selected'));
        card.classList.add('is-selected');
        const item = filtered[Number(card.dataset.idx)];
        if (item) this.onSelectAsset?.(item);
      });
    });
  }
}