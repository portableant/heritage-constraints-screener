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
        <div class="w-4 h-4 border-2 border-amber-600 border-t-transparent rounded-full animate-spin shrink-0"></div>
        <span>Querying Historic England FeatureServers...</span>
      </div>
    `;
  }

  render(state) {
    this.lastState = state;
    if (!this.container || !state?.results) return;

    const { assets, sensitivity, errors = [] } = state.results;
    const categories = ['ALL', ...new Set(assets.map((a) => a.properties._category))];

    // Reset filter if the active category has no items in the new result set
    if (this.activeFilter !== 'ALL' && !categories.includes(this.activeFilter)) {
      this.activeFilter = 'ALL';
    }

    const filtered =
      this.activeFilter === 'ALL'
        ? assets
        : assets.filter((a) => a.properties._category === this.activeFilter);

    const errorHtml = errors.length
      ? `<div class="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800">
           <strong>Layer warnings:</strong> ${errors.map((e) => `${e.layer} (${e.message})`).join('; ')}.
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
            class="filter-pill px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
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
              const color = asset.properties._color || '#64748b';
              const badge = m.intersects
                ? `<span class="px-2 py-0.5 rounded bg-red-100 text-red-800 font-semibold">0 m · Intersects</span>`
                : `<span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">${m.distanceMeters} m</span>`;

              const idTag =
                m.listEntry !== 'N/A'
                  ? `<span class="font-mono text-[10px] text-slate-500">${m.isResearchReport ? 'Rep.' : 'ID'} ${m.listEntry}</span>`
                  : '';

              const linkText = m.isResearchReport ? 'Report PDF ↗' : 'NHLE ↗';
              const fileSpecTag = m.fileSpec
                ? `<span class="text-[10px] text-slate-400">(${m.fileSpec})</span>`
                : '';

              return `
                <div
                  data-idx="${idx}"
                  class="asset-card p-3 bg-white border border-slate-200 rounded-lg hover:border-slate-400 cursor-pointer space-y-1.5"
                >
                  <div class="flex items-start justify-between gap-2">
                    <div class="flex items-start gap-2 min-w-0">
                      <span
                        class="inline-block w-2.5 h-2.5 rounded-full mt-1 shrink-0"
                        style="background-color: ${color};"
                      ></span>
                      <div class="text-xs font-semibold text-slate-900 leading-snug break-words">
                        ${m.name}
                      </div>
                    </div>
                    <div class="shrink-0 text-[11px]">${badge}</div>
                  </div>

                  ${
                    m.subtitle
                      ? `<div class="text-[11px] text-slate-600 pl-4">${m.subtitle}</div>`
                      : ''
                  }

                  ${
                    m.description
                      ? `<p class="text-[11px] text-slate-500 pl-4 leading-relaxed line-clamp-2">${m.description}</p>`
                      : ''
                  }

                  <div class="flex items-center justify-between gap-2 pt-1 pl-4 text-[11px] text-slate-500">
                    <div class="flex items-center gap-2 truncate">
                      <span>${m.category}</span>
                      ${idTag}
                      ${fileSpecTag}
                    </div>
                    ${
                      m.hyperlink
                        ? `<a
                             href="${m.hyperlink}"
                             target="_blank"
                             rel="noopener noreferrer"
                             onclick="event.stopPropagation()"
                             class="text-amber-700 hover:text-amber-800 hover:underline font-medium shrink-0"
                           >${linkText}</a>`
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
        <button id="btn-export-md" class="flex-1 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium py-2 px-3 rounded transition-colors">
          Download Markdown Brief
        </button>
        <button id="btn-export-geojson" class="flex-1 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 text-xs font-medium py-2 px-3 rounded transition-colors">
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
        this.container
          .querySelectorAll('.asset-card')
          .forEach((c) => c.classList.remove('is-selected'));
        card.classList.add('is-selected');
        const item = filtered[Number(card.dataset.idx)];
        if (item) this.onSelectAsset?.(item);
      });
    });
  }
}