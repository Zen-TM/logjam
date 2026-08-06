import { useRef, useState } from "react";
import { Switch } from "@mui/material";
import { GripVertical, Info, Pencil } from "lucide-react";
import classes from "./LayersPanel.module.css";
import { previewUrlFor } from "./tilePreview";
import type { TileLayer } from "./tilePreview";
import { TOPO_LAYERS } from "../../../topoLayerTypes";

type BaseLayer = TileLayer & { id: string; name: string };

/** `previewUrlFor` needs an XYZ template; vector entries carry none. */
function thumbnailFor(
  layer: BaseLayer,
  mapView: { lng: number; lat: number; zoom: number } | null,
): string | null {
  if (!mapView || layer.tiles.length === 0) return null;
  return previewUrlFor(layer, mapView);
}

// Layer-row descriptors (display only; keyed by TOPO_LAYERS name). Rendered as a
// native-title info tooltip. Only vegetation needs one today — its orange
// crosshatch (fire more recent than the LiDAR survey) is the least-intuitive
// symbol and carries no other label.
const LAYER_DESCRIPTIONS: Partial<Record<string, string>> = {
  vegetation:
    "Estimated vegetation density for bushbashing — denser scrub renders darker. " +
    "Orange crosshatching marks areas burnt by fire more recently than the LiDAR survey, " +
    "so the density estimate there may be out of date.",
};

function LayersPanel({
  // Overlays
  showOwnedCanyons,
  setShowOwnedCanyons,
  showSharedCanyons,
  setShowSharedCanyons,
  showCanyonTracks,
  setShowCanyonTracks,
  showRoutes,
  setShowRoutes,
  onStartDrawingRoute,
  lidarEnabled,
  setLidarEnabled,
  lidarLayerToggles,
  setLidarLayerToggles,
  lidarLayerOrder,
  setLidarLayerOrder,
  unavailableTopoLayerNames,
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
  showRoutes: boolean;
  setShowRoutes: (v: boolean) => void;
  onStartDrawingRoute: () => void;
  lidarEnabled: boolean;
  setLidarEnabled: (v: boolean) => void;
  lidarLayerToggles: Record<string, boolean>;
  setLidarLayerToggles: (
    v: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>),
  ) => void;
  lidarLayerOrder: string[];
  setLidarLayerOrder: (v: string[] | ((prev: string[]) => string[])) => void;
  // Layer names with at least one topo job whose PMTiles source failed to
  // load this session (files missing from storage) — badged below (LAYERS-1).
  unavailableTopoLayerNames: Set<string>;
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

      <div className={classes.toggleRow}>
        <span>Routes</span>
        <Switch
          size="small"
          checked={showRoutes}
          onChange={(_, v) => setShowRoutes(v)}
          sx={switchSx("var(--theme-accent)")}
        />
      </div>

      <button
        type="button"
        className={classes.drawRouteBtn}
        onClick={onStartDrawingRoute}
      >
        <Pencil size={14} /> Draw a route
      </button>

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
                  {LAYER_DESCRIPTIONS[name] && (
                    <span
                      className={classes.layerInfo}
                      title={LAYER_DESCRIPTIONS[name]}
                      aria-label={LAYER_DESCRIPTIONS[name]}
                    >
                      <Info size={12} />
                    </span>
                  )}
                  {unavailableTopoLayerNames.has(name) && (
                    <span
                      className={classes.layerUnavailableBadge}
                      title="This layer's map files couldn't be loaded for one or more topo jobs (files missing). It may not display. Re-run the topo job to regenerate them."
                    >
                      unavailable
                    </span>
                  )}
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
          const thumbUrl = thumbnailFor(layer, mapView);
          return (
            <button
              key={layer.id}
              className={`${classes.tile} ${isActive ? classes.tileSelected : ""}`}
              onClick={() => onActiveLayerChange(layer.id)}
              aria-pressed={isActive}
            >
              {/* Vector basemaps have no XYZ template to thumbnail from, so
                  they show a captioned placeholder rather than a broken
                  image. */}
              {thumbUrl ? (
                <img
                  src={thumbUrl}
                  alt={layer.name}
                  className={classes.tileImage}
                  draggable={false}
                />
              ) : (
                <div className={classes.tilePlaceholder} aria-hidden="true" />
              )}
              <div className={classes.tileCaption}>{layer.name}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default LayersPanel;
