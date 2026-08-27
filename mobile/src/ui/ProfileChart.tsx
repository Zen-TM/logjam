// A profile chart with a scrubber: some value against distance along a line.
//
// Elevation is what it was built for and still the main reader (a drawn
// route's height profile), but a recorded track's SPEED is the same picture of
// a different quantity, so the component takes a plain series plus a
// formatter rather than an ElevationProfile. `elevationSeries` and
// `speedSeries` below are the two adapters; anything else with a value per
// metre travelled can add a third.
//
// Still built from plain Views rather than SVG: react-native-svg is a NATIVE
// module, so adding it means a new dev-client build and a reinstall on every
// test device — a heavy price for a chart this small. Contiguous columns under
// a gradient read as an area chart at this size, which is what the web draws.
//
// The scrubber is the part that makes it useful rather than decorative: drag
// across and the readout follows your finger, which is how the web profile
// behaves and the only way to answer "how high is it at the 3 km mark".
//
// Columns are scaled between the profile's own min and max, not from sea
// level: a canyon between 700 and 840 m drawn from zero is a flat bar.
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  PanResponder,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { fontSize, fontWeight, radius, spacing, theme, withAlpha } from "../theme";
import { SheetScrollLock } from "./BottomSheet";
import type { ProfilePoint, ProfileSeries } from "./profileSeries";

/**
 * Columns drawn: one per POINT of chart width, capped.
 *
 * 64 chunky columns read as a bar chart, which is what "still blocky" meant.
 * At one column per point the steps are a pixel or two wide and the silhouette
 * reads as a curve — the same trick a canvas area chart uses, just with the
 * rasterisation done by the layout engine.
 *
 * ponytail: ~360 Views for a chart. Measured fine on a sheet that is not
 * animating; the upgrade path if it ever bites is react-native-svg, which costs
 * a native rebuild.
 */
const MAX_COLUMNS = 400;

/**
 * How much more horizontal than vertical a drag must be before the chart reads
 * it as a scrub rather than letting the panel scroll. 1.5 is ~34° either side
 * of the horizontal; a drag steeper than that belongs to the ScrollView.
 */
const SCRUB_HORIZONTAL_BIAS = 1.5;

function isScrub(gesture: { dx: number; dy: number }): boolean {
  return Math.abs(gesture.dx) > Math.abs(gesture.dy) * SCRUB_HORIZONTAL_BIAS;
}
const CHART_HEIGHT = 96;
/** The lowest point still needs to be visible as a column, not a hairline. */
const MIN_COLUMN_FRACTION = 0.08;

/**
 * One drawn point: a value (null = no data here) at a position along the
 * chart's own x axis. What x MEANS is the series' business — distance along the
 * line for a height profile, elapsed time for a speed one — so the chart only
 * ever sorts and interpolates it, and hands it back to `formatX` to be read out.
 */
type Column = { value: number | null; x: number };

/**
 * Resample to `count` evenly spaced columns, INTERPOLATING between samples
 * rather than picking a nearest one. Nearest-sample resampling is what made the
 * outline staircase: neighbouring columns landed on the same sample and drew
 * the same height.
 */
function toColumns(samples: readonly ProfilePoint[], count: number): Column[] {
  const total = samples[samples.length - 1]!.x;
  if (count <= 1 || total <= 0) {
    return samples.map((s) => ({ value: s.value, x: s.x }));
  }
  const columns: Column[] = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const x = (total * i) / (count - 1);
    while (cursor < samples.length - 2 && samples[cursor + 1]!.x < x) {
      cursor += 1;
    }
    const before = samples[cursor]!;
    const after = samples[cursor + 1] ?? before;
    const span = after.x - before.x;
    // Clamp to the sample span: the first column can sit before the first
    // sample (x = 0 when the series starts at x > 0), and extrapolating there
    // would invent a value below the data's own minimum — and a negative bar
    // height in the renderer.
    const fraction =
      span > 0 ? Math.min(1, Math.max(0, (x - before.x) / span)) : 0;
    // A gap in coverage stays a gap: interpolating across it would invent
    // ground that was never measured, and borrowing a neighbour's height would
    // paint a fake plateau over the hole.
    const value =
      before.value == null || after.value == null
        ? null
        : before.value + (after.value - before.value) * fraction;
    columns.push({ value, x });
  }
  return columns;
}

