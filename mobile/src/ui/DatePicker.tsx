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
 * looking pickers on one screen. This is one themed surface reused three times,
 * and it needs no native dependency.
 *
 * Both grids page the same way — swipe or arrows, same animation — because
 * having one of them swipe and the other not is the kind of inconsistency you
 * feel without being able to name.
 *
 * The year grid runs NEWEST FIRST. A logbook is read backwards from now, so the
 * year you most likely want is the first cell rather than the last, and no cells
 * are spent on disabled future years.
 *
 * Values are "YYYY-MM-DD" keys handled in UTC (see `monthGrid`). Future days are
 * disabled: a trip log records what has happened.
 */
const SWIPE_SLOP = 8;
const PAGE_MS = 130;
const YEAR_COLUMNS = 4;
const YEAR_ROWS = 4;
const YEARS_PER_PAGE = YEAR_COLUMNS * YEAR_ROWS;

export function DatePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (key: string) => void;
}) {
  const today = todayDateKey();
  const currentYear = Number(today.slice(0, 4));
  const [visibleMonth, setVisibleMonth] = useState<YearMonth>(() =>
    monthOf(value ?? today),
  );
  const [pickingYear, setPickingYear] = useState(false);
  // The newest year on the visible page; the page runs down from it.
  const [yearPageTop, setYearPageTop] = useState(currentYear);

  const { width, onLayout, pan, page } = usePager();

  const changeMonth = (delta: number) =>
    page(delta, () => setVisibleMonth((current) => addMonths(current, delta)));

  const changeYearPage = (delta: number) =>
    page(delta, () =>
      // delta +1 means "forward in time", which is UP the descending list.
      setYearPageTop((current) =>
        Math.min(currentYear, current + delta * YEARS_PER_PAGE),
      ),
    );

  const swipe = useRef(
    PanResponder.create({
      // Claim only on a clearly horizontal drag, so tapping a cell and scrolling
      // the sheet vertically both still work.
      onMoveShouldSetPanResponder: (_event, gesture) =>
        Math.abs(gesture.dx) > SWIPE_SLOP && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderMove: (_event, gesture) => pan.setValue(gesture.dx),
      onPanResponderRelease: (_event, gesture) => {
        const threshold = Math.max(48, widthRef.current * 0.22);
        if (gesture.dx <= -threshold) forwardRef.current(1);
        else if (gesture.dx >= threshold) forwardRef.current(-1);
        else {
          Animated.spring(pan, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
          }).start();
        }
      },
    }),
  ).current;
  // The responder is built once, so reach current values through refs.
  const widthRef = useRef(width);
  widthRef.current = width;
  const forwardRef = useRef(changeMonth);
  forwardRef.current = pickingYear ? changeYearPage : changeMonth;

  const years = Array.from({ length: YEARS_PER_PAGE }, (_, i) => yearPageTop - i);
  const oldest = years[years.length - 1];

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <Header
        label={pickingYear ? `${oldest} – ${yearPageTop}` : formatMonthLabel(visibleMonth)}
        // "Back" is always older, in both grids.
        onPrev={() => (pickingYear ? changeYearPage(-1) : changeMonth(-1))}
        onNext={() => (pickingYear ? changeYearPage(1) : changeMonth(1))}
        nextDisabled={pickingYear && yearPageTop >= currentYear}
        onLabel={() => {
          if (!pickingYear) setYearPageTop(Math.min(currentYear, visibleMonth.year));
          setPickingYear(!pickingYear);
        }}
        labelAccessibility={pickingYear ? "Back to the month grid" : "Pick a year"}
        expanded={pickingYear}
      />

      {pickingYear ? null : (
        <View style={styles.week}>
          {WEEKDAY_INITIALS.map((initial, index) => (
            <Text key={index} style={styles.weekday}>
              {initial}
            </Text>
          ))}
        </View>
      )}

      {/* Clipped to its own width so a paging grid never paints over the sheet's
          padding on the way past. */}
      <View style={styles.viewport} {...swipe.panHandlers}>
        <Animated.View style={{ transform: [{ translateX: pan }] }}>
          {pickingYear ? (
            <View style={styles.yearGrid}>
              {years.map((year) => (
                <YearCell
                  key={year}
                  year={year}
                  selected={year === visibleMonth.year}
                  isCurrent={year === currentYear}
                  onPress={() => {
                    setVisibleMonth((current) => ({ year, month: current.month }));
                    setPickingYear(false);
                  }}
                />
              ))}
            </View>
          ) : (
            chunk(monthGrid(visibleMonth), 7).map((week, weekIndex) => (
              <View key={weekIndex} style={styles.week}>
                {week.map((key, dayIndex) => {
                  if (key === null) return <View key={dayIndex} style={styles.day} />;
                  return (
                    <DayCell
                      key={dayIndex}
                      dateKey={key}
                      selected={key === value}
                      isToday={key === today}
                      disabled={key > today}
                      onPress={() => onChange(key)}
                    />
                  );
                })}
              </View>
            ))
          )}
        </Animated.View>
      </View>
    </View>
  );
}

