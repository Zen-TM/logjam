import { useState } from "react";
import classes from "./ForgePanel.module.css";
import type { RefreshResult } from "../../../canyonUtils";
import { refreshFromRopeWiki } from "../../../canyonUtils";

function ForgePanel({
  onAddCanyon,
  onOpenCanyonCsvImport,
  onOpenTopo,
  onOpenGeoPdf,
  onOpenGeoPdfTemplates,
  onStartAreaSelection,
  selectingArea,
  onCancelAreaSelection,
  onRefetch,
}: {
  onAddCanyon: () => void;
  onOpenCanyonCsvImport: () => void;
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
      {/* Canyon Data */}
      <div className={classes.forgeSection}>
        <span className={classes.forgeSectionLabel}>Canyon Data</span>
        <button className={classes.addButton} onClick={onAddCanyon}>
          + Add Canyon
        </button>
        <button
          className={classes.refreshButton}
          onClick={onOpenCanyonCsvImport}
        >
          Import Canyons from CSV
        </button>
        <button
          className={classes.refreshButton}
          onClick={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing..." : "Refresh from RopeWiki"}
        </button>
        {refreshResult && (
          <span className={classes.refreshResult}>
            {refreshResult.added} added, {refreshResult.updated} updated,{" "}
            {refreshResult.unchanged} unchanged
            {refreshResult.userEdited > 0 &&
              `, ${refreshResult.userEdited} kept (edited)`}
          </span>
        )}
      </div>

      {/* Map Tools */}
      <div className={classes.forgeSection}>
        <span className={classes.forgeSectionLabel}>Map Tools</span>
        <button className={classes.addButton} onClick={onOpenTopo}>
          Generate LiDAR Topo
        </button>
        <button
          className={classes.refreshButton}
          onClick={selectingArea ? onCancelAreaSelection : onStartAreaSelection}
        >
          {selectingArea ? "Cancel Selection" : "Select Canyons"}
        </button>
      </div>

      {/* Export */}
      <div className={classes.forgeSection}>
        <span className={classes.forgeSectionLabel}>Export</span>
        <button className={classes.addButton} onClick={onOpenGeoPdf}>
          Download Area as GeoPDF
        </button>
        <button
          className={classes.refreshButton}
          onClick={onOpenGeoPdfTemplates}
        >
          GeoPDF Templates
        </button>
      </div>
    </div>
  );
}

export default ForgePanel;
