// HUD for the route draw/edit tool. Floats over the map (the map owns
// placement) and reports the running distance so the user can judge the line
// as they place it.
//
// Snapping is a per-session choice, offered here rather than in Layers because
// it changes what the NEXT click does — it belongs with the tool it modifies.
import { formatDistanceM, routeLengthM, MAX_ROUTE_POINTS } from "@logjam/shared";
import type { SnapMode } from "../map/Map";
import classes from "./RouteDrawPanel.module.css";
import shared from "../../styles/shared.module.css";

type RouteDrawPanelProps = {
  points: [number, number][];
  /** User-placed vertices — what the hint should count, not the snapped filler. */
  anchorCount: number;
  canUndo: boolean;
  atCap: boolean;
  /** Set when editing an existing route, so the panel can say which. */
  editingName: string | null;
  onUndo: () => void;
  onClear: () => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  snapMode: SnapMode;
  onSnapModeChange: (mode: SnapMode) => void;
};

export function RouteDrawPanel({
  points,
  anchorCount,
  canUndo,
  atCap,
  editingName,
  onUndo,
  onClear,
  onSave,
  onCancel,
  saving,
  snapMode,
  onSnapModeChange,
}: RouteDrawPanelProps): React.JSX.Element {
  const canSave = points.length >= 2 && !saving;

  return (
    <div className={classes.panel} role="region" aria-label="Route drawing">
      <div className={classes.header}>
        <span className={classes.title}>
          {editingName ? `Editing "${editingName}"` : "New route"}
        </span>
        <span className={classes.distance}>
          {points.length >= 2 ? formatDistanceM(routeLengthM(points)) : "—"}
        </span>
      </div>

      <p className={classes.hint}>
        {anchorCount === 0
          ? "Click the map to place the first point."
          : anchorCount === 1
            ? "Click again to extend the line."
            : `${anchorCount} point${anchorCount === 1 ? "" : "s"} · drag to move, click to remove, drag the line to add`}
      </p>

      <label className={classes.snapRow}>
        <span>Snap to</span>
        <select
          className={classes.snapSelect}
          value={snapMode}
          onChange={(e) => onSnapModeChange(e.target.value as SnapMode)}
          disabled={saving}
        >
          <option value="off">Nothing (straight lines)</option>
          <option value="trails">Trails</option>
          <option value="waterways">Creeks &amp; rivers</option>
          <option value="both">Trails, creeks &amp; rivers</option>
        </select>
      </label>

      {atCap && (
        <p className={classes.warning}>
          Maximum of {MAX_ROUTE_POINTS} points reached.
        </p>
      )}

      <div className={classes.actions}>
        <button
          type="button"
          className={`${shared.btn} ${shared.btnGhost} ${shared.btnSm}`}
          onClick={onUndo}
          disabled={!canUndo || saving}
        >
          Undo
        </button>
        <button
          type="button"
          className={`${shared.btn} ${shared.btnGhost} ${shared.btnSm}`}
          onClick={onClear}
          disabled={points.length === 0 || saving}
        >
          Clear
        </button>
        <button
          type="button"
          className={`${shared.btn} ${shared.btnGhost} ${shared.btnSm}`}
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="button"
          className={`${shared.btn} ${shared.btnFilledAccent} ${shared.btnSm}`}
          onClick={onSave}
          disabled={!canSave}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
