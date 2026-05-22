import classes from "./LayersPanel.module.css";
import { previewUrlFor } from "./tilePreview";
import type { TileLayer } from "./tilePreview";

type BaseLayer = TileLayer & { id: string; name: string };

function LayersPanel({
  layers,
  activeLayerId,
  onActiveLayerChange,
  mapView,
}: {
  layers: readonly BaseLayer[];
  activeLayerId: string;
  onActiveLayerChange: (id: string) => void;
  mapView: { lng: number; lat: number; zoom: number } | null;
}) {
  return (
    <div className={classes.gallery}>
      {layers.map((layer) => {
        const isActive = layer.id === activeLayerId;
        const thumbUrl = mapView ? previewUrlFor(layer, mapView) : null;
        return (
          <button
            key={layer.id}
            className={`${classes.tile} ${isActive ? classes.tileSelected : ""}`}
            onClick={() => onActiveLayerChange(layer.id)}
            aria-pressed={isActive}
          >
            <img
              src={thumbUrl ?? undefined}
              alt={layer.name}
              className={classes.tileImage}
              draggable={false}
            />
            <div className={classes.tileCaption}>{layer.name}</div>
          </button>
        );
      })}
    </div>
  );
}

export default LayersPanel;
