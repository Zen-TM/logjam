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
  yearBlockStart,
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
 * The year grid pages in FIXED 20-year blocks aligned to a multiple of 20, so
 * a given year is always in the same place. Both grids page freely into the
 * future; the cells there are simply disabled, because a swipe that refuses to
 * move is indistinguishable from a broken one.
 *
 * Values are "YYYY-MM-DD" keys handled in UTC (see `monthGrid`). Future days are
 * disabled: a trip log records what has happened.
 */
const SWIPE_SLOP = 8;
const PAGE_MS = 130;
/** Day pill box; the radius is exactly half of this — see the style comment. */
const DAY_PILL_SIZE = 36;
const YEAR_COLUMNS = 4;
const YEAR_ROWS = 5;
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
  // First year of the visible 20-year block.
  const [yearPageStart, setYearPageStart] = useState(() => yearBlockStart(currentYear, YEARS_PER_PAGE));

  const { width, onLayout, pan, page, pagingRef } = usePager();

  const changeMonth = (delta: number) =>
    page(delta, () => setVisibleMonth((current) => addMonths(current, delta)));

  // Unclamped in both directions. Paging into the future lands on a block of
  // disabled years, which is honest; refusing to move at all just looks broken.
  const changeYearPage = (delta: number) =>
    page(delta, () => setYearPageStart((current) => current + delta * YEARS_PER_PAGE));

  const swipe = useRef(
    PanResponder.create({
      // CAPTURE, not bubble. A disabled cell still swallows the touch on the way
      // down, so a bubbling responder never sees a swipe that starts over one —
      // which made a future month (every day disabled) and the future half of a
      // year page completely unswipeable while the arrows still worked.
      // Capturing claims the gesture before any child, and the predicate keeps
      // taps and vertical sheet scrolling working.
      onMoveShouldSetPanResponderCapture: (_event, gesture) =>
        Math.abs(gesture.dx) > SWIPE_SLOP && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      // Never hand the gesture back mid-swipe: a terminated drag skips
      // onPanResponderRelease, leaving the grid translated off-screen with no
      // way back — which reads as "swiping stopped working".
      onPanResponderTerminationRequest: () => false,
      onPanResponderTerminate: () => {
        Animated.spring(pan, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
      },
      // Ignore drags while a page animation is running: writing to `pan`
      // mid-flight interrupts it, and an interrupted animation can leave the
      // in-progress flag set, which would block every later page.
      onPanResponderMove: (_event, gesture) => {
        if (!pagingRef.current) pan.setValue(gesture.dx);
      },
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

  const years = Array.from({ length: YEARS_PER_PAGE }, (_, i) => yearPageStart + i);

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <Header
        label={
          pickingYear
            ? `${yearPageStart} – ${yearPageStart + YEARS_PER_PAGE - 1}`
            : formatMonthLabel(visibleMonth)
        }
        // "Back" is always older, in both grids.
        onPrev={() => (pickingYear ? changeYearPage(-1) : changeMonth(-1))}
        onNext={() => (pickingYear ? changeYearPage(1) : changeMonth(1))}
        onLabel={() => {
          if (!pickingYear) setYearPageStart(yearBlockStart(visibleMonth.year, YEARS_PER_PAGE));
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
      {/* `collapsable={false}` matters on Android: a View whose children are all
          plain layout Views (an all-in-the-future month, where every cell is
          inert) gets optimised out of the native hierarchy, and the touch then
          never reaches this responder at all — the grid became unswipeable
          exactly when nothing in it was pressable. */}
      <View
        style={styles.viewport}
        collapsable={false}
        {...swipe.panHandlers}
      >
        <Animated.View style={{ transform: [{ translateX: pan }] }}>
          {pickingYear ? (
            // Explicit rows rather than flex-wrap: wrapped cells size
            // themselves independently, which left the first row's pills
            // sitting at slightly different heights.
            chunk(years, YEAR_COLUMNS).map((row, rowIndex) => (
              <View key={rowIndex} style={styles.yearRow}>
                {row.map((year) => (
                  <YearCell
                    key={year}
                    year={year}
                    selected={year === visibleMonth.year}
                    isCurrent={year === currentYear}
                    disabled={year > currentYear}
                    onPress={() => {
                      setVisibleMonth((current) => ({ year, month: current.month }));
                      setPickingYear(false);
                    }}
                  />
                ))}
              </View>
            ))
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
      // Belt and braces: if that second animation is interrupted its callback
      // may never run, and a stuck flag silently disables paging forever.
      setTimeout(() => {
        paging.current = false;
      }, PAGE_MS * 3);
    });
  };

  return {
    width,
    pan,
    page,
    pagingRef: paging,
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
  const label = (
    <Text style={[styles.dayText, selected && styles.selectedText, disabled && styles.disabledText]}>
      {Number(dateKey.slice(8))}
    </Text>
  );

  // An unavailable cell stays a Pressable with a no-op press — it must NOT use
  // the `disabled` prop, and must not become a plain View.
  //
  // Both alternatives break the swipe that pages the grid, for the same
  // underlying reason: RN's touch dispatch looks for a JS touch target under
  // the finger, and an inert View isn't one. In a month entirely in the future
  // EVERY cell is unavailable, so nothing under the finger was a target, the
  // gesture went to the sheet's native ScrollView, and the pan responder was
  // never consulted — the grid became unswipeable exactly when nothing in it
  // was pressable. Keeping them pressable keeps the responder chain alive;
  // `accessibilityState` still announces them as unavailable.
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={dateKey}
      accessibilityState={{ selected, disabled }}
      onPress={disabled ? noop : onPress}
      style={styles.day}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.dayPill,
            isToday && styles.todayRing,
            selected && styles.selectedFill,
            pressed && !disabled && styles.pressed,
          ]}
        >
          {label}
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
  disabled,
  onPress,
}: {
  year: number;
  selected: boolean;
  isCurrent: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const label = (
    <Text style={[styles.yearText, selected && styles.selectedText, disabled && styles.disabledText]}>
      {year}
    </Text>
  );

  // Pressable with a no-op press when unavailable — see DayCell for why an
  // inert View here would break paging.
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={String(year)}
      accessibilityState={{ selected, disabled }}
      onPress={disabled ? noop : onPress}
      style={styles.yearCell}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.yearPill,
            isCurrent && styles.todayRing,
            selected && styles.selectedFill,
            pressed && !disabled && styles.pressed,
          ]}
        >
          {label}
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

function noop(): void {}

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
  viewport: { overflow: "hidden", backgroundColor: "transparent" },
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
  //
  // Two Android-specific details, both learned the hard way: the radius is
  // exactly half the box rather than `radius.pill`'s 999, and the background is
  // always set (transparent when unselected) instead of appearing only on the
  // selected state. RN Android draws corner radii through the view's background
  // drawable, so a cell that gains a background AFTER it was first laid out —
  // which is what happens when the grid pages away and back and React reuses
  // the same cell for a different date — could come back square.
  dayPill: {
    width: DAY_PILL_SIZE,
    height: DAY_PILL_SIZE,
    borderRadius: DAY_PILL_SIZE / 2,
    backgroundColor: "transparent",
    overflow: "hidden",
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
  yearRow: { flexDirection: "row" },
  yearCell: {
    flex: 1,
    // Five rows of these match the six 1:1 day rows, so switching grids barely
    // moves the sheet's height.
    aspectRatio: (7 / YEAR_COLUMNS) * (YEAR_ROWS / 6),
    alignItems: "center",
    justifyContent: "center",
  },
  yearPill: {
    paddingHorizontal: spacing(1.25),
    paddingVertical: spacing(0.75),
    borderRadius: radius.pill,
    // Same reason as dayPill: keep the background drawable present from the
    // first layout so paging back to a selected year can't lose its rounding.
    backgroundColor: "transparent",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  yearText: { color: theme.textPrimary, fontSize: fontSize.sm },
});
