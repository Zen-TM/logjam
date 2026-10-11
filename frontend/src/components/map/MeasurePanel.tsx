import {
  MAP_MEASURE,
  MAP_MEASURE_START_NOTE,
  MAX_ROUTE_POINTS,
  mapMeasureFacts,
  mapMeasurePointsLabel,
  mapMeasureRange,
  mapMeasureVerbs,
  pairedStatLayout,
  type MapMeasureVerbId,
  type SnapMode,
} from "@logjam/shared";
import { useElevationProfile } from "../../placeUtils";
import { Button, FieldError, Hero, IconButton, StatGrid } from "../../ui";
import { SnapSelect, useSettledLine, useUndoKey } from "./draftTool";
// The route tool's page, minus what only a kept line has: one layout for both.
import classes from "../routes/RouteDrawPanel.module.css";

/**
 * The measure tool, as a page in the panel (DESIGN.md §2): the same shape as
 * the route tool, drawn from `MAP_MEASURE` so it says what Logjam GPS's says.
 *
 * Nothing is saved, so there is no Save, no Cancel and no confirm: the hero's ×
 * leaves, and Clear empties the points at once.
 */
export function MeasurePanel({
  points,
  anchorCount,
  canUndo,
  atCap,
  onUndo,
  onClear,
  onClose,
  snapMode,
  onSnapModeChange,
}: {
  points: [number, number][];
  /** User-placed vertices: what the count reports, never snapped filler. */
  anchorCount: number;
  canUndo: boolean;
  atCap: boolean;
  onUndo: () => void;
  onClear: () => void;
  onClose: () => void;
  snapMode: SnapMode;
  onSnapModeChange: (mode: SnapMode) => void;
}): React.JSX.Element {
  const hasLine = points.length >= 2;
  const { profile, loading } = useElevationProfile(useSettledLine(points));
  useUndoKey(onUndo);

  const terrain = hasLine ? profile : null;
  const range = mapMeasureRange(terrain);
  const copy = MAP_MEASURE.copy;

  const verbs: Record<
    MapMeasureVerbId,
    { run: () => void; disabled: boolean }
  > = {
    undo: { run: onUndo, disabled: !canUndo },
    clear: { run: onClear, disabled: points.length === 0 },
    // Logjam GPS's way out; here it is the hero's ×.
    leave: { run: onClose, disabled: false },
  };

  return (
    <div className={classes.root}>
      <Hero title={MAP_MEASURE.title} onClose={onClose} />

      <div className={classes.body}>
        <p className={classes.hint} role="status">
          {anchorCount === 0
            ? MAP_MEASURE_START_NOTE.web
            : mapMeasurePointsLabel(anchorCount)}
        </p>

        <StatGrid
          stats={pairedStatLayout(mapMeasureFacts({ points, terrain }))}
        />

        {range && <p className={classes.band}>{range} above sea level</p>}
        {hasLine && !profile && loading && (
          <p className={classes.note}>{copy.readingTerrain}</p>
        )}

        {atCap && (
          <FieldError
            message={`Maximum of ${MAX_ROUTE_POINTS} points reached.`}
          />
        )}
      </div>

      <footer className={classes.actions}>
        <SnapSelect
          label={copy.snap}
          value={snapMode}
          onChange={onSnapModeChange}
        />
        <div className={classes.buttons}>
          {mapMeasureVerbs("web").map((verb) =>
            verb.id === "clear" ? (
              <Button
                key={verb.id}
                compact
                onClick={verbs[verb.id].run}
                disabled={verbs[verb.id].disabled}
                disabledReason="No points to clear"
              >
                {verb.label}
              </Button>
            ) : (
              <IconButton
                key={verb.id}
                icon={verb.icon}
                label={verb.label}
                onClick={verbs[verb.id].run}
                disabled={verbs[verb.id].disabled}
              />
            ),
          )}
        </div>
      </footer>
    </div>
  );
}
