import classes from "./LayersPanel.module.css";

function LayersPanel({
  layers,
  activeLayerId,
  onActiveLayerChange,
}: {
  layers: readonly { id: string; name: string }[];
  activeLayerId: string;
  onActiveLayerChange: (id: string) => void;
}) {
  return (
    <div className={classes.layerList}>
      {layers.map((layer) => (
        <label key={layer.id} className={classes.layerItem}>
          <input
            type="radio"
            name="base-layer"
            checked={activeLayerId === layer.id}
            onChange={() => onActiveLayerChange(layer.id)}
          />
          <span>{layer.name}</span>
        </label>
      ))}
    </div>
  );
}

export default LayersPanel;
