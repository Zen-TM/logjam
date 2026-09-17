// The route tool's HUD: the mode the map is in, what it has collected, and the
// controls that end it.
//
// A map TOOL is a mode with a HUD (mobile §2), so this floats over the map in
// the chrome's own slot rather than being a panel of its own — it is armed from
// the Tools tray, it reports the running distance so the user can judge the
// line as they place it, and leaving it discards the draft.
//
// It sits in `MapChrome`'s `hud` slot and NOT in the notice stack beside it:
// that stack is `aria-live="polite"`, which is right for "Showing 42 of 298
// places" and wrong for a panel holding a select and four buttons — every
// keystroke and every placed point would be announced.
//
// Snapping is a per-session choice offered here rather than in Layers because
// it changes what the NEXT click does: it belongs to the tool it modifies, not
// to the map (mobile §2, "a tool's own settings belong in its HUD").
import { formatDistanceM, routeLengthM, MAX_ROUTE_POINTS } from "@logjam/shared";
import type { SnapMode } from "../map/Map";
import { Button, Select } from "../../ui";
import classes from "./RouteDrawPanel.module.css";

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
        {/* The running total, announced as it changes: it is the one figure
            the user is watching while they click. */}
        <span className={classes.distance} aria-live="polite">
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

      <Select
        label="Snap to"
        className={classes.snap}
        value={snapMode}
        disabled={saving}
        onChange={(event) => onSnapModeChange(event.target.value as SnapMode)}
      >
        <option value="off">Nothing (straight lines)</option>
        <option value="trails">Trails</option>
        <option value="waterways">Creeks &amp; rivers</option>
        <option value="both">Trails, creeks &amp; rivers</option>
      </Select>

      {atCap && (
        <p className={classes.warning} role="status">
          Maximum of {MAX_ROUTE_POINTS} points reached.
        </p>
      )}

      <div className={classes.actions}>
        <Button compact onClick={onUndo} disabled={!canUndo || saving}>
          Undo
        </Button>
        <Button compact onClick={onClear} disabled={points.length === 0 || saving}>
          Clear
        </Button>
        <Button compact onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button compact variant="filled" onClick={onSave} disabled={!canSave} busy={saving}>
          Save
        </Button>
      </div>
    </div>
  );
}
