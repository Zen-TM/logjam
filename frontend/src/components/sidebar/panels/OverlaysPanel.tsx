import { useState, useRef } from "react";
import { Switch } from "@mui/material";
import { ChevronRight, GripVertical } from "lucide-react";
import classes from "./OverlaysPanel.module.css";
import { TOPO_LAYERS } from "../../../topoLayerTypes";
import type { CompletedTopoJob } from "../../../topoLayerTypes";

function formatDate(iso: string): string {
  const d = new Date(iso);
  // e.g. "10 May 2026"
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function OverlaysPanel({
  showOwnedCanyons,
  setShowOwnedCanyons,
  showSharedCanyons,
  setShowSharedCanyons,
  lidarEnabled,
  setLidarEnabled,
  lidarLayerToggles: layerToggles,
  setLidarLayerToggles: setLayerToggles,
  lidarLayerOrder: layerOrder,
  setLidarLayerOrder: setLayerOrder,
  completedTopoJobs,
  lidarJobToggles,
  setLidarJobToggles,
}: {
  showOwnedCanyons: boolean;
  setShowOwnedCanyons: (show: boolean) => void;
  showSharedCanyons: boolean;
  setShowSharedCanyons: (show: boolean) => void;
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
  completedTopoJobs: CompletedTopoJob[];
  lidarJobToggles: Record<string, boolean>;
  setLidarJobToggles: (
    v:
      | Record<string, boolean>
      | ((prev: Record<string, boolean>) => Record<string, boolean>),
  ) => void;
}) {
  // Each child section's expanded state is independent.
  const [layersExpanded, setLayersExpanded] = useState(false);
  const [areasExpanded, setAreasExpanded] = useState(false);

  // Drag state for layer-order reordering
  const dragIndex = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  function handleSubToggle(name: string, checked: boolean) {
    setLayerToggles((prev) => ({ ...prev, [name]: checked }));
  }

  function handleJobToggle(jobId: string, checked: boolean) {
    setLidarJobToggles((prev) => ({ ...prev, [jobId]: checked }));
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

      {/* LiDAR Topos — parent is no longer expandable */}
      <div className={classes.lidarSection}>
        <div className={classes.lidarHeader}>
          <span>LiDAR Topos</span>
          <Switch
            size="small"
            checked={lidarEnabled}
            onChange={(_, checked) => setLidarEnabled(checked)}
            sx={switchSx("var(--theme-secondary)")}
          />
        </div>

        {lidarEnabled && (
          <>
            {/* Layers section */}
            <div className={classes.nestedSection}>
              <button
                type="button"
                className={classes.nestedHeader}
                onClick={() => setLayersExpanded((v) => !v)}
                aria-expanded={layersExpanded}
              >
                <span
                  className={`${classes.expandArrow} ${layersExpanded ? classes.expandArrowOpen : ""}`}
                >
                  <ChevronRight size={14} />
                </span>
                <span className={classes.nestedHeaderLabel}>Layers</span>
              </button>

              {layersExpanded && (
                <div className={classes.subToggleList}>
                  {layerOrder.map((name, i) => {
                    const layer = TOPO_LAYERS.find((l) => l.name === name);
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

            {/* Areas section */}
            <div className={classes.nestedSection}>
              <button
                type="button"
                className={classes.nestedHeader}
                onClick={() => setAreasExpanded((v) => !v)}
                aria-expanded={areasExpanded}
              >
                <span
                  className={`${classes.expandArrow} ${areasExpanded ? classes.expandArrowOpen : ""}`}
                >
                  <ChevronRight size={14} />
                </span>
                <span className={classes.nestedHeaderLabel}>Areas</span>
              </button>

              {areasExpanded && (
                <div className={classes.subToggleList}>
                  {completedTopoJobs.length === 0 && (
                    <span className={classes.emptyHint}>
                      No completed topos yet.
                    </span>
                  )}
                  {completedTopoJobs.map((job) => {
                    const dateStr = formatDate(job.createdAt);
                    const primary = job.name ?? dateStr;
                    const showSubtitle = Boolean(job.name);
                    return (
                      <div key={job.jobId} className={classes.areaRow}>
                        <div className={classes.areaRowLeft}>
                          <span className={classes.areaPrimary}>{primary}</span>
                          {showSubtitle && (
                            <span className={classes.areaSubtitle}>{dateStr}</span>
                          )}
                        </div>
                        <Switch
                          size="small"
                          checked={lidarJobToggles[job.jobId] ?? true}
                          onChange={(_, checked) => handleJobToggle(job.jobId, checked)}
                          sx={switchSx("var(--theme-secondary)")}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default OverlaysPanel;
