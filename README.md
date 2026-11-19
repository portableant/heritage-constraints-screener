# Heritage Impact & Constraints Screener

A zero-backend, browser-based spatial screening tool for England that queries **Historic England Open Data** live via ArcGIS REST FeatureServices to identify designated heritage assets, Conservation Areas, and spatial research reports within a configurable buffer of any site boundary or postcode.

Built with native ES modules, MapLibre GL JS, Turf.js, and Tailwind CSS—designed to run directly on **GitHub Pages** with no build step or API keys.

---

## Features

- **Flexible Site Definition:**
  - Search by UK postcode (`postcodes.io`) or place name (`Nominatim`).
  - Drop a point pin or sketch a custom red-line polygon boundary directly on the map.
  - Import an existing site boundary via `.geojson` / `.json` upload.
  - One-click sample presets (Berkhamsted Castle, Royal Crescent Bath, Stonehenge Landscape, Saltaire Model Village).
- **Live Parallel ArcGIS Queries:**
  - Listed Buildings (Polygons & Points, automatically deduplicated by `ListEntry` with polygon footprints prioritized).
  - Scheduled Monuments.
  - Registered Parks & Gardens.
  - Registered Battlefields.
  - Conservation Areas.
  - Historic England Spatial Research Reports (grey-literature reports).
  - Aerial Investigation & Mapping (AIM) Monument Extents.
- **Client-Side Spatial Analysis (`@turf/turf`):**
  - Calculates edge-to-edge minimum distances in metres (`0 m` when intersecting the site boundary).
  - Generates an indicative initial sensitivity rating aligned with National Planning Policy Framework (NPPF) screening principles.
- **Planning-Ready Exports:**
  - **Markdown Brief (`.md`):** Structured summary table, itemized asset schedule with direct NHLE record links, and statutory caveats.
  - **GIS Bundle (`.geojson`):** Combined `FeatureCollection` containing the red-line site boundary, search buffer polygon, and all screened constraints tagged by `_role` for immediate styling in QGIS.
  - **Print / PDF View:** Dedicated `@media print` stylesheet that hides map chrome and formats the report cleanly for saving as PDF.

---

## Repository Structure

```text
├── index.html                    # Semantic layout shell & CDN dependencies
├── css/
│   └── styles.css                # MapLibre overrides, scrollbar styling & print rules
└── js/
    ├── main.js                   # Application state store & module orchestration
    ├── config/
    │   └── services.js           # Historic England ArcGIS endpoints, colors & sample sites
    ├── services/
    │   ├── arcgisClient.js       # Parallel FeatureServer queries & ListEntry deduplication
    │   └── geocoder.js           # postcodes.io & Nominatim lookup client
    ├── analysis/
    │   └── spatialEngine.js      # Turf.js edge-to-edge distances & sensitivity classification
    ├── map/
    │   └── mapController.js      # MapLibre GL instance, polygon drawing, layers & popups
    └── ui/
        ├── resultsView.js        # Summary cards, category filters & interactive asset list
        └── exporter.js           # Markdown brief & GeoJSON bundle generators