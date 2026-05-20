import { useState } from "react";
import classes from "./ForgePanel.module.css";
import type { RefreshResult } from "../../../canyonUtils";
import { refreshFromRopeWiki } from "../../../canyonUtils";
import RopeWikiReviewDialog from "../../dialogs/RopeWikiReviewDialog";

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
  const [reviewOpen, setReviewOpen] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshResult(null);
    try {
      const result = await refreshFromRopeWiki();
      setRefreshResult(result);
      onRefetch();
      if (result.review.length > 0) setReviewOpen(true);
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
            {refreshResult.added} added
            {refreshResult.autoLinked > 0 &&
              `, ${refreshResult.autoLinked} linked`}
            , {refreshResult.updated} updated, {refreshResult.unchanged}{" "}
            unchanged
            {refreshResult.userEdited > 0 &&
              `, ${refreshResult.userEdited} kept (edited)`}
            {refreshResult.review.length > 0 &&
              `, ${refreshResult.review.length} need review`}
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

      {refreshResult && (
        <RopeWikiReviewDialog
          open={reviewOpen}
          review={refreshResult.review}
          onClose={() => setReviewOpen(false)}
          onApplied={() => {
            setRefreshResult({ ...refreshResult, review: [] });
            onRefetch();
          }}
        />
      )}
    </div>
  );
}

export default ForgePanel;
