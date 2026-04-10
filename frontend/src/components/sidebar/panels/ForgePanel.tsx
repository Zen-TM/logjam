import { useState } from "react";
import { Typography } from "@mui/material";
import classes from "../Sidebar.module.css";
import type { RefreshResult } from "../../../canyonUtils";
import { refreshFromRopeWiki } from "../../../canyonUtils";

function ForgePanel({
  onAddCanyon,
  onOpenTopo,
  onOpenGeoPdf,
  onOpenGeoPdfTemplates,
  onStartAreaSelection,
  selectingArea,
  onCancelAreaSelection,
  onRefetch,
}: {
  onAddCanyon: () => void;
  onOpenTopo: () => void;
  onOpenGeoPdf: () => void;
  onOpenGeoPdfTemplates: () => void;
  onStartAreaSelection: () => void;
  selectingArea: boolean;
  onCancelAreaSelection: () => void;
  onRefetch: () => void;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<RefreshResult | null>(
    null,
  );

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshResult(null);
    try {
      const result = await refreshFromRopeWiki();
      setRefreshResult(result);
      onRefetch();
    } catch {
      setRefreshResult(null);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className={classes.optionsContent}>
      <button className={classes.addButton} onClick={onAddCanyon}>
        + Add Canyon
      </button>

      <button
        className={classes.refreshButton}
        onClick={selectingArea ? onCancelAreaSelection : onStartAreaSelection}
      >
        {selectingArea ? "Cancel Selection" : "Select Area"}
      </button>

      <button className={classes.refreshButton} onClick={onOpenTopo}>
        Generate Topo Map
      </button>

      <button className={classes.refreshButton} onClick={onOpenGeoPdf}>
        Download Area as GeoPDF
      </button>

      <button className={classes.refreshButton} onClick={onOpenGeoPdfTemplates}>
        GeoPDF Templates
      </button>

      <button
        className={classes.refreshButton}
        onClick={handleRefresh}
        disabled={refreshing}
      >
        {refreshing ? "Refreshing..." : "Refresh from RopeWiki"}
      </button>
      {refreshResult && (
        <Typography
          variant="caption"
          sx={{ color: "var(--theme-text-primary)", opacity: 0.7 }}
        >
          {refreshResult.added} added, {refreshResult.updated} updated,{" "}
          {refreshResult.unchanged} unchanged
          {refreshResult.userEdited > 0 &&
            `, ${refreshResult.userEdited} kept (edited)`}
        </Typography>
      )}
    </div>
  );
}

export default ForgePanel;
