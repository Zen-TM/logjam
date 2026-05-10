export const GEOPDF_BASE_LAYER_CONFIG: Record<
  string,
  { urlTemplate: string; maxNativeZoom: number; attribution: string }
> = {
  "six-topo": {
    urlTemplate:
      "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    maxNativeZoom: 16,
    attribution: "Base map © NSW Spatial Services (SIX Maps)",
  },
  "six-base": {
    urlTemplate:
      "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Base_Map/MapServer/tile/{z}/{y}/{x}",
    maxNativeZoom: 19,
    attribution: "Base map © NSW Spatial Services (SIX Maps)",
  },
  "six-imagery": {
    urlTemplate:
      "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxNativeZoom: 20,
    attribution: "Imagery © NSW Spatial Services (SIX Maps)",
  },
  osm: {
    urlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxNativeZoom: 19,
    attribution: "Base map © OpenStreetMap contributors",
  },
  "osm-topo": {
    urlTemplate: "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
    maxNativeZoom: 17,
    attribution:
      "Base map © OpenTopoMap (CC-BY-SA), © OpenStreetMap contributors",
  },
  "osm-cycle": {
    urlTemplate:
      "https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
    maxNativeZoom: 20,
    attribution:
      "Base map © CyclOSM, © OpenStreetMap contributors",
  },
};
