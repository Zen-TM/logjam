import { useEffect, useRef, useState } from "react";
import { Switch } from "@mui/material";
import { ChevronRight, GripVertical } from "lucide-react";
import classes from "./OverlaysPanel.module.css";
import { MASTER_TOPO_LAYERS } from "../../../topoLayerTypes";
import type { TopoLayerFormat } from "../../../topoLayerTypes";
import { apiFetch } from "../../../canyonUtils";

type MasterLayer = {
  name: string;
  label: string;
  format: TopoLayerFormat;
  pmtilesUrl: string;
};

type TopoLayerEntry = {
  id: string;
  pmtilesUrl: string;
  format: TopoLayerFormat;
};

function OverlaysPanel({
  showOwnedCanyons,
  setShowOwnedCanyons,
  showSharedCanyons,
  setShowSharedCanyons,
  onTopoLayersChange,
  lidarEnabled,
  setLidarEnabled,
  lidarLayerToggles: layerToggles,
  setLidarLayerToggles: setLayerToggles,
  lidarLayerOrder: layerOrder,
  setLidarLayerOrder: setLayerOrder,
}: {
  showOwnedCanyons: boolean;
  setShowOwnedCanyons: (show: boolean) => void;
  showSharedCanyons: boolean;
  setShowSharedCanyons: (show: boolean) => void;
  onTopoLayersChange: (layers: TopoLayerEntry[]) => void;
  lidarEnabled: boolean;
  setLidarEnabled: (v: boolean) => void;
  lidarLayerToggles: Record<string, boolean>;
  setLidarLayerToggles: (
    v:
      | Record<string, boolean>
      | ((prev: Record<string, boolean>) => Record<string, boolean>),
  ) => void;
  lidarLayerOrder: string[];
  setLidarLayerOrder: (v: string[] | ((prev: string[]) => string[])) => void;
}) {
  // Master layer data fetched from API
  const [masterLayers, setMasterLayers] = useState<MasterLayer[]>([]);

  // Transient UI state — OK to reset on remount
  const [expanded, setExpanded] = useState(false);

  // Track previous layer state to avoid unnecessary callbacks
  const prevLayersJsonRef = useRef<string>("");

  // Drag state
  const dragIndex = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  // Fetch master layer URLs from API
  useEffect(() => {
    apiFetch<MasterLayer[]>("/topo-layers")
      .then(setMasterLayers)
      .catch(() => {
        // API may not have any master files yet — silently ignore
      });
  }, []);

  // Notify parent whenever visible layers or order changes
  const onTopoLayersChangeRef = useRef(onTopoLayersChange);
  useEffect(() => {
    onTopoLayersChangeRef.current = onTopoLayersChange;
  }, [onTopoLayersChange]);

  useEffect(() => {
    if (!lidarEnabled || masterLayers.length === 0) {
      if (prevLayersJsonRef.current !== "[]") {
        prevLayersJsonRef.current = "[]";
        onTopoLayersChangeRef.current([]);
      }
      return;
    }
    const layerMap = new Map(masterLayers.map((l) => [l.name, l]));
    const active: TopoLayerEntry[] = layerOrder
      .filter((name) => layerToggles[name] && layerMap.has(name))
      .map((name) => {
        const l = layerMap.get(name)!;
        return {
          id: `master-${l.name}`,
          pmtilesUrl: l.pmtilesUrl,
          format: l.format,
        };
      });
    const json = JSON.stringify(active);
    if (prevLayersJsonRef.current !== json) {
      prevLayersJsonRef.current = json;
      onTopoLayersChangeRef.current(active);
    }
  }, [lidarEnabled, layerToggles, layerOrder, masterLayers]);

  function handleLidarToggle(checked: boolean) {
    setLidarEnabled(checked);
    if (!checked) setExpanded(false);
    if (checked && !expanded) setExpanded(true);
  }

  function handleSubToggle(name: string, checked: boolean) {
    setLayerToggles((prev) => ({ ...prev, [name]: checked }));
  }

  // Native HTML5 drag-and-drop handlers
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
    setLayerOrder((prev) => {
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

  const switchSx = (color: string) => ({
    "& .MuiSwitch-switchBase.Mui-checked": { color },
    "& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track": {
      backgroundColor: color,
    },
  });

  return (
    <div className={classes.optionsContent}>
      {/* My Canyons */}
      <div className={classes.toggleRow}>
        <span>My Canyons</span>
        <Switch
          size="small"
          checked={showOwnedCanyons}
          onChange={(_, checked) => setShowOwnedCanyons(checked)}
          sx={switchSx("var(--owned-canyon-color)")}
        />
      </div>

      {/* Shared Canyons */}
      <div className={classes.toggleRow}>
        <span>Shared Canyons</span>
        <Switch
          size="small"
          checked={showSharedCanyons}
          onChange={(_, checked) => setShowSharedCanyons(checked)}
          sx={switchSx("var(--shared-canyon-color)")}
        />
      </div>

      {/* LiDAR Topos */}
      <div className={classes.lidarSection}>
        <div className={classes.lidarHeader}>
          <div className={classes.lidarHeaderLeft}>
            {lidarEnabled && (
              <button
                className={`${classes.expandArrow} ${expanded ? classes.expandArrowOpen : ""}`}
                onClick={() => setExpanded((v) => !v)}
                aria-label={
                  expanded ? "Collapse LiDAR layers" : "Expand LiDAR layers"
                }
              >
                <ChevronRight size={14} />
              </button>
            )}
            <span>LiDAR Topos</span>
          </div>
          <Switch
            size="small"
            checked={lidarEnabled}
            onChange={(_, checked) => handleLidarToggle(checked)}
            sx={switchSx("var(--theme-secondary)")}
          />
        </div>

        {lidarEnabled && expanded && (
          <div className={classes.subToggleList}>
            {layerOrder.map((name, i) => {
              const layer =
                masterLayers.find((l) => l.name === name) ??
                MASTER_TOPO_LAYERS.find((l) => l.name === name);
              const label = layer?.label ?? name;
              return (
                <div
                  key={name}
                  className={`${classes.subToggleRow} ${dragOverIndex === i ? classes.subToggleRowDragOver : ""} ${draggingIndex === i ? classes.subToggleRowDragging : ""}`}
                  draggable
                  onDragStart={() => onDragStart(i)}
                  onDragOver={(e) => onDragOver(e, i)}
                  onDrop={(e) => onDrop(e, i)}
                  onDragEnd={onDragEnd}
                >
                  <div className={classes.subToggleLeft}>
                    <span className={classes.dragHandle}>
                      <GripVertical size={12} />
                    </span>
                    <span>{label}</span>
                  </div>
                  <Switch
                    size="small"
                    checked={layerToggles[name] ?? true}
                    onChange={(_, checked) => handleSubToggle(name, checked)}
                    sx={switchSx("var(--theme-secondary)")}
                  />
                </div>
              );
            })}
            <div
              className={`${classes.dragSentinel} ${dragOverIndex === layerOrder.length ? classes.dragSentinelActive : ""}`}
              onDragOver={(e) => onDragOver(e, layerOrder.length)}
              onDrop={(e) => onDrop(e, layerOrder.length)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default OverlaysPanel;
