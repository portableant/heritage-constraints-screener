export const HE_ARCGIS_BASE =
  'https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/ArcGIS/rest/services';

export const HERITAGE_LAYERS = [
  {
    id: 'listed-buildings-poly',
    category: 'Listed Buildings',
    url: `${HE_ARCGIS_BASE}/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/3`,
    color: '#d97706',
    isPolygon: true,
    dedupeKey: 'ListEntry',
    priority: 1, // Polygon footprint preferred over point
  },
  {
    id: 'listed-buildings-pt',
    category: 'Listed Buildings',
    url: `${HE_ARCGIS_BASE}/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/0`,
    color: '#d97706',
    isPolygon: false,
    dedupeKey: 'ListEntry',
    priority: 2,
  },
  {
    id: 'scheduled-monuments',
    category: 'Scheduled Monuments',
    url: `${HE_ARCGIS_BASE}/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/6`,
    color: '#dc2626',
    isPolygon: true,
  },
  {
    id: 'parks-gardens',
    category: 'Registered Parks & Gardens',
    url: `${HE_ARCGIS_BASE}/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/7`,
    color: '#059669',
    isPolygon: true,
  },
  {
    id: 'battlefields',
    category: 'Registered Battlefields',
    url: `${HE_ARCGIS_BASE}/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/8`,
    color: '#7c3aed',
    isPolygon: true,
  },
  {
    id: 'world-heritage-sites',
    category: 'World Heritage Sites',
    url: `${HE_ARCGIS_BASE}/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/10`,
    color: '#be185d',
    isPolygon: true,
  },
  {
    id: 'conservation-areas',
    category: 'Conservation Areas',
    url: `${HE_ARCGIS_BASE}/Conservation_Areas/FeatureServer/0`,
    color: '#0284c7',
    isPolygon: true,
  },
  {
    id: 'research-reports',
    category: 'HE Research Reports',
    url: `${HE_ARCGIS_BASE}/Historic_England_Research_Spatial_Reports/FeatureServer/475`,
    color: '#475569',
    isPolygon: false,
  },
];

export const SAMPLE_SITES = {
  berkhamsted: {
    label: 'Berkhamsted Castle (HP4 1LJ)',
    center: [-0.5588, 51.7636],
    zoom: 15,
  },
  bath: {
    label: 'Royal Crescent, Bath (BA1 2LR)',
    center: [-2.3683, 51.3871],
    zoom: 16,
  },
  stonehenge: {
    label: 'Stonehenge Landscape (SP4 7DE)',
    center: [-1.8262, 51.1789],
    zoom: 14,
  },
  saltaire: {
    label: 'Saltaire Model Village (BD18 3HU)',
    center: [-1.7903, 53.8372],
    zoom: 15,
  },
};