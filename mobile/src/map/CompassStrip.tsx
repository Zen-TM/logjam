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
// It reads TRUE north by default, like the map, the GPS and the navigate-to-
// waypoint chip (heading.ts) — so in NSW it sits ~12.5° above what a baseplate
// compass needle says, and that is the needle being magnetic, not this being
// wrong. Which is precisely why `reference` exists: a canyoner transferring a
// bearing onto a paper topo and a plate compass wants the number the NEEDLE
// will show, and doing that arithmetic in the head at the top of an abseil is
// how people walk off on the wrong spur.
//
// The switch moves the NUMBERS ONLY. The map, the location arrow and the
// navigate chip stay true north in both settings, because they are drawn
// against a true-north map: a magnetic arrow on a true map is just a wrong
// arrow. In the default (true) the tape carries no mark — the map is the one
// screen where every pixel of chrome is a pixel of terrain — and in magnetic it
// carries a single "M", because a tape that silently reads 12° low is worth
// declaring.
import { StyleSheet, Text, View } from "react-native";
import { compassPointFor } from "@logjam/shared";

import { fontSize, fontWeight, radius, spacing, textScale, theme, withAlpha } from "../theme";
import type { NorthReference } from "./mapPreferences";
import { compassTicks, displayHeading } from "./compassTape";

/**
 * Fixed height, and exported: the native MapLibre compass ornament shares this
 * corner, and its margin is a static number that has to clear this box (see
 * mapChrome.CHROME_BOTTOM's use in MapScreen).
 *
 * It grows with the type, because the box exists to hold the labels: at a large
 * text size a 38 px strip clips its own bearings, and an instrument that can't
 * be read is worse than one that takes another eight pixels of map.
 */
export const COMPASS_STRIP_HEIGHT = Math.round(38 * textScale);

/**
 * How wide the tape may be. Deliberately modest: it is a reference you glance
 * at, and every pixel of it is terrain you can't see (DESIGN.md — the map has
 * no chrome it can do without).
 */
export const COMPASS_STRIP_WIDTH = 176;

/**
 * Room for a three-digit label centred on its tick, scaled with the type for
 * the same reason as the height. Labels sit 30° apart — 66 px at the tape's
 * scale — so even at the largest multiplier the slots stay clear of each other.
 */
const LABEL_WIDTH = Math.round(30 * textScale);

export function CompassStrip({
  heading,
  width,
  reference = "true",
}: {
  /** Smoothed true-north heading in degrees, or null with no usable sensor. */
  heading: number | null;
  /** Space the tape may occupy, in px. */
  width: number;
  /**
   * Which north the NUMBERS count from. Only the numbers: the heading passed in
   * is true north and everything else on the map still is (Settings → Map).
   */
  reference?: NorthReference;
}) {
  if (heading == null || width <= 0) return null;
  // Applied once, here, to the whole tape: shifting the heading shifts every
  // tick and label with it, which is what makes the centre line read the
  // magnetic bearing the user will set on a baseplate compass.
  const shown = displayHeading(heading, reference);
  const ticks = compassTicks(shown, width);
  const rounded = Math.round(shown) % 360;

  return (
    <View
      style={[styles.frame, { width, height: COMPASS_STRIP_HEIGHT }]}
      pointerEvents="none"
      accessibilityRole="image"
      accessibilityLabel={`Facing ${compassPointFor(shown)}, ${rounded} degrees ${reference}`}
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
      {/* Marked only when it is NOT the app's convention. Every other bearing
          on this screen is true north, so a tape quietly reading 12° lower is
          the one state worth spending eight pixels of map to declare. */}
      {reference === "magnetic" ? <Text style={styles.reference}>M</Text> : null}
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
  reference: {
    position: "absolute",
    left: spacing(0.5),
    bottom: spacing(0.25),
    color: withAlpha(theme.textPrimary, 0.7),
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
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
