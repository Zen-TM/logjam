import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import type { FixQuality } from "../map/gpsSignal";
import { navFigures } from "../map/navFigures";
import { makeStyles, spacing, radius, useTheme } from "../theme";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";

/** Coarse on purpose: an age in whole seconds needs no more. */
const AGE_TICK_MS = 5000;

/**
 * Where a place you are going to is from here: its distance and bearing as two
 * `instrument` figures, the name on a second line and an X to stop. It heads
 * the map's notice stack (shared/DESIGN.md §15).
 *
 * Both figures come from the position, so they follow the fix like every other
 * (mobile/DESIGN.md §3): grey with their age once it is stale, "about" when it
 * is a tower's guess. A fresh-looking number from an old fix is the one thing
 * this must never show.
 *
 * PRIVACY: draws a place's name, and logs nothing.
 */
export function NavReadout({
  name,
  distanceM,
  bearingDeg,
  quality,
  fixAtMs,
  active,
  onStop,
}: {
  name: string;
  /** Null before the first fix: both figures read as a dash. */
  distanceM: number | null;
  bearingDeg: number | null;
  quality: FixQuality;
  /** When the fix behind the figures arrived; null before the first. */
  fixAtMs: number | null;
  /** The map's own `sensorsActive`: the age ticks only while it is looked at. */
  active: boolean;
  onStop: () => void;
}) {
  const theme = useTheme();
  const styles = useStyles();

  const stale = quality === "stale";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || !stale) return;
    // A timeout first, so the age is right the moment the fix goes stale
    // rather than one tick later.
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, AGE_TICK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [active, stale]);

  const f = navFigures(distanceM, bearingDeg, quality, fixAtMs, now);
  const figure = [styles.figure, f.grey && styles.grey];
  const second = !f.known
    ? `${name} · waiting for GPS…`
    : f.age
      ? `${name} · ${f.age}`
      : name;
  // What a screen reader says for the figures: the age and "about" included.
  const spoken = !f.known
    ? "waiting for GPS"
    : `${f.about ? "about " : ""}${f.distance}${f.unit}, ${f.bearing}${f.age ? `, ${f.age}` : ""}`;

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        {/* Its own focus target, so the X stays a button of its own. */}
        <View
          accessible
          accessibilityLabel={`${name}: ${spoken}`}
          style={styles.figures}
        >
          <Icon idea="navigateTo" size={20} color={theme.accent} />
          <Text style={figure}>
            {f.about ? <Text style={styles.unit}>about </Text> : null}
            {f.distance}
            <Text style={styles.unit}>{f.unit}</Text>
          </Text>
          <Text style={figure}>{f.bearing}</Text>
        </View>
        <IconButton
          icon="close"
          size={16}
          accessibilityLabel="Stop navigating"
          onPress={onStop}
        />
      </View>
      <Text style={styles.name} numberOfLines={2}>
        {second}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  card: {
    alignSelf: "stretch",
    backgroundColor: theme.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: theme.line,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(1),
  },
  top: { flexDirection: "row", alignItems: "center", gap: spacing(1.5) },
  figures: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1.5),
  },
  figure: { ...textRole.instrument, color: theme.text, flexShrink: 1 },
  unit: { ...textRole.control },
  grey: { color: theme.textMuted },
  name: { ...textRole.detail, color: theme.textMuted },
}));
