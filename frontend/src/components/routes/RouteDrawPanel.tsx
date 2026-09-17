// The route tool, as a PAGE rather than a card over the map.
//
// It floated over the map until 2026-09-17, and two things were wrong with
// that. Its container spanned the map's full width to centre itself, so the
// dead strip either side swallowed clicks and anchors could not be dropped
// there; and even fixed, a panel sitting on the canvas is in the way of the one
// gesture the mode exists for (operator).
//
// So drawing happens where a route's numbers already live: the 380px panel,
// which the map is already inset for. Nothing floats, the whole canvas takes
// clicks, and the page can afford to show the line's figures and its elevation
// profile AS IT IS DRAWN — which the card never had room for. On narrow web the
// panel is the bottom sheet, so this is also the bottom bar the operator
// floated, with no second placement to maintain.
//
// It is the same shape as a way's detail page on purpose: the stats, then the
// profile, then the properties. One before the route exists and one after.
import { useEffect, useState } from "react";
import { Redo2, Trash2, Undo2, X } from "lucide-react";
import {
  formatDistanceM,
  routeLengthM,
  trackColorName,
  MAX_ROUTE_POINTS,
  TRACK_COLORS,
} from "@logjam/shared";
import type { SnapMode } from "../map/Map";
import { useElevationProfile } from "../../placeUtils";
import {
  Button,
  Hero,
  IconButton,
  SectionHeader,
  Select,
  StatGrid,
  SwatchPicker,
  type Stat,
} from "../../ui";
import ElevationProfile from "./ElevationProfile";
import classes from "./RouteDrawPanel.module.css";

/** How long the line must sit still before its terrain is read. A profile per
 *  placed vertex would be one request per click; this asks once the user pauses,
 *  which is when they are looking at the figures anyway. */
const PROFILE_SETTLE_MS = 700;

type RouteDrawPanelProps = {
  points: [number, number][];
  /** User-placed vertices — what the hint should count, not the snapped filler. */
  anchorCount: number;
  canUndo: boolean;
  atCap: boolean;
  /** Set when editing an existing route, so the page can say which. */
  editingName: string | null;
  /** The colour the draft will be saved with, drawn on the map as it is built. */
  color: string | null;
  onColorChange: (color: string) => void;
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
  color,
  onColorChange,
  onUndo,
  onClear,
  onSave,
  onCancel,
  saving,
  snapMode,
  onSnapModeChange,
}: RouteDrawPanelProps): React.JSX.Element {
  const canSave = points.length >= 2 && !saving;

  // The line as it was when the user last paused. Profiling the live draft
  // would fire a request per click and re-render the chart mid-gesture.
  const [settled, setSettled] = useState<[number, number][] | null>(null);
  useEffect(() => {
    if (points.length < 2) {
      setSettled(null);
      return;
    }
    const timer = window.setTimeout(() => setSettled(points), PROFILE_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [points]);
  const { profile, loading: profileLoading } = useElevationProfile(settled);

  const stats: Stat[] = [
    {
      label: "Distance",
      value: points.length >= 2 ? formatDistanceM(routeLengthM(points)) : "—",
    },
    { label: "Climb", value: profile ? `↑ ${Math.round(profile.gainM)} m` : "—" },
    { label: "Descent", value: profile ? `↓ ${Math.round(profile.lossM)} m` : "—" },
  ];

  return (
    <div className={classes.root}>
      <Hero
        title={editingName ? `Editing ${editingName}` : "New route"}
        actions={<IconButton icon={X} label="Cancel drawing" onClick={onCancel} disabled={saving} />}
      />

      <div className={classes.body}>
        <p className={classes.hint} role="status">
          {anchorCount === 0
            ? "Click the map to place the first point."
            : anchorCount === 1
              ? "Click again to extend the line."
              : `${anchorCount} point${anchorCount === 1 ? "" : "s"} · drag to move, click to remove, drag the line to add`}
        </p>

        <StatGrid stats={stats} />

        {atCap && (
          <p className={classes.warning} role="status">
            Maximum of {MAX_ROUTE_POINTS} points reached.
          </p>
        )}

        {/* The terrain under the line, while it is still being decided — the
            reason a canyoner re-routes a leg before saving it rather than
            after. Absent until there is a line to read. */}
        {points.length >= 2 && (
          <section className={classes.section}>
            {profile ? (
              <>
                {profile.minM != null && profile.maxM != null && (
                  <p className={classes.band}>
                    {Math.round(profile.minM)}–{Math.round(profile.maxM)} m above sea level
                  </p>
                )}
                <SectionHeader title="Elevation vs distance" />
                <ElevationProfile
                  samples={profile.samples}
                  minM={profile.minM}
                  maxM={profile.maxM}
                  color={color ?? "currentColor"}
                />
                <p className={classes.attribution}>{profile.attribution}</p>
              </>
            ) : (
              <p className={classes.note}>
                {profileLoading ? "Reading the terrain…" : "Pause to read the terrain under this line."}
              </p>
            )}
          </section>
        )}

        <section className={classes.section}>
          {/* A tool's own settings belong with the tool, not in Layers: this one
              changes what the NEXT click does (mobile §2). */}
          <Select
            label="Snap to"
            value={snapMode}
            disabled={saving}
            onChange={(event) => onSnapModeChange(event.target.value as SnapMode)}
          >
            <option value="off">Nothing (straight lines)</option>
            <option value="trails">Trails</option>
            <option value="waterways">Creeks &amp; rivers</option>
            <option value="both">Trails, creeks &amp; rivers</option>
          </Select>
        </section>

        <section className={classes.section}>
          {/* Chosen while drawing rather than in the save dialog: the line is on
              the map in this colour as it is built, so it is a property of the
              draft, not a question asked at the end. */}
          <SwatchPicker
            label="Colour on the map"
            colors={TRACK_COLORS}
            value={color ?? undefined}
            nameOf={trackColorName}
            disabled={saving}
            onChange={onColorChange}
          />
        </section>
      </div>

      <footer className={classes.actions}>
        <IconButton icon={Undo2} label="Undo" onClick={onUndo} disabled={!canUndo || saving} />
        <IconButton
          icon={Trash2}
          label="Clear all points"
          onClick={onClear}
          disabled={points.length === 0 || saving}
        />
        <span className={classes.spacer} />
        <Button compact onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button compact variant="filled" icon={Redo2} onClick={onSave} disabled={!canSave} busy={saving}>
          Save
        </Button>
      </footer>
    </div>
  );
}
