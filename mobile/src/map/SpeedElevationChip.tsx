// How fast you are going and how high you are, in the instruments stack.
//
// It SUBSCRIBES to the readout rather than being handed it as a prop, and it is
// memoised, so a new fix re-renders this one small component and nothing else —
// the rule the compass tape already follows (mobile/CLAUDE.md, Battery).
//
// It owns a slow ticker of its own, and that is not decoration. The map's fix
// watcher is `timeInterval` AND `distanceInterval`, so a phone standing still
// produces NO fixes at all: without something re-checking the clock, the chip
// would keep displaying the speed of the last time the user walked. The ticker
// is the only thing that can notice a fix has gone stale, and 2 s is as coarse
// as it can be while a 20 s staleness cliff still lands promptly.
//
// TWO LABELLED COLUMNS, FIXED WIDTH. Both halves are numbers with units, and
// units alone don't say which is which — "3.4 km/h · 253 m" needs reading, a
// labelled column is glanced at. The width is fixed and the values centred so
// the chip does not breathe with every fix: it sits in a stack above the scale
// bar and the compass tape, and a box that changes width while you walk drags
// the eye to the one instrument that has nothing new to say.
//
// PRIVACY: two numbers, no position, and — like every instrument here — never
// logged.
import { memo, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { formatSpeedMps } from "@logjam/shared";

import { fontSize, fontWeight, radius, spacing, theme, withAlpha } from "../theme";
import { READOUT_STALE_MS, useLiveReadout } from "./liveReadout";

const LABEL_LINE = Math.round(fontSize.xs * 1.2);
const VALUE_LINE = Math.round(fontSize.sm * 1.35);

/** Its drawn height, exported for the same reason `SCALE_BAR_HEIGHT` is: the
 *  native compass ornament is positioned by a NUMBER and has to clear the whole
 *  stack (see MapScreen's `ornamentMarginY`). */
export const READOUT_CHIP_HEIGHT = LABEL_LINE + VALUE_LINE + spacing(1);

/** Wide enough for the longest pair either column produces ("12.5 km/h",
 *  "1234 m") without the columns touching, and never wider. */
const CHIP_WIDTH = 168;

/** Coarse on purpose — see the header. */
const TICK_MS = 2000;

/** Nothing known reads as an em dash, never as a zero: standing still and
 *  having no fix are different answers and only one of them is 0 km/h. */
const UNKNOWN = "—";

export const SpeedElevationChip = memo(function SpeedElevationChip({
  active,
}: {
  /** The map's own `mapFocused && appActive`. A ticker behind a dark screen is
   *  a wakeup nobody sees. */
  active: boolean;
}) {
  const readout = useLiveReadout();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [active]);

  // A stale fix invalidates the SPEED but not the height: you have not moved,
  // so the ground under you is still the ground under you.
  const stale = readout == null || now - readout.atMs > READOUT_STALE_MS;
  const speed =
    readout == null || stale || readout.speedMps == null
      ? UNKNOWN
      : formatSpeedMps(readout.speedMps);
  const elevation =
    readout?.elevationM == null ? UNKNOWN : `${Math.round(readout.elevationM)} m`;

  return (
    <View style={styles.chip} pointerEvents="none">
      <View style={styles.column}>
        <Text style={styles.label}>Speed</Text>
        <Text style={styles.value} accessibilityLabel={`Speed ${speed}`}>
          {speed}
        </Text>
      </View>
      <View style={styles.divider} />
      <View style={styles.column}>
        {/* One glyph rather than a word, and in the LABEL rather than beside the
            number: which surface the height came from is a fact about the
            reading, not part of it. A DEM cannot see inside a slot narrower
            than its ~19 m grid, and GPS altitude cannot see a hill smaller than
            its own noise — a number with no provenance gets trusted. */}
        <Text style={styles.label}>
          {readout?.fromTerrain ? "Elevation ▲" : "Elevation"}
        </Text>
        <Text
          style={styles.value}
          accessibilityLabel={
            `Elevation ${elevation}${readout?.fromTerrain ? ", from terrain data" : ""}`
          }
        >
          {elevation}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  // Same translucent warm backing as the scale bar — these sit in one stack
  // over map imagery of any brightness and have to read as one instrument set.
  chip: {
    flexDirection: "row",
    alignItems: "center",
    width: CHIP_WIDTH,
    height: READOUT_CHIP_HEIGHT,
    backgroundColor: `${theme.primary}CC`,
    borderRadius: radius.sm,
    paddingHorizontal: spacing(0.5),
  },
  column: { flex: 1, alignItems: "center" },
  label: {
    color: theme.textMuted,
    fontSize: fontSize.xs,
    lineHeight: LABEL_LINE,
  },
  value: {
    color: theme.textPrimary,
    fontSize: fontSize.sm,
    lineHeight: VALUE_LINE,
    fontWeight: fontWeight.medium,
    fontVariant: ["tabular-nums"],
  },
  // A hairline rather than a gap: two centred columns with nothing between them
  // read as one wrapped sentence at a glance.
  divider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    marginVertical: spacing(0.75),
    backgroundColor: withAlpha(theme.textPrimary, 0.25),
  },
});
