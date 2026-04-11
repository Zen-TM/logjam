import { BASE_LAYERS } from "../../map/Map";
import classes from "./LayersPanel.module.css";

function LayersPanel({
  activeLayerId,
  onActiveLayerChange,
}: {
  activeLayerId: string;
  onActiveLayerChange: (id: string) => void;
}) {
  return (
    <div className={classes.layerList}>
      {BASE_LAYERS.map((layer) => (
        <label key={layer.id} className={classes.layerItem}>
          <input
            type="radio"
            name="base-layer"
            checked={activeLayerId === layer.id}
            onChange={() => onActiveLayerChange(layer.id)}
            style={{
              accentColor: "var(--theme-secondary)",
            }}
          />
          <span>{layer.name}</span>
        </label>
      ))}
    </div>
  );
}

export default LayersPanel;
