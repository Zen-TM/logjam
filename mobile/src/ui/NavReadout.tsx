import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { compassPointFor, formatDistanceM } from "@logjam/shared";

import { fixAgeLabel, type FixQuality } from "../map/gpsSignal";
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

  const known = distanceM != null && bearingDeg != null;
  const age = stale && fixAtMs != null ? fixAgeLabel(now - fixAtMs) : null;
  const [distance, unit] = known
    ? splitUnit(formatDistanceM(distanceM))
    : ["—", ""];
  const bearing = known
    ? `${compassPointFor(bearingDeg)} ${Math.round(bearingDeg)}°`
    : "—";
  const figure = [styles.figure, stale && styles.grey];
  const second = !known
    ? `${name} · waiting for GPS…`
    : age
      ? `${name} · ${age}`
      : name;

  return (
    <View
      style={styles.card}
      accessibilityLabel={`${name}: ${known ? `${distance}${unit}, ${bearing}` : "waiting for GPS"}${age ? `, ${age}` : ""}${quality === "coarse" ? ", about" : ""}`}
    >
      <View style={styles.top}>
        <Icon idea="navigateTo" size={20} color={theme.accent} />
        <Text style={figure}>
          {quality === "coarse" && known ? (
            <Text style={styles.unit}>about </Text>
          ) : null}
          {distance}
          <Text style={styles.unit}>{unit}</Text>
        </Text>
        <Text style={figure}>{bearing}</Text>
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

function splitUnit(text: string): [string, string] {
  const at = text.indexOf(" ");
  return at < 0 ? [text, ""] : [text.slice(0, at), text.slice(at)];
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
  figure: { ...textRole.instrument, color: theme.text, flexShrink: 1 },
  unit: { ...textRole.control },
  grey: { color: theme.textMuted },
  name: { ...textRole.detail, color: theme.textMuted },
}));
