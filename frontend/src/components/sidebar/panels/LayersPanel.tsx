import { useRef, useState } from "react";
import { Switch } from "@mui/material";
import { GripVertical } from "lucide-react";
import classes from "./LayersPanel.module.css";
import { previewUrlFor } from "./tilePreview";
import type { TileLayer } from "./tilePreview";
import { TOPO_LAYERS } from "../../../topoLayerTypes";

type BaseLayer = TileLayer & { id: string; name: string };

function LayersPanel({
  // Overlays
  showOwnedCanyons,
  setShowOwnedCanyons,
  showSharedCanyons,
  setShowSharedCanyons,
  showCanyonTracks,
  setShowCanyonTracks,
  lidarEnabled,
  setLidarEnabled,
  lidarLayerToggles,
  setLidarLayerToggles,
  lidarLayerOrder,
  setLidarLayerOrder,
  // Basemap
  layers,
  activeLayerId,
  onActiveLayerChange,
  mapView,
}: {
  showOwnedCanyons: boolean;
  setShowOwnedCanyons: (v: boolean) => void;
  showSharedCanyons: boolean;
  setShowSharedCanyons: (v: boolean) => void;
  showCanyonTracks: boolean;
  setShowCanyonTracks: (v: boolean) => void;
  lidarEnabled: boolean;
  setLidarEnabled: (v: boolean) => void;
  lidarLayerToggles: Record<string, boolean>;
  setLidarLayerToggles: (
    v: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>),
  ) => void;
  lidarLayerOrder: string[];
  setLidarLayerOrder: (v: string[] | ((prev: string[]) => string[])) => void;
  layers: readonly BaseLayer[];
  activeLayerId: string;
  onActiveLayerChange: (id: string) => void;
  mapView: { lng: number; lat: number; zoom: number } | null;
}) {
  const dragIndex = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  function handleLayerToggle(name: string, checked: boolean) {
    setLidarLayerToggles((prev) => ({ ...prev, [name]: checked }));
  }

  function onDragStart(index: number) {
    dragIndex.current = index;
    setDraggingIndex(index);
  }

  function onDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    setDragOverIndex(index);
  }

  function onDrop(e: React.DragEvent, dropIndex: number) {
    e.preventDefault();
    const from = dragIndex.current;
    if (from === null || from === dropIndex) {
      dragIndex.current = null;
      setDragOverIndex(null);
      setDraggingIndex(null);
      return;
    }
    setLidarLayerOrder((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      const insertAt = from < dropIndex ? dropIndex - 1 : dropIndex;
      next.splice(insertAt, 0, item);
      return next;
    });
    dragIndex.current = null;
    setDragOverIndex(null);
    setDraggingIndex(null);
  }

  function onDragEnd() {
    dragIndex.current = null;
    setDragOverIndex(null);
    setDraggingIndex(null);
  }

  // Keyboard-accessible alternative to drag reordering (WCAG 2.1.1 / 2.5.1).
  function moveLayer(from: number, to: number) {
    if (to < 0 || to >= lidarLayerOrder.length) return;
    setLidarLayerOrder((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  const switchSx = (color: string) => ({
    "& .MuiSwitch-switchBase.Mui-checked": { color },
    "& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track": {
      backgroundColor: color,
    },
  });

  return (
    <div className={classes.root}>
      {/* Overlays section */}
      <div className={classes.sectionLabel}>Overlays</div>

      <div className={classes.toggleRow}>
        <span>My Canyons</span>
        <Switch
          size="small"
          checked={showOwnedCanyons}
          onChange={(_, v) => setShowOwnedCanyons(v)}
          sx={switchSx("var(--owned-canyon-color)")}
        />
      </div>
      <div className={classes.toggleRow}>
        <span>Shared Canyons</span>
        <Switch
          size="small"
          checked={showSharedCanyons}
          onChange={(_, v) => setShowSharedCanyons(v)}
          sx={switchSx("var(--shared-canyon-color)")}
        />
      </div>
      <div className={classes.toggleRow}>
        <span>Canyon Tracks</span>
        <Switch
          size="small"
          checked={showCanyonTracks}
          onChange={(_, v) => setShowCanyonTracks(v)}
          sx={switchSx("var(--theme-accent)")}
        />
      </div>

      <div className={classes.lidarRow}>
        <span>LiDAR Topos</span>
        <Switch
          size="small"
          checked={lidarEnabled}
          onChange={(_, v) => setLidarEnabled(v)}
          sx={switchSx("var(--theme-secondary)")}
        />
      </div>

      {lidarEnabled && (
        <div className={classes.lidarLayers}>
          {lidarLayerOrder.map((name, i) => {
            const layer = TOPO_LAYERS.find((l) => l.name === name);
            const label = layer?.label ?? name;
            return (
              <div
                key={name}
                className={`${classes.layerRow} ${dragOverIndex === i ? classes.layerRowDragOver : ""} ${draggingIndex === i ? classes.layerRowDragging : ""}`}
                draggable
                onDragStart={() => onDragStart(i)}
                onDragOver={(e) => onDragOver(e, i)}
                onDrop={(e) => onDrop(e, i)}
                onDragEnd={onDragEnd}
              >
                <div className={classes.layerRowLeft}>
                  <button
                    type="button"
                    className={classes.dragHandle}
                    aria-label={`Reorder ${label}. Press up or down arrow to move.`}
                    title="Drag, or focus and use ↑/↓ to reorder"
                    onKeyDown={(e) => {
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        moveLayer(i, i - 1);
                      } else if (e.key === "ArrowDown") {
                        e.preventDefault();
                        moveLayer(i, i + 1);
                      }
                    }}
                  >
                    <GripVertical size={12} />
                  </button>
                  <span>{label}</span>
                </div>
                <Switch
                  size="small"
                  checked={lidarLayerToggles[name] ?? true}
                  onChange={(_, v) => handleLayerToggle(name, v)}
                  sx={switchSx("var(--theme-secondary)")}
                />
              </div>
            );
          })}
          <div
            className={`${classes.dragSentinel} ${dragOverIndex === lidarLayerOrder.length ? classes.dragSentinelActive : ""}`}
            onDragOver={(e) => onDragOver(e, lidarLayerOrder.length)}
            onDrop={(e) => onDrop(e, lidarLayerOrder.length)}
          />
        </div>
      )}

      {/* Basemap section */}
      <div className={`${classes.sectionLabel} ${classes.basemapLabel}`}>Basemap</div>

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
    </div>
  );
}

export default LayersPanel;
