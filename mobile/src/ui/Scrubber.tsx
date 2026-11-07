import { useEffect, useRef, useState } from "react";
import { PanResponder, View } from "react-native";

import { makeStyles, radius } from "../theme";
import { stepAtX, xAtStep } from "./scrubberMath";

const THUMB = 24;
const HEIGHT = 48;
/** The track's width unless the caller has less room. */
export const SCRUBBER_WIDTH = 280;

/**
 * A slider over whole steps, `first` to `last` (a forecast's hours). The same
 * component as Logjam Web's `Scrubber`, a range input there. No slider
 * library is installed and a native one would need an APK build, so this is a
 * drag on a track. For a screen reader it is one adjustable control: swipe up
 * and down for the next step, `valueText` as its value, `label` its name.
 */
export function Scrubber({
  first,
  last,
  value,
  onChange,
  label,
  valueText,
  width = SCRUBBER_WIDTH,
}: {
  first: number;
  last: number;
  value: number;
  onChange: (next: number) => void;
  label: string;
  /** The step in words: what a screen reader reads. */
  valueText: string;
  /** Logjam GPS only: the track is drawn at a size, not stretched. */
  width?: number;
}) {
  const styles = useStyles();
  const latest = useRef({ first, last, width, onChange });
  useEffect(() => {
    latest.current = { first, last, width, onChange };
  });
  const startX = useRef(0);

  // eslint-disable-next-line react-hooks/refs -- create() only stores the handlers; they read refs on touch, never during render
  const [pan] = useState(() => {
    const move = (x: number) => {
      const l = latest.current;
      l.onChange(stepAtX(x, l.width, l.first, l.last));
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // The map under the bar must not take the drag off the thumb.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => {
        startX.current = event.nativeEvent.locationX;
        move(startX.current);
      },
      onPanResponderMove: (_event, gesture) =>
        move(startX.current + gesture.dx),
    });
  });

  const x = xAtStep(value, width, first, last);
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: valueText }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) => {
        const by = event.nativeEvent.actionName === "increment" ? 1 : -1;
        onChange(Math.min(last, Math.max(first, value + by)));
      }}
      style={[styles.hit, { width }]}
      {...pan.panHandlers}
    >
      {/* The children take no touches, so a touch's position is the track's. */}
      <View style={styles.track} pointerEvents="none" />
      <View style={[styles.done, { width: x }]} pointerEvents="none" />
      <View
        style={[styles.thumb, { left: x - THUMB / 2 }]}
        pointerEvents="none"
      />
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  hit: { height: HEIGHT, justifyContent: "center" },
  track: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 4,
    borderRadius: radius.sm,
    backgroundColor: theme.line,
  },
  done: {
    position: "absolute",
    left: 0,
    height: 4,
    borderRadius: radius.sm,
    backgroundColor: theme.accent,
  },
  thumb: {
    position: "absolute",
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: theme.accent,
    borderWidth: 2,
    borderColor: theme.card,
  },
}));
