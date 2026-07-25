import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { fontSize, fontWeight, radius, spacing, surface, theme, withAlpha } from "../theme";

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
  /** Optional tally rendered as a trailing badge (filter rails). */
  count?: number;
  /** Optional identity hue — tints the chip's border/label when active. */
  hue?: string;
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
  const chips = options.map((option) => {
    const active = option.value === value;
    const tint = option.hue ?? theme.accent;
    return (
      <Pressable
        key={option.value}
        accessibilityRole="button"
        accessibilityState={{ selected: active, disabled: option.disabled }}
        disabled={option.disabled}
        onPress={() => onChange(option.value)}
        style={({ pressed }) => [
          styles.chip,
          active && { backgroundColor: tint, borderColor: tint },
          pressed && styles.chipPressed,
          option.disabled && styles.chipDisabled,
        ]}
      >
        <Text
          style={[
            styles.label,
            active && styles.labelActive,
            option.disabled && styles.labelDisabled,
          ]}
        >
          {option.label}
        </Text>
        {option.count != null ? (
          <View style={[styles.badge, active && styles.badgeActive]}>
            <Text style={[styles.badgeText, active && styles.badgeTextActive]}>
              {option.count}
            </Text>
          </View>
        ) : null}
      </Pressable>
    );
  });

  if (!scroll) return <View style={styles.group}>{chips}</View>;
  return <Rail value={value}>{chips}</Rail>;
}

// A rail keeps the selected chip in view. Selection can change from outside the
// rail (an import lands, a rename jumps to that category); leaving the active
// chip scrolled off makes the list below look unfiltered.
function Rail<T extends string>({
  value,
  children,
}: {
  value: T;
  children: React.ReactNode[];
}) {
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef(new Map<number, number>());
  const childArray = children as React.ReactElement<{ children?: unknown }>[];
  const activeIndex = childArray.findIndex((chip) => chip.key === String(value));
  // Which ends have content beyond them — each edge only fades when there is
  // something to scroll to, so at rest the first chip isn't dimmed by a fade
  // over nothing.
  const [overflow, setOverflow] = useState({ start: false, end: false });

  useEffect(() => {
    const x = offsets.current.get(activeIndex);
    if (x == null) return;
    scrollRef.current?.scrollTo({ x: Math.max(0, x - spacing(2)), animated: true });
  }, [activeIndex]);

  const trackOverflow = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
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
        onContentSizeChange={() =>
          // Seed the end fade before any scroll happens.
          setOverflow((current) => (current.end ? current : { ...current, end: true }))
        }
        scrollEventThrottle={16}
      >
        {childArray.map((chip, index) => (
          <View
            key={chip.key}
            onLayout={(event) => offsets.current.set(index, event.nativeEvent.layout.x)}
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
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(0.75),
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: surface.border,
    backgroundColor: surface.card,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.75),
    minHeight: 36,
  },
  chipPressed: { opacity: 0.75 },
  chipDisabled: { opacity: 0.4 },
  label: { color: theme.textPrimary, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  labelActive: { color: theme.primary },
  labelDisabled: { color: theme.textMuted },
  badge: {
    minWidth: 20,
    paddingHorizontal: spacing(0.5),
    borderRadius: radius.pill,
    backgroundColor: withAlpha(theme.textPrimary, 0.12),
    alignItems: "center",
  },
  badgeActive: { backgroundColor: withAlpha(theme.primary, 0.2) },
  badgeText: { color: theme.textMuted, fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  badgeTextActive: { color: theme.primary },
});
