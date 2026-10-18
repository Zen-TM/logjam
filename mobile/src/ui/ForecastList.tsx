import { Text, View } from "react-native";

import {
  makeStyles,
  muted,
  radius,
  spacing,
  useTheme,
  withAlpha,
} from "../theme";
import { Icon, type Glyph } from "./Icon";

export type ForecastRow = {
  key: string;
  /** "Today", "Mon 20". */
  day: string;
  glyph: Glyph;
  /** What the glyph says, spoken ("Rain"). */
  glyphLabel: string;
  temperature: string;
  rain: string;
  wind: string;
  /** Today's row: the one the eye starts on. */
  current?: boolean;
};

// A run of days, one compact row each: day, condition glyph, temperature, rain,
// wind, in columns that line up down the list (tabular figures). Read-only, so
// no card fill: that colour means "press me". Same name and props as Logjam
// Web's (shared/DESIGN.md §14).
export function ForecastList({
  rows,
  label,
}: {
  rows: readonly ForecastRow[];
  label: string;
}) {
  const theme = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.list} accessibilityLabel={label}>
      {rows.map((row) => (
        <View
          key={row.key}
          style={[styles.row, row.current && styles.current]}
          accessible
          accessibilityLabel={`${row.day}, ${row.glyphLabel}, ${row.temperature}, rain ${row.rain}, wind ${row.wind}`}
        >
          <Text style={[styles.day, row.current && styles.emphasis]}>
            {row.day}
          </Text>
          <Icon idea={row.glyph} size={22} color={theme.text} />
          <View style={styles.figures}>
            <Text style={[styles.cell, row.current && styles.emphasis]}>
              {row.temperature}
            </Text>
            <Text style={styles.rain}>{row.rain}</Text>
          </View>
          <Text style={[styles.cell, styles.wind]}>{row.wind}</Text>
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  list: { gap: spacing(0.5) },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1),
    paddingVertical: spacing(1),
    paddingHorizontal: spacing(1),
    borderRadius: radius.md,
  },
  current: { backgroundColor: withAlpha(theme.accent, 0.14) },
  day: {
    ...textRole.detail,
    color: theme.text,
    // Wide enough for "Today" and "Wed 21" on one line at the default text size.
    width: spacing(6) + spacing(2),
    fontVariant: ["tabular-nums"],
  },
  emphasis: { ...textRole.control },
  cell: {
    ...textRole.detail,
    color: theme.text,
    fontVariant: ["tabular-nums"],
  },
  // The rain sits under the temperature, as on Logjam Web: four figures do
  // not fit one line of a phone at the default text size.
  figures: { flex: 1 },
  rain: { ...muted(theme, textRole.detail), fontVariant: ["tabular-nums"] },
  wind: { textAlign: "right" },
}));
