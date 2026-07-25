import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { fontSize, fontWeight, hitSlop, radius, spacing, theme, withAlpha } from "../theme";
import {
  addMonths,
  formatMonthLabel,
  monthGrid,
  monthOf,
  toDateKey,
  WEEKDAY_INITIALS,
  type YearMonth,
} from "./monthGrid";

/**
 * Month-grid date picker, rendered inline (inside a sheet) rather than as an
 * OS dialog.
 *
 * Why not the platform picker: a trip log needs the same picker for one date
 * and for both ends of a range, and the Android dialog is a separate
 * Material-themed window that can't be tinted to the scheme — three different
 * looking pickers on one screen. This is one themed surface reused three
 * times, and it needs no native dependency.
 *
 * Values are "YYYY-MM-DD" keys handled in UTC (see `monthGrid`). Future days
 * are disabled: a trip log records what has happened.
 */
export function DatePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (key: string) => void;
}) {
  const today = toDateKey(new Date());
  const [visibleMonth, setVisibleMonth] = useState<YearMonth>(() =>
    monthOf(value ?? today),
  );
  const cells = monthGrid(visibleMonth);

  return (
    <View style={styles.wrap}>
      <View style={styles.monthRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          hitSlop={hitSlop}
          onPress={() => setVisibleMonth(addMonths(visibleMonth, -1))}
          style={({ pressed }) => [styles.monthNav, pressed && styles.pressed]}
        >
          <Feather name="chevron-left" size={20} color={theme.textPrimary} />
        </Pressable>
        <Text style={styles.monthLabel}>{formatMonthLabel(visibleMonth)}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          hitSlop={hitSlop}
          onPress={() => setVisibleMonth(addMonths(visibleMonth, 1))}
          style={({ pressed }) => [styles.monthNav, pressed && styles.pressed]}
        >
          <Feather name="chevron-right" size={20} color={theme.textPrimary} />
        </Pressable>
      </View>

      <View style={styles.week}>
        {WEEKDAY_INITIALS.map((initial, index) => (
          <Text key={index} style={styles.weekday}>
            {initial}
          </Text>
        ))}
      </View>

      {chunk(cells, 7).map((week, weekIndex) => (
        <View key={weekIndex} style={styles.week}>
          {week.map((key, dayIndex) => {
            if (key === null) return <View key={dayIndex} style={styles.day} />;
            const selected = key === value;
            const isToday = key === today;
            const disabled = key > today;
            return (
              <Pressable
                key={dayIndex}
                accessibilityRole="button"
                accessibilityLabel={key}
                accessibilityState={{ selected, disabled }}
                disabled={disabled}
                onPress={() => onChange(key)}
                style={({ pressed }) => [
                  styles.day,
                  styles.dayTappable,
                  isToday && styles.dayToday,
                  selected && styles.daySelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.dayText,
                    selected && styles.dayTextSelected,
                    disabled && styles.dayTextDisabled,
                  ]}
                >
                  {Number(key.slice(8))}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}

const styles = StyleSheet.create({
  wrap: { gap: spacing(0.5) },
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: spacing(0.5),
  },
  monthNav: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  monthLabel: {
    color: theme.textPrimary,
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
  },
  week: { flexDirection: "row" },
  weekday: {
    flex: 1,
    textAlign: "center",
    color: theme.textMuted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    paddingBottom: spacing(0.5),
  },
  day: { flex: 1, aspectRatio: 1, alignItems: "center", justifyContent: "center" },
  dayTappable: { borderRadius: radius.pill },
  dayToday: { borderWidth: 1, borderColor: withAlpha(theme.accent, 0.5) },
  daySelected: { backgroundColor: theme.accent },
  pressed: { opacity: 0.6 },
  dayText: { color: theme.textPrimary, fontSize: fontSize.sm },
  dayTextSelected: { color: theme.primary, fontWeight: fontWeight.bold },
  dayTextDisabled: { color: withAlpha(theme.textMuted, 0.45) },
});
