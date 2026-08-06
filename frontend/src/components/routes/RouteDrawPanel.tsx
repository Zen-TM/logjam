// HUD for the route draw/edit tool. Floats over the map (the map owns
// placement) and reports the running distance so the user can judge the line
// as they place it.
//
// No elevation readout: gain/loss would need a DEM, and the contour-derived
// figure the measure tool used only worked inside a generated topo footprint.
// Distance needs no data and is always correct.
import { formatDistanceM, routeLengthM, MAX_ROUTE_POINTS } from "@logjam/shared";
import classes from "./RouteDrawPanel.module.css";
import shared from "../../styles/shared.module.css";

type RouteDrawPanelProps = {
  points: [number, number][];
  /** Set when editing an existing route, so the panel can say which. */
  editingName: string | null;
  onUndo: () => void;
  onClear: () => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
};

export function RouteDrawPanel({
  points,
  editingName,
  onUndo,
  onClear,
  onSave,
  onCancel,
  saving,
}: RouteDrawPanelProps): React.JSX.Element {
  const canSave = points.length >= 2 && !saving;
  const atCap = points.length >= MAX_ROUTE_POINTS;

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
        {points.length === 0
          ? "Click the map to place the first point."
          : points.length === 1
            ? "Click again to extend the line. Drag a point to move it."
            : `${points.length} points · drag to adjust`}
      </p>

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
          disabled={points.length === 0 || saving}
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
