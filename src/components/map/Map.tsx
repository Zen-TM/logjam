import {
  LayersControl,
  MapContainer,
  TileLayer,
  ScaleControl,
  Marker,
  Tooltip,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import classes from "./Map.module.css";
import type { TCanyon, TFilters } from "../../canyonUtils";
import { passesFilters } from "../../canyonUtils";

function Map({ filters, canyons }: { filters: TFilters; canyons: TCanyon[] }) {
  const layers = [
    {
      name: "Default",
      url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
    {
      name: "OSM Topo",
      url: "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
      attribution:
        '<a href="https://github.com/der-stefan/OpenTopoMap" title="OSM OpenTopoMap">OpenTopo</a> | &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
    {
      name: "OSM Cycle Topo",
      url: "https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
      attribution:
        '<a href="https://github.com/cyclosm/cyclosm-cartocss-style/releases" title="CyclOSM - Open Bicycle render">CyclOSM</a> | &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
    {
      name: "Six Maps Topo",
      url: "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Topo_Map/MapServer/tile/{z}/{y}/{x}",
      attribution:
        '<a href="https://maps.six.nsw.gov.au/" title="SIX Maps - NSW Map">SIX Maps</a>',
    },
    {
      name: "SIX Maps Base Map",
      url: "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Base_Map/MapServer/tile/{z}/{y}/{x}",
      attribution:
        '<a href="https://maps.six.nsw.gov.au/" title="SIX Maps - NSW Map">SIX Maps</a>',
    },
    {
      name: "SIX Maps Imagery",
      url: "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer/tile/{z}/{y}/{x}",
      attribution:
        '<a href="https://maps.six.nsw.gov.au/" title="SIX Maps - NSW Map">SIX Maps</a>',
    },
    {
      name: "Esri World Hillshade",
      url: "https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
      attribution:
        '<a href="https://www.esri.com/en-us/arcgis/products/arcgis-online/maps/elevation" title="Esri World Hillshade">Esri, CGIAR</a>',
    },
  ];

  return (
    <div id="map" className={classes.map}>
      <MapContainer
        center={[-33.8688, 151.2093]}
        zoom={7}
        scrollWheelZoom={true}
        style={{ height: "100%", width: "100%" }}
      >
        <LayersControl position="topright">
          {layers.map((layer) => (
            <LayersControl.BaseLayer
              checked={layer.name === "Default"}
              key={layer.name}
              name={layer.name}
            >
              <TileLayer url={layer.url} attribution={layer.attribution} />
            </LayersControl.BaseLayer>
          ))}
        </LayersControl>
        <ScaleControl position="bottomleft" imperial={false} />
        {canyons
          .filter((canyon) => passesFilters(canyon, filters))
          .map((canyon) => (
            <Marker
              key={canyon.id}
              position={[canyon.latitude, canyon.longitude]}
              title={canyon.name}
            >
              <Tooltip>{canyon.name}</Tooltip>
            </Marker>
          ))}
      </MapContainer>
    </div>
  );
}

export default Map;
