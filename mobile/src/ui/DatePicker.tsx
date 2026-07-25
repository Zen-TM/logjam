import { Feather } from "@expo/vector-icons";
import { useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { fontSize, fontWeight, hitSlop, radius, spacing, theme, withAlpha } from "../theme";
import {
  addMonths,
  formatMonthLabel,
  monthGrid,
  monthOf,
  todayDateKey,
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
 * Navigation is by swipe as well as by the arrows (a grid you can page through
 * should page under the thumb), and the month label opens a year grid — a
 * logbook goes back years, and 40 taps on a chevron is not a way to reach 2019.
 *
 * Values are "YYYY-MM-DD" keys handled in UTC (see `monthGrid`). Future days
 * are disabled: a trip log records what has happened.
 */
const SWIPE_SLOP = 8;
const PAGE_MS = 130;
/** Years shown at once in the year grid — 16 covers a logbook's whole span. */
const YEAR_PAGE = 16;

export function DatePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (key: string) => void;
}) {
  const today = todayDateKey();
  const [visibleMonth, setVisibleMonth] = useState<YearMonth>(() =>
    monthOf(value ?? today),
  );
  const [pickingYear, setPickingYear] = useState(false);
  const [yearPageStart, setYearPageStart] = useState(
    () => monthOf(value ?? today).year - YEAR_PAGE + 1,
  );

  // Paging animation: the outgoing month slides off in the drag's direction,
  // then the incoming one is placed on the far side and slid to rest — so a
  // swipe and an arrow tap produce the same motion.
  const [width, setWidth] = useState(0);
  const pan = useRef(new Animated.Value(0)).current;
  const paging = useRef(false);
  const monthRef = useRef(visibleMonth);
  monthRef.current = visibleMonth;

  const page = (delta: number) => {
    if (paging.current) return;
    if (width === 0) {
      setVisibleMonth(addMonths(monthRef.current, delta));
      return;
    }
    paging.current = true;
    Animated.timing(pan, {
      toValue: -delta * width,
      duration: PAGE_MS,
      useNativeDriver: true,
    }).start(() => {
      setVisibleMonth(addMonths(monthRef.current, delta));
      pan.setValue(delta * width);
      Animated.timing(pan, {
        toValue: 0,
        duration: PAGE_MS,
        useNativeDriver: true,
      }).start(() => {
        paging.current = false;
      });
    });
  };

  const swipe = useRef(
    PanResponder.create({
      // Claim only on a clearly horizontal drag, so tapping a day and scrolling
      // the sheet vertically both still work.
      onMoveShouldSetPanResponder: (_event, gesture) =>
        Math.abs(gesture.dx) > SWIPE_SLOP && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderMove: (_event, gesture) => {
        if (!paging.current) pan.setValue(gesture.dx);
      },
      onPanResponderRelease: (_event, gesture) => {
        if (paging.current) return;
        const threshold = Math.max(48, widthRef.current * 0.22);
        if (gesture.dx <= -threshold) pageRef.current(1);
        else if (gesture.dx >= threshold) pageRef.current(-1);
        else Animated.spring(pan, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
      },
    }),
  ).current;
  // The responder is built once, so reach the current values through refs.
  const widthRef = useRef(width);
  widthRef.current = width;
  const pageRef = useRef(page);
  pageRef.current = page;

  if (pickingYear) {
    const years = Array.from({ length: YEAR_PAGE }, (_, index) => yearPageStart + index);
    return (
      <View style={styles.wrap}>
        <Header
          label={`${years[0]} – ${years[years.length - 1]}`}
          onPrev={() => setYearPageStart(yearPageStart - YEAR_PAGE)}
          onNext={() => setYearPageStart(yearPageStart + YEAR_PAGE)}
          onLabel={() => setPickingYear(false)}
          labelAccessibility="Back to the month grid"
        />
        <View style={styles.yearGrid}>
          {years.map((year) => {
            const disabled = year > Number(today.slice(0, 4));
            return (
              <Pressable
                key={year}
                accessibilityRole="button"
                accessibilityLabel={String(year)}
                accessibilityState={{
                  selected: year === visibleMonth.year,
                  disabled,
                }}
                disabled={disabled}
                onPress={() => {
                  setVisibleMonth({ year, month: visibleMonth.month });
                  setPickingYear(false);
                }}
                style={({ pressed }) => [
                  styles.yearCell,
                  year === visibleMonth.year && styles.daySelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.yearText,
                    year === visibleMonth.year && styles.dayTextSelected,
                    disabled && styles.dayTextDisabled,
                  ]}
                >
                  {year}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <Header
        label={formatMonthLabel(visibleMonth)}
        onPrev={() => page(-1)}
        onNext={() => page(1)}
        onLabel={() => {
          setYearPageStart(visibleMonth.year - YEAR_PAGE + 1);
          setPickingYear(true);
        }}
        labelAccessibility="Pick a year"
      />

      <View style={styles.week}>
        {WEEKDAY_INITIALS.map((initial, index) => (
          <Text key={index} style={styles.weekday}>
            {initial}
          </Text>
        ))}
      </View>

      {/* The grid is clipped to its own width so a paging month never paints
          over the sheet's padding on the way past. */}
      <View style={styles.viewport} {...swipe.panHandlers}>
        <Animated.View style={{ transform: [{ translateX: pan }] }}>
          {chunk(monthGrid(visibleMonth), 7).map((week, weekIndex) => (
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
        </Animated.View>
      </View>
    </View>
  );
}

function Header({
  label,
  onPrev,
  onNext,
  onLabel,
  labelAccessibility,
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  onLabel: () => void;
  labelAccessibility: string;
}) {
  return (
    <View style={styles.headerRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Previous"
        hitSlop={hitSlop}
        onPress={onPrev}
        style={({ pressed }) => [styles.nav, pressed && styles.pressed]}
      >
        <Feather name="chevron-left" size={20} color={theme.textPrimary} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={labelAccessibility}
        hitSlop={hitSlop}
        onPress={onLabel}
        style={({ pressed }) => [styles.labelButton, pressed && styles.pressed]}
      >
        <Text style={styles.label}>{label}</Text>
        <Feather name="chevron-down" size={14} color={theme.textMuted} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Next"
        hitSlop={hitSlop}
        onPress={onNext}
        style={({ pressed }) => [styles.nav, pressed && styles.pressed]}
      >
        <Feather name="chevron-right" size={20} color={theme.textPrimary} />
      </Pressable>
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
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: spacing(0.5),
  },
  nav: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  labelButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(0.5),
    paddingHorizontal: spacing(1),
    paddingVertical: spacing(0.5),
    borderRadius: radius.pill,
  },
  label: {
    color: theme.textPrimary,
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
  },
  viewport: { overflow: "hidden" },
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
  // 4x4 cells at 7:6 are exactly as tall as the six 1:1 day rows they replace,
  // so switching to the year grid barely moves the sheet's height.
  yearGrid: { flexDirection: "row", flexWrap: "wrap" },
  yearCell: {
    width: "25%",
    aspectRatio: 7 / 6,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
  },
  yearText: { color: theme.textPrimary, fontSize: fontSize.sm },
});
