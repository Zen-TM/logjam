// How fast you are going and how high you are, in the instruments stack.
//
// It SUBSCRIBES to the readout rather than being handed it as a prop, and it is
// memoised, so a new fix re-renders this one small component and nothing else —
// the rule the compass tape already follows (mobile/AGENTS.md, Privacy and
// battery).
//
// It owns a slow ticker of its own, and that is not decoration. The map's fix
// watcher is `timeInterval` AND `distanceInterval`, so a phone standing still
// produces NO fixes at all: without something re-checking the clock, the chip
// would keep displaying the speed of the last time the user walked. The ticker
// is the only thing that can notice a fix has gone stale, and 2 s is as coarse
// as it can be while a 20 s staleness cliff still lands promptly.
//
// TWO LABELLED COLUMNS, A STEADY WIDTH. Both halves are numbers with units, and
// units alone don't say which is which — "3.4 km/h · 253 m" needs reading, a
// labelled column is glanced at. The width has a floor and the values are
// centred so the chip does not breathe with every fix (it grows only with the
// system text size, each value on one line): it sits in a stack above the scale
// bar and the compass tape, and a box that changes width while you walk drags
// the eye to the one instrument that has nothing new to say.
//
// PRIVACY: two numbers, no position, and — like every instrument here — never
// logged.
import { memo, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { formatSpeedMps } from "@logjam/shared";

import {
  fontSize,
  radius,
  spacing,
  withAlpha,
  makeStyles,
  muted,
} from "../theme";
import { keepWithValue, readoutFigures, useLiveReadout } from "./liveReadout";

// The height of one line of each text, as the font draws it (the same estimate
// the scale bar makes): the chip is a fixed box around them.
const LABEL_LINE = Math.round(fontSize.xs * 1.2);
const VALUE_LINE = Math.round(fontSize.sm * 1.35);

/** Its drawn height at the default text size (a larger system font grows the
 *  chip past it), exported for the same reason `SCALE_BAR_HEIGHT` is: the
 *  native compass ornament is positioned by a NUMBER and has to clear the whole
 *  stack (see MapScreen's `ornamentMarginY`). */
export const READOUT_CHIP_HEIGHT = LABEL_LINE + VALUE_LINE + spacing(1);

/** Wide enough for the longest pair either column produces ("12.5 km/h",
 *  "1234 m") and the longest label ("12 min ago") without the
 *  columns touching, and never wider. A glance figure, not a hero: it sits
 *  beside the scale bar and must not outweigh the map. */
const CHIP_MIN_WIDTH = 168;

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
  const styles = useStyles();

  const readout = useLiveReadout();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [active]);

  const figures = readoutFigures(readout, now);
  const speed =
    figures.speedMps == null
      ? UNKNOWN
      : keepWithValue(formatSpeedMps(figures.speedMps));
  const elevation =
    figures.elevationM == null
      ? UNKNOWN
      : keepWithValue(`${Math.round(figures.elevationM)} m`);
  // Every figure from the position says how far to trust it: its age once the
  // fix is stale, "about" when it is a tower's guess (gpsSignal.ts). It takes
  // the label's place (over the figure, so "about" reads into it) because the
  // name plus the age does not fit a column at a large system font.
  const note = figures.age ?? (figures.quality === "coarse" ? "about" : null);
  const grey = figures.quality === "stale";

  return (
    <View style={styles.chip} pointerEvents="none">
      <View style={styles.column}>
        <Text style={styles.label} numberOfLines={1}>
          {note && figures.speedMps != null ? note : "Speed"}
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.value, grey && styles.grey]}
          accessibilityLabel={`Speed ${speed}`}
        >
          {speed}
        </Text>
      </View>
      <View style={styles.divider} />
      <View style={styles.column}>
        {/* No provenance glyph on screen: a DEM reading and a GPS one are not
            the same measurement, but displaying that permanently in a
            two-word chip clutters the UI when the distinction only matters to
            someone already asking. The screen reader still gets it, on the
            value below. */}
        <Text style={styles.label} numberOfLines={1}>
          {note && figures.elevationM != null ? note : "Elevation"}
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.value, grey && styles.grey]}
          accessibilityLabel={`Elevation ${elevation}${note ? `, ${note}` : ""}${readout?.fromTerrain ? ", from terrain data" : ""}`}
        >
          {elevation}
        </Text>
      </View>
    </View>
  );
});

const useStyles = makeStyles((theme, textRole) => ({
  // Same translucent warm backing as the scale bar — these sit in one stack
  // over map imagery of any brightness and have to read as one instrument set.
  chip: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: CHIP_MIN_WIDTH,
    minHeight: READOUT_CHIP_HEIGHT,
    backgroundColor: withAlpha(theme.page, 0.8),
    borderRadius: radius.sm,
    paddingHorizontal: spacing(0.5),
  },
  column: { flex: 1, alignItems: "center" },
  label: { ...muted(theme, textRole.meta) },
  value: {
    ...textRole.control,
    color: theme.text,
    fontVariant: ["tabular-nums"],
  },
  grey: { color: theme.textMuted },
  // A hairline rather than a gap: two centred columns with nothing between them
  // read as one wrapped sentence at a glance.
  divider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    marginVertical: spacing(1),
    backgroundColor: withAlpha(theme.text, 0.25),
  },
}));
