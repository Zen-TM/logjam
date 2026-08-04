// Compass tape — which way the user is FACING, read off the phone's magnetometer
// (true north, declination-corrected: see heading.ts).
//
// A tape rather than a rose: standing at the top of an abseil, the question is
// "am I looking at 240 or 260", and a rotating needle answers that to about
// ±20°. A strip with a fixed centre line and a scale sliding under it reads like
// a bearing dial and is legible at arm's length in the wet.
//
// Sits bottom-left, above the scale bar — the map's own instruments live on that
// edge; the right column is for actions (MapScreen).
//
// It reads TRUE north, like the map, the GPS and the navigate-to-waypoint chip
// (heading.ts) — so in NSW it sits ~12.5° above what a baseplate compass needle
// says, and that is the needle being magnetic, not this being wrong. The tape
// carries no "true north" mark: the map is the one screen where every pixel of
// chrome is a pixel of terrain, so the wording lives in the Settings row that
// turns this on, and in the accessibility label below.
import { StyleSheet, Text, View } from "react-native";
import { compassPointFor } from "@logjam/shared";

import { fontSize, fontWeight, radius, spacing, theme, withAlpha } from "../theme";
import { compassTicks } from "./compassTape";

/**
 * Fixed height, and exported: the native MapLibre compass ornament shares this
 * corner, and its margin is a static number that has to clear this box (see
 * mapChrome.CHROME_BOTTOM's use in MapScreen).
 */
export const COMPASS_STRIP_HEIGHT = 38;

/**
 * How wide the tape may be. Deliberately modest: it is a reference you glance
 * at, and every pixel of it is terrain you can't see (DESIGN.md — the map has
 * no chrome it can do without).
 */
export const COMPASS_STRIP_WIDTH = 176;

/** Room for a three-digit label centred on its tick. */
const LABEL_WIDTH = 30;

export function CompassStrip({
  heading,
  width,
}: {
  /** Smoothed true-north heading in degrees, or null with no usable sensor. */
  heading: number | null;
  /** Space the tape may occupy, in px. */
  width: number;
}) {
  if (heading == null || width <= 0) return null;
  const ticks = compassTicks(heading, width);
  const rounded = Math.round(heading) % 360;

  return (
    <View
      style={[styles.frame, { width, height: COMPASS_STRIP_HEIGHT }]}
      pointerEvents="none"
      accessibilityRole="image"
      accessibilityLabel={`Facing ${compassPointFor(heading)}, ${rounded} degrees true`}
    >
      <View style={styles.tape}>
        {ticks.map((tick) => (
          <View key={tick.bearing} style={[styles.tick, { left: tick.x }]}>
            <View style={tick.major ? styles.markMajor : styles.markMinor} />
            {tick.label ? (
              <Text style={styles.label} numberOfLines={1}>
                {tick.label}
              </Text>
            ) : null}
            <View style={tick.major ? styles.markMajor : styles.markMinor} />
          </View>
        ))}
      </View>
      {/* The bearing itself: everything else on the strip moves, this doesn't. */}
      <View style={styles.centreLine} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: withAlpha(theme.primary, 0.92),
    borderWidth: 1,
    borderColor: withAlpha(theme.accent, 0.7),
    borderRadius: radius.md,
    // The tape runs past both ends of the box; without this it draws over the
    // rest of the map.
    overflow: "hidden",
  },
  tape: { ...StyleSheet.absoluteFillObject },
  // Each tick is its own centred column: top mark, label, bottom mark. Shifted
  // half its width left so the column is centred ON the tick's x, not right of it.
  tick: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: LABEL_WIDTH,
    marginLeft: -LABEL_WIDTH / 2,
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing(0.375),
  },
  markMajor: { width: 1.5, height: 6, backgroundColor: theme.textPrimary },
  markMinor: { width: 1, height: 3, backgroundColor: withAlpha(theme.textPrimary, 0.6) },
  label: {
    color: theme.textPrimary,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    fontVariant: ["tabular-nums"],
  },
  centreLine: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: "50%",
    width: 2,
    marginLeft: -1,
    backgroundColor: theme.accent,
  },
});
