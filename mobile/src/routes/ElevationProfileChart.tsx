// Elevation profile, with a scrubber.
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
import { useMemo, useRef, useState } from "react";
import {
  PanResponder,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { formatDistanceM, type ElevationProfile } from "@logjam/shared";

import { fontSize, fontWeight, radius, spacing, theme, withAlpha } from "../theme";

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
const CHART_HEIGHT = 96;
/** The lowest point still needs to be visible as a column, not a hairline. */
const MIN_COLUMN_FRACTION = 0.08;

type Column = { elevationM: number | null; distanceM: number };

/**
 * Resample to `count` evenly spaced columns, INTERPOLATING between samples
 * rather than picking a nearest one. Nearest-sample resampling is what made the
 * outline staircase: neighbouring columns landed on the same sample and drew
 * the same height.
 */
function toColumns(
  samples: ElevationProfile["samples"],
  count: number,
): Column[] {
  const total = samples[samples.length - 1]!.distanceM;
  if (count <= 1 || total <= 0) {
    return samples.map((s) => ({ elevationM: s.elevationM, distanceM: s.distanceM }));
  }
  const columns: Column[] = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const distanceM = (total * i) / (count - 1);
    while (cursor < samples.length - 2 && samples[cursor + 1]!.distanceM < distanceM) {
      cursor += 1;
    }
    const before = samples[cursor]!;
    const after = samples[cursor + 1] ?? before;
    const span = after.distanceM - before.distanceM;
    const fraction = span > 0 ? (distanceM - before.distanceM) / span : 0;
    // A gap in DEM coverage stays a gap: interpolating across it would invent
    // ground that was never measured.
    const elevationM =
      before.elevationM == null || after.elevationM == null
        ? (before.elevationM ?? after.elevationM)
        : before.elevationM + (after.elevationM - before.elevationM) * fraction;
    columns.push({ elevationM, distanceM });
  }
  return columns;
}

export function ElevationProfileChart({ profile }: { profile: ElevationProfile }) {
  const { minM, maxM } = profile;
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
    () => (columnCount > 0 ? toColumns(profile.samples, columnCount) : []),
    [columnCount, profile.samples],
  );
  columnsRef.current = columns.length;
  widthRef.current = width;

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // The chart lives inside a sheet's ScrollView; claiming the gesture here
      // is what stops a horizontal scrub from scrolling the sheet instead.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => track(event.nativeEvent.locationX),
      onPanResponderMove: (event) => track(event.nativeEvent.locationX),
      onPanResponderRelease: () => setScrubIndex(null),
      onPanResponderTerminate: () => setScrubIndex(null),
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
  // already say the DEM had nothing here.
  if (minM == null || maxM == null || profile.samples.length < 2) return null;

  const span = Math.max(1, maxM - minM);
  const totalM = profile.samples[profile.samples.length - 1]!.distanceM;
  const scrubbed = scrubIndex == null ? null : columns[scrubIndex];

  return (
    <View style={styles.wrap}>
      {/* Reserves its own line so the chart doesn't jump when the readout
          appears under a finger. */}
      <View style={styles.readoutRow}>
        {scrubbed ? (
          <Text style={styles.readout}>
            {formatDistanceM(scrubbed.distanceM)}
            {scrubbed.elevationM != null ? `  ·  ${Math.round(scrubbed.elevationM)} m` : ""}
          </Text>
        ) : (
          <Text style={styles.readoutHint}>Drag across for heights</Text>
        )}
      </View>

      <View
        style={styles.chart}
        onLayout={(event: LayoutChangeEvent) =>
          setWidth(event.nativeEvent.layout.width)
        }
        accessibilityLabel="Elevation profile"
        {...responder.panHandlers}
      >
        {columns.map((column, index) => (
          // Non-interactive so the TOUCH lands on the container: locationX is
          // measured against whichever view received it, and a 16px-wide column
          // reports a locationX near zero — which read as "you are at the start
          // of the route" wherever you actually pressed.
          <View key={index} style={styles.column} pointerEvents="none">
            {column.elevationM == null ? null : (
              <View
                style={[
                  styles.bar,
                  {
                    height:
                      CHART_HEIGHT *
                      (MIN_COLUMN_FRACTION +
                        (1 - MIN_COLUMN_FRACTION) *
                          ((column.elevationM - minM) / span)),
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

      <View style={styles.axis}>
        <Text style={styles.axisLabel}>{Math.round(minM)} m</Text>
        <Text style={styles.axisLabel}>{formatDistanceM(totalM)}</Text>
        <Text style={styles.axisLabel}>{Math.round(maxM)} m</Text>
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
  axis: { flexDirection: "row", justifyContent: "space-between" },
  axisLabel: {
    color: theme.textMuted,
    fontSize: fontSize.xs,
    fontVariant: ["tabular-nums"],
  },
});