export function ProfileChart({
  series,
  formatValue,
  formatX,
  hint,
  accessibilityLabel,
}: {
  series: ProfileSeries;
  /** Renders the scrubbed value — the chart knows no units. */
  formatValue: (value: number) => string;
  /** Renders the scrubbed position: metres along, or time into the recording. */
  formatX: (x: number) => string;
  /** Shown until the first scrub, in place of the readout. */
  hint: string;
  accessibilityLabel: string;
}) {
  const { min, max } = series;
  const [width, setWidth] = useState(0);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  // The responder is created once; it reads the live column count and width
  // through refs so a re-render never rebuilds the gesture mid-drag.
  const columnsRef = useRef(0);
  const widthRef = useRef(0);

  // One column per point of width, so the outline is as smooth as the layout
  // engine can draw it. Zero until the first layout — nothing renders then.
  const columnCount = Math.max(0, Math.min(MAX_COLUMNS, Math.round(width)));
  const columns = useMemo(
    () => (columnCount > 0 ? toColumns(series.points, columnCount) : []),
    [columnCount, series.points],
  );
  columnsRef.current = columns.length;
  widthRef.current = width;

  // The chart lives inside a sheet's ScrollView, and the two gestures it must
  // tell apart share a finger: ACROSS is a scrub, UP/DOWN is the user trying to
  // scroll the panel. It claims on touch-down so a plain press still reads a
  // value, then hands the gesture back unless the drag has PROVEN horizontal.
  //
  // The bias is the whole point. A first cut released only while |dy| > |dx|,
  // which is a 45° line through a gesture nobody aims that precisely: a scroll
  // begun with any sideways drift stayed with the chart and turned into a
  // scrub. Scrolling is the common intent and scrubbing the deliberate one, so
  // the chart now takes the gesture only inside ~34° of horizontal, and once it
  // has, it keeps it — a scrub that wobbles vertically must not be stolen back
  // mid-drag, which would be the same bug facing the other way.
  // ONE SWIPE, ONE PURPOSE, and it has to hold in both directions. Handing a
  // vertical drag to the scroll was half of it; the other half is that the
  // native ScrollView will intercept a drag that wanders vertically LATER in
  // the gesture, which yanked a curving scrub away mid-read. So the moment this
  // chart decides a touch is its own, it freezes the sheet's scroll until the
  // finger lifts — after that the direction of travel stops mattering.
  const scrollLock = useContext(SheetScrollLock);
  const scrubbing = useRef(false);
  const claimGesture = () => {
    if (scrubbing.current) return;
    scrubbing.current = true;
    scrollLock?.setLocked(true);
  };
  const releaseGesture = () => {
    scrubbing.current = false;
    scrollLock?.setLocked(false);
    setScrubIndex(null);
  };
  // A chart unmounted mid-scrub (the sheet closing under the finger) must not
  // leave the scroll frozen for the next thing rendered into it.
  useEffect(() => () => scrollLock?.setLocked(false), [scrollLock]);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_event, gesture) => isScrub(gesture),
      onPanResponderTerminationRequest: () => !scrubbing.current,
      // THE line that makes any of the above matter on Android. A PanResponder
      // blocks the native responder by DEFAULT, and blocking is not a
      // negotiation: `NativeViewHierarchyManager.setJSResponder` stops the
      // parent ScrollView's `onInterceptTouchEvent` from ever firing, so the
      // scroll never asks and `onPanResponderTerminationRequest` is never
      // consulted. Angle arithmetic in JS cannot fix a scroll that was never
      // offered the touch — which is why biasing the angle changed nothing.
      // With this false, the native ScrollView intercepts a vertical drag past
      // its own touch slop and we get `onPanResponderTerminate`, while a
      // horizontal drag never trips its slop and stays ours.
      onShouldBlockNativeResponder: () => false,
      onPanResponderGrant: (event) => {
        // A press with no travel yet is the chart's — it reads a value straight
        // away — but it does NOT lock the scroll: until the finger moves, the
        // gesture could still turn out to be a scroll, and that is the one
        // decision this component must not make early.
        scrubbing.current = false;
        track(event.nativeEvent.locationX);
      },
      onPanResponderMove: (event, gesture) => {
        if (isScrub(gesture)) claimGesture();
        track(event.nativeEvent.locationX);
      },
      onPanResponderRelease: releaseGesture,
      onPanResponderTerminate: releaseGesture,
    }),
  ).current;

  function track(x: number) {
    const count = columnsRef.current;
    const chartWidth = widthRef.current;
    if (count === 0 || chartWidth <= 0) return;
    const fraction = Math.min(1, Math.max(0, x / chartWidth));
    setScrubIndex(Math.min(count - 1, Math.round(fraction * (count - 1))));
  }

  // No coverage anywhere means there is no chart to draw — the stats above it
  // already say the data had nothing here.
  if (min == null || max == null || series.points.length < 2) return null;

  const span = Math.max(1, max - min);
  const scrubbed = scrubIndex == null ? null : columns[scrubIndex];

  return (
    <View style={styles.wrap}>
      {/* Reserves its own line so the chart doesn't jump when the readout
          appears under a finger. */}
      <View style={styles.readoutRow}>
        {scrubbed ? (
          // VALUE FIRST, then where it is, joined by a word.
          // "3.7 km · 51 m" was two bare numbers in the order of the axes, and
          // reading it needed you to already know which axis was which — the
          // units do not settle it, since a height and a distance are both
          // metres. "51 m at 3.7 km" says the same thing in the order the
          // question is asked, costs no extra line, and works unchanged for a
          // speed against a clock ("4.2 km/h at 1:23").
          <Text style={styles.readout}>
            {scrubbed.value != null ? formatValue(scrubbed.value) : "—"}
            <Text style={styles.readoutAt}>{"  at  "}</Text>
            {formatX(scrubbed.x)}
          </Text>
        ) : (
          <Text style={styles.readoutHint}>{hint}</Text>
        )}
      </View>

      <View
        style={styles.chart}
        onLayout={(event: LayoutChangeEvent) =>
          setWidth(event.nativeEvent.layout.width)
        }
        accessibilityLabel={accessibilityLabel}
        {...responder.panHandlers}
      >
        {columns.map((column, index) => (
          // Non-interactive so the TOUCH lands on the container: locationX is
          // measured against whichever view received it, and a 16px-wide column
          // reports a locationX near zero — which read as "you are at the start
          // of the route" wherever you actually pressed.
          <View key={index} style={styles.column} pointerEvents="none">
            {column.value == null ? null : (
              <View
                style={[
                  styles.bar,
                  {
                    height:
                      CHART_HEIGHT *
                      (MIN_COLUMN_FRACTION +
                        (1 - MIN_COLUMN_FRACTION) * ((column.value - min) / span)),
                  },
                ]}
              />
            )}
          </View>
        ))}
        {/* A hairline rather than a highlighted column: at one column per point
            a recoloured column is a pixel wide and invisible. */}
        {scrubIndex != null && columns.length > 1 ? (
          <View
            style={[
              styles.scrubLine,
              { left: `${(scrubIndex / (columns.length - 1)) * 100}%` },
            ]}
            pointerEvents="none"
          />
        ) : null}
        {/* Over the columns, not under: it fades their feet into the surface so
            the silhouette reads as one shape rather than a row of bars. */}
        <LinearGradient
          colors={[withAlpha(theme.primary, 0), withAlpha(theme.primary, 0.55)]}
          style={styles.fade}
          pointerEvents="none"
        />
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing(0.5) },
  readoutRow: { height: 18, justifyContent: "center" },
  readout: {
    color: theme.textPrimary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    fontVariant: ["tabular-nums"],
  },
  readoutHint: { color: theme.textMuted, fontSize: fontSize.xs },
  readoutAt: { color: theme.textMuted, fontWeight: fontWeight.regular },
  chart: {
    flexDirection: "row",
    alignItems: "flex-end",
    height: CHART_HEIGHT,
    backgroundColor: withAlpha(theme.textMuted, 0.08),
    borderRadius: radius.sm,
    overflow: "hidden",
  },
  // No gap: contiguous columns read as an area, which is what a profile is.
  column: { flex: 1, justifyContent: "flex-end" },
  bar: { backgroundColor: withAlpha(theme.accent, 0.85) },
  scrubLine: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    backgroundColor: theme.textPrimary,
  },
  fade: { ...StyleSheet.absoluteFillObject, top: "55%" },
});
