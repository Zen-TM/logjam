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
// It is the same shape as a way's detail page on purpose: the controls, then
// the stats, then the profile. One before the route exists and one after.
// CONTROLS COME FIRST because they change what the next click does, while the
// stats describe what the last one produced — a control below the readout it
// governs reads as a footnote to it (operator, 2026-09-17).
import { useEffect, useMemo, useState } from "react";
import {
  densifyLine,
  formatDistanceM,
  routeLengthM,
  trackColorName,
  MAX_ROUTE_POINTS,
  TRACK_COLORS,
  PAIRED_STAT_LABELS,
  pairedStatLayout,
} from "@logjam/shared";
import type { SnapMode } from "../map/Map";
import { SnapSelect, useSettledLine, useUndoKey } from "../map/draftTool";
import { useElevationProfile } from "../../placeUtils";
import {
  Button,
  Hero,
  IconButton,
  SectionHeader,
  StatGrid,
  ColourField,
  FieldError,
  type Stat,
} from "../../ui";
import ElevationProfile from "./ElevationProfile";
import type { RouteHoverChannel } from "../map/routeHover";
import classes from "./RouteDrawPanel.module.css";

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
  /** Flip which way the line runs. A BUTTON, not a menu item: it changes the
   *  geometry on screen, so it belongs beside the other edits to it rather than
   *  behind a menu on a page you have left (operator, 2026-09-17). */
  onReverse: () => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  snapMode: SnapMode;
  onSnapModeChange: (mode: SnapMode) => void;
  /** Where along the draft the elevation cursor sits, so the map marks it —
   *  the same gesture a saved route's page offers, which stopped working the
   *  moment the tool became a page of its own (operator, 2026-09-17). A
   *  channel rather than a callback into App state, because it changes many
   *  times a second (`map/routeHover.ts`). */
  routeHover: RouteHoverChannel;
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
  onReverse,
  onSave,
  onCancel,
  saving,
  snapMode,
  onSnapModeChange,
  routeHover,
}: RouteDrawPanelProps): React.JSX.Element {
  const hasLine = points.length >= 2;
  // The point count when Save was pressed on a line too short to keep: the
  // message stays for that count and goes with the next point or undo.
  const [shortAt, setShortAt] = useState<number | null>(null);

  // The line as it was when the user last paused (`useSettledLine`).
  const settled = useSettledLine(points);
  const { profile, loading: profileLoading } = useElevationProfile(settled);

  // Ctrl+Z / Cmd+Z, because this is a drawing tool and that is what the gesture
  // means everywhere else (operator, 2026-09-17).
  useUndoKey(onUndo);

  // The SAME densification the server profiled, so a sample index maps straight
  // back to a coordinate on the line.
  const samplePositions = useMemo(
    () => (settled ? densifyLine(settled) : []),
    [settled],
  );
  // Leaving mid-hover would otherwise strand the marker on the map.
  useEffect(() => () => routeHover.set(null), [routeHover]);

  const stats: Stat[] = [
    {
      label: "Distance",
      value: hasLine ? formatDistanceM(routeLengthM(points)) : "—",
      // The headline figure while drawing, with the pair beneath it.
      span: true,
    },
    {
      label: PAIRED_STAT_LABELS.ascent,
      value: profile ? `↑ ${Math.round(profile.gainM)} m` : "—",
    },
    {
      label: PAIRED_STAT_LABELS.descent,
      value: profile ? `↓ ${Math.round(profile.lossM)} m` : "—",
    },
  ];

  return (
    <div className={classes.root}>
      <Hero
        title={editingName ? `Editing ${editingName}` : "New route"}
        onClose={onCancel}
        closeDisabled={saving}
      />

      <div className={classes.body}>
        {/* The one instruction worth a line, and only while there is nothing
            else to say. At zero points every figure is an em-dash anyway, and
            this is exactly when someone needs telling what the map is for; it
            goes the moment the first point lands, so nothing below it ever
            moves again (operator, 2026-09-17). */}
        {anchorCount === 0 && (
          <p className={classes.hint} role="status">
            Click the map to place the first point.
          </p>
        )}

        {/* FROM HERE DOWN THIS IS THE SAME PAGE A SAVED WAY SHOWS: figures,
            then the terrain, then the colour. Editing PUSHES that content down
            rather than rearranging it, so entering and leaving the tool does
            not reshuffle the panel under the reader. The controls that change
            what the next click does are in the footer, with Undo and Clear —
            which is also why they no longer need to sit above the figures they
            do not describe. */}
        <StatGrid stats={pairedStatLayout(stats)} />

        {atCap && (
          <FieldError
            message={`Maximum of ${MAX_ROUTE_POINTS} points reached.`}
          />
        )}
        <FieldError
          message={
            shortAt === points.length
              ? "A route needs at least two points."
              : null
          }
        />

        {/* The terrain under the line, while it is still being decided — the
            reason a canyoner re-routes a leg before saving it rather than
            after. Absent until there is a line to read. */}
        {hasLine && (
          <section className={classes.section}>
            {profile ? (
              <>
                {profile.minM != null && profile.maxM != null && (
                  <p className={classes.band}>
                    {Math.round(profile.minM)}–{Math.round(profile.maxM)} m
                    above sea level
                  </p>
                )}
                <SectionHeader title="Elevation vs distance" />
                <ElevationProfile
                  samples={profile.samples}
                  minM={profile.minM}
                  maxM={profile.maxM}
                  color={color ?? "currentColor"}
                  onHoverSampleChange={(index) => {
                    const position =
                      index == null ? null : samplePositions[index];
                    routeHover.set(
                      position
                        ? { position: [position.lon, position.lat], color }
                        : null,
                    );
                  }}
                />
                <p className={classes.attribution}>{profile.attribution}</p>
              </>
            ) : (
              <p className={classes.note}>
                {profileLoading
                  ? "Reading the terrain…"
                  : "Pause to read the terrain under this line."}
              </p>
            )}
          </section>
        )}

        <section className={classes.section}>
          {/* Last, exactly where a saved way's page puts it. Chosen while
              drawing rather than in the save dialog: the line is on the map in
              this colour as it is built, so it is a property of the draft, not
              a question asked at the end. */}
          <ColourField
            label="Colour"
            palette={TRACK_COLORS}
            value={color ?? undefined}
            nameOf={trackColorName}
            disabled={saving}
            onChange={onColorChange}
          />
        </section>
      </div>

      <footer className={classes.actions}>
        {/* A tool's own settings belong with the tool rather than in Layers,
            because this one changes what the NEXT click does (mobile §2) — and
            in the FOOTER, with the other controls that change the next click,
            rather than above figures it says nothing about. The footer is one
            row taller for it, and the body above is then the same page a saved
            way shows (operator, 2026-09-17). */}
        <SnapSelect
          label="Snap to"
          value={snapMode}
          disabled={saving}
          onChange={onSnapModeChange}
        />

        <div className={classes.buttons}>
          <IconButton
            icon="undo"
            label="Undo"
            onClick={onUndo}
            disabled={!canUndo || saving}
            disabledReason={saving ? "Saving…" : "Nothing to undo"}
          />
          <IconButton
            icon="reverse"
            label="Reverse direction"
            onClick={onReverse}
            disabled={!hasLine || saving}
            disabledReason={saving ? "Saving…" : "Needs two points"}
          />
          <IconButton
            icon="delete"
            label="Clear all points"
            onClick={onClear}
            disabled={points.length === 0 || saving}
            disabledReason={saving ? "Saving…" : "Nothing to clear"}
          />
          <span className={classes.spacer} />
          <Button
            compact
            onClick={onCancel}
            disabled={saving}
            disabledReason="Saving…"
          >
            Cancel
          </Button>
          <Button
            compact
            variant="filled"
            icon="done"
            onClick={() => (hasLine ? onSave() : setShortAt(points.length))}
            busy={saving}
          >
            Save
          </Button>
        </div>
      </footer>
    </div>
  );
}
