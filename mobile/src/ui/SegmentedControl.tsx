import { useEffect, useRef, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import type { Feather } from "@expo/vector-icons";

import { spacing, theme, withAlpha } from "../theme";
import { Chip, CHIP_HEIGHT } from "./Chip";

// A single-line (`scroll`) control is exactly one chip tall — re-exported so
// a bar replacing it in the same slot (Saved's multi-select bar, item A) can
// match without a second hand-kept number.
export const SEGMENTED_CONTROL_HEIGHT = CHIP_HEIGHT;

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
  /** Optional tally rendered as a trailing badge (filter rails). */
  count?: number;
  /** Optional identity hue — tints the chip's border/label when active. */
  hue?: string;
  /** Optional leading glyph, for a rail whose options have a kind. */
  icon?: React.ComponentProps<typeof Feather>["name"];
};

// Chip group for a single-select choice (basemap picker, filters, category
// rails). Chips are fully rounded; the active one is filled with its `hue`
// (default accent) and a `count` rides along as a trailing badge.
//
// Layout: wraps by default so every option is visible at once. Pass
// `scroll` for a one-line horizontal rail — use it when the options are a
// filter over a list below (a rail reads as "pick a view", a wrapped block
// reads as "pick a setting") and the count can grow.
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  scroll = false,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (next: T) => void;
  scroll?: boolean;
}) {
  const chips = options.map((option) => (
    <Chip
      key={option.value}
      label={option.label}
      active={option.value === value}
      disabled={option.disabled}
      hue={option.hue}
      icon={option.icon}
      count={option.count}
      onPress={() => onChange(option.value)}
    />
  ));

  if (!scroll) return <View style={styles.group}>{chips}</View>;
  return <Rail value={value}>{chips}</Rail>;
}

// A rail brings the selected chip into view ONLY when it is entirely off
// screen. Selection can change from outside the rail (an import lands, a rename
// jumps to that category), and an active chip scrolled out of sight makes the
// list below look unfiltered. A chip the user just TAPPED is on screen by
// definition, so a tap never moves the rail: pinning every tapped chip to the
// left edge scrolled away the neighbour the user was about to tap next.
function Rail<T extends string>({
  value,
  children,
}: {
  value: T;
  children: React.ReactNode[];
}) {
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef(new Map<number, { x: number; width: number }>());
  const viewport = useRef({ x: 0, width: 0 });
  const childArray = children as React.ReactElement<{ children?: unknown }>[];
  const activeIndex = childArray.findIndex((chip) => chip.key === String(value));
  // Which ends have content beyond them — each edge only fades when there is
  // something to scroll to, so at rest the first chip isn't dimmed by a fade
  // over nothing.
  const [overflow, setOverflow] = useState({ start: false, end: false });

  useEffect(() => {
    const chip = offsets.current.get(activeIndex);
    if (chip == null) return;
    const { x, width } = viewport.current;
    if (chip.x + chip.width <= x) {
      scrollRef.current?.scrollTo({ x: Math.max(0, chip.x - spacing(2)), animated: true });
    } else if (chip.x >= x + width) {
      // Clear of the end fade, not merely under it.
      scrollRef.current?.scrollTo({ x: chip.x + chip.width - width + spacing(6), animated: true });
    }
  }, [activeIndex]);

  const trackOverflow = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    viewport.current = { x: contentOffset.x, width: layoutMeasurement.width };
    const start = contentOffset.x > 1;
    const end = contentOffset.x + layoutMeasurement.width < contentSize.width - 1;
    setOverflow((current) =>
      current.start === start && current.end === end ? current : { start, end },
    );
  };

  return (
    <View>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rail}
        onScroll={trackOverflow}
        onLayout={(event) => {
          viewport.current = { ...viewport.current, width: event.nativeEvent.layout.width };
        }}
        onContentSizeChange={() =>
          // Seed the end fade before any scroll happens.
          setOverflow((current) => (current.end ? current : { ...current, end: true }))
        }
        scrollEventThrottle={16}
      >
        {childArray.map((chip, index) => (
          <View
            key={chip.key}
            onLayout={(event) => {
              const { x, width } = event.nativeEvent.layout;
              offsets.current.set(index, { x, width });
            }}
          >
            {chip}
          </View>
        ))}
      </ScrollView>
      {overflow.start ? <EdgeFade side="start" /> : null}
      {overflow.end ? <EdgeFade side="end" /> : null}
    </View>
  );
}

// Scrollability cue: an overflowing edge dissolves into the page colour rather
// than slicing a chip in half. Without it a rail whose chips happen to end
// flush at the screen edge looks like the complete set.
function EdgeFade({ side }: { side: "start" | "end" }) {
  const solid = side === "end";
  return (
    <LinearGradient
      style={[styles.fade, solid ? styles.fadeEnd : styles.fadeStart]}
      pointerEvents="none"
      colors={
        solid
          ? [withAlpha(theme.primary, 0), theme.primary]
          : [theme.primary, withAlpha(theme.primary, 0)]
      }
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
    />
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
  // The trailing pad lets the last chip clear the fade instead of sitting under it.
  rail: { flexDirection: "row", gap: spacing(1), paddingRight: spacing(6) },
  fade: { position: "absolute", top: 0, bottom: 0, width: spacing(6) },
  fadeStart: { left: 0 },
  fadeEnd: { right: 0 },
});
