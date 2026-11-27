import { useEffect, useRef, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { makeStyles, muted, spacing, withAlpha, useTheme } from "../theme";
import { Chip, CHIP_HEIGHT, type ChipOption } from "./Chip";
import { railNudge } from "./railNudge";

// A single-line (`scroll`) control is exactly one chip tall — re-exported so
// a bar replacing it in the same slot (Saved's multi-select bar) can
// match without a second hand-kept number.
export const CHIP_RAIL_HEIGHT = CHIP_HEIGHT;

// Chip group for a single-select choice (basemap picker, filters, category
// rails). Chips are fully rounded; the active one is filled with its `hue`
// (default accent) and a `count` rides along as a trailing badge.
//
// Layout: wraps by default so every option is visible at once. Pass
// `scroll` for a one-line horizontal rail — use it when the options are a
// filter over a list below (a rail reads as "pick a view", a wrapped block
// reads as "pick a setting") and the count can grow.
//
// `trailing` is drawn after the options, inside the scroller (an "add" chip: a
// `Chip` with `dashed`). It is an action, not an option, so it is never the
// value and never nudged into view — the same prop as Logjam Web's.
export function ChipRail<T extends string>({
  options,
  value,
  onChange,
  scroll = false,
  trailing,
  label,
  hint,
}: {
  options: ChipOption<T>[];
  value: T;
  onChange: (next: T) => void;
  scroll?: boolean;
  trailing?: React.ReactNode;
  /** The group's accessible name, as Logjam Web's rail has. */
  label?: string;
  /** One plain sentence about the choice (why a chip is off), drawn under the
   *  rail; a screen reader reaches it as text, as Field's and ChipPicker's. */
  hint?: string;
}) {
  const hintStyles = useHintStyles();
  const hintLine = hint ? <Text style={hintStyles.hint}>{hint}</Text> : null;
  const chips = options.map((option) => (
    <Chip
      key={option.value}
      label={option.label}
      active={option.value === value}
      disabled={option.disabled}
      hue={option.hue}
      icon={option.icon}
      count={option.count}
      choice="single"
      onPress={() => onChange(option.value)}
    />
  ));

  if (!scroll)
    return (
      <View accessibilityRole="radiogroup" accessibilityLabel={label}>
        <View style={styles.group}>
          {chips}
          {trailing}
        </View>
        {hintLine}
      </View>
    );
  return (
    <Rail value={value} trailing={trailing} label={label} hint={hint}>
      {chips}
    </Rail>
  );
}

// A rail moves only as far as it must to show the selected chip WHOLE, and not
// at all when it already is. Selection can change from outside the rail (an
// import lands, a rename jumps to that category), and an active chip out of
// sight makes the list below look unfiltered; a tapped chip half under an edge
// fade reads as cut off. Pinning every selected chip to the left edge scrolls
// away the neighbour the user is about to tap next, so the nudge is minimal.
function Rail<T extends string>({
  value,
  children,
  trailing,
  label,
  hint,
}: {
  value: T;
  children: React.ReactNode[];
  trailing?: React.ReactNode;
  label?: string;
  hint?: string;
}) {
  const hintStyles = useHintStyles();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const offsets = useRef(new Map<number, { x: number; width: number }>());
  const viewport = useRef({ x: 0, width: 0 });
  const childArray = children as React.ReactElement<{ children?: unknown }>[];
  const activeIndex = childArray.findIndex(
    (chip) => chip.key === String(value),
  );
  // Which ends have content beyond them — each edge only fades when there is
  // something to scroll to, so at rest the first chip isn't dimmed by a fade
  // over nothing.
  const [overflow, setOverflow] = useState({ start: false, end: false });

  // The selection already brought into view. The effect below runs before the
  // chips and the rail have been laid out, so it cannot nudge on first mount:
  // each `onLayout` calls this too, and it acts once layout is known, once per
  // selection.
  const nudged = useRef<number | null>(null);
  const nudge = () => {
    if (nudged.current === activeIndex) return;
    const to = railNudge(
      offsets.current.get(activeIndex),
      viewport.current,
      FADE_WIDTH,
    );
    if (to === undefined) return;
    // Not animated for the first selection: the rail opens already there.
    const animated = nudged.current !== null;
    nudged.current = activeIndex;
    if (to !== null) scrollRef.current?.scrollTo({ x: to, animated });
  };
  useEffect(nudge, [activeIndex]);

  const trackOverflow = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    viewport.current = { x: contentOffset.x, width: layoutMeasurement.width };
    const start = contentOffset.x > 1;
    const end =
      contentOffset.x + layoutMeasurement.width < contentSize.width - 1;
    setOverflow((current) =>
      current.start === start && current.end === end ? current : { start, end },
    );
  };

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label}>
      {/* The fades' containing block is the chip row alone, so they never
          reach the hint under it. Guard: kit.test.ts. */}
      <View>
        <ScrollView
          ref={scrollRef}
          horizontal
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.rail}
          onScroll={trackOverflow}
          onLayout={(event) => {
            viewport.current = {
              ...viewport.current,
              width: event.nativeEvent.layout.width,
            };
            nudge();
          }}
          onContentSizeChange={() =>
            // Seed the end fade before any scroll happens.
            setOverflow((current) =>
              current.end ? current : { ...current, end: true },
            )
          }
          scrollEventThrottle={16}
        >
          {childArray.map((chip, index) => (
            <View
              key={chip.key}
              onLayout={(event) => {
                const { x, width } = event.nativeEvent.layout;
                offsets.current.set(index, { x, width });
                nudge();
              }}
            >
              {chip}
            </View>
          ))}
          {trailing}
        </ScrollView>
        {overflow.start ? <EdgeFade side="start" /> : null}
        {overflow.end ? <EdgeFade side="end" /> : null}
      </View>
      {hint ? <Text style={hintStyles.hint}>{hint}</Text> : null}
    </View>
  );
}

// Scrollability cue: an overflowing edge dissolves into the page colour rather
// than slicing a chip in half. Without it a rail whose chips happen to end
// flush at the screen edge looks like the complete set.
function EdgeFade({ side }: { side: "start" | "end" }) {
  const theme = useTheme();

  const solid = side === "end";
  return (
    <LinearGradient
      style={[styles.fade, solid ? styles.fadeEnd : styles.fadeStart]}
      pointerEvents="none"
      colors={
        solid
          ? [withAlpha(theme.page, 0), theme.page]
          : [theme.page, withAlpha(theme.page, 0)]
      }
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
    />
  );
}

const FADE_WIDTH = spacing(6);

const useHintStyles = makeStyles((theme, textRole) => ({
  hint: { ...muted(theme, textRole.detail), marginTop: spacing(0.5) },
}));

const styles = StyleSheet.create({
  group: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
  // The trailing pad lets the last chip clear the fade instead of sitting under it.
  rail: { flexDirection: "row", gap: spacing(1), paddingRight: FADE_WIDTH },
  fade: { position: "absolute", top: 0, bottom: 0, width: FADE_WIDTH },
  fadeStart: { left: 0 },
  fadeEnd: { right: 0 },
});