/**
 * Shared paging animation: the outgoing grid slides off in the gesture's
 * direction, the incoming one is placed on the far side and slid to rest.
 */
function usePager() {
  const [width, setWidth] = useState(0);
  const pan = useRef(new Animated.Value(0)).current;
  const paging = useRef(false);
  const widthRef = useRef(0);
  widthRef.current = width;

  const page = (delta: number, commit: () => void) => {
    if (paging.current) return;
    if (widthRef.current === 0) {
      commit();
      return;
    }
    paging.current = true;
    Animated.timing(pan, {
      toValue: -delta * widthRef.current,
      duration: PAGE_MS,
      useNativeDriver: true,
    }).start(() => {
      commit();
      pan.setValue(delta * widthRef.current);
      Animated.timing(pan, {
        toValue: 0,
        duration: PAGE_MS,
        useNativeDriver: true,
      }).start(() => {
        paging.current = false;
      });
    });
  };

  return {
    width,
    pan,
    page,
    onLayout: (event: { nativeEvent: { layout: { width: number } } }) =>
      setWidth(event.nativeEvent.layout.width),
  };
}

function DayCell({
  dateKey,
  selected,
  isToday,
  disabled,
  onPress,
}: {
  dateKey: string;
  selected: boolean;
  isToday: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={dateKey}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.day}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.dayPill,
            isToday && styles.todayRing,
            selected && styles.selectedFill,
            pressed && styles.pressed,
          ]}
        >
          <Text
            style={[
              styles.dayText,
              selected && styles.selectedText,
              disabled && styles.disabledText,
            ]}
          >
            {Number(dateKey.slice(8))}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

/**
 * The highlight hugs the number rather than filling the grid cell — a pill as
 * wide as a quarter-row reads as a misaligned bar, not as "this year".
 */
function YearCell({
  year,
  selected,
  isCurrent,
  onPress,
}: {
  year: number;
  selected: boolean;
  isCurrent: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={String(year)}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={styles.yearCell}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.yearPill,
            isCurrent && styles.todayRing,
            selected && styles.selectedFill,
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.yearText, selected && styles.selectedText]}>{year}</Text>
        </View>
      )}
    </Pressable>
  );
}

function Header({
  label,
  onPrev,
  onNext,
  nextDisabled = false,
  onLabel,
  labelAccessibility,
  expanded,
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
  onLabel: () => void;
  labelAccessibility: string;
  expanded: boolean;
}) {
  return (
    <View style={styles.headerRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Earlier"
        hitSlop={hitSlop}
        onPress={onPrev}
        style={({ pressed }) => [styles.nav, pressed && styles.pressed]}
      >
        <Feather name="chevron-left" size={20} color={theme.textPrimary} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={labelAccessibility}
        accessibilityState={{ expanded }}
        hitSlop={hitSlop}
        onPress={onLabel}
        style={({ pressed }) => [styles.labelButton, pressed && styles.pressed]}
      >
        <Text style={styles.label}>{label}</Text>
        <Feather
          name={expanded ? "chevron-up" : "chevron-down"}
          size={14}
          color={theme.textMuted}
        />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Later"
        accessibilityState={{ disabled: nextDisabled }}
        disabled={nextDisabled}
        hitSlop={hitSlop}
        onPress={onNext}
        style={({ pressed }) => [
          styles.nav,
          pressed && styles.pressed,
          nextDisabled && styles.disabledNav,
        ]}
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
  disabledNav: { opacity: 0.3 },
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
  // Pill sized to the glyph and centred in its cell, not filling it.
  dayPill: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  todayRing: { borderWidth: 1, borderColor: withAlpha(theme.accent, 0.5) },
  selectedFill: { backgroundColor: theme.accent },
  pressed: { opacity: 0.6 },
  dayText: { color: theme.textPrimary, fontSize: fontSize.sm },
  selectedText: { color: theme.primary, fontWeight: fontWeight.bold },
  disabledText: { color: withAlpha(theme.textMuted, 0.45) },
  // Four rows of four, sized to match the six day rows so switching grids
  // barely moves the sheet's height.
  yearGrid: { flexDirection: "row", flexWrap: "wrap" },
  yearCell: {
    width: `${100 / YEAR_COLUMNS}%`,
    aspectRatio: (7 / YEAR_COLUMNS) * (YEAR_ROWS / 6),
    alignItems: "center",
    justifyContent: "center",
  },
  yearPill: {
    paddingHorizontal: spacing(1.25),
    paddingVertical: spacing(0.75),
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  yearText: { color: theme.textPrimary, fontSize: fontSize.sm },
});
