// The download screen's area selector: a bright rectangle over a dimmed map,
// resized by dragging any of its four edges.
//
// Why EDGES and not corners: a corner drag is two coupled axes over the map's
// own pan gesture, and it can only make the shapes a corner reaches. An edge is
// one axis with nothing to anchor, so any aspect ratio is one drag away — tall
// and narrow for a creek line, wide and short for a plateau.
//
// The interior is `pointerEvents="none"`, so the map underneath keeps its own
// pan and pinch: coarse positioning is done by moving the MAP, and the handles
// only shape the box. The only touch targets on this overlay are the four bars.
import { useMemo, useRef } from "react";
import { PanResponder, StyleSheet, View } from "react-native";

import { radius, theme, withAlpha } from "../theme";
import { moveFrameEdge, type FrameEdge, type FrameInsets } from "./regionFrame";

/** Touch height of a handle; the visible bar is much thinner. */
const HANDLE_TOUCH = 44;
const HANDLE_LENGTH = 56;
const BAR_THICKNESS = 5;

export function SelectionFrame({
  insets,
  size,
  onChange,
}: {
  insets: FrameInsets;
  size: { width: number; height: number };
  onChange: (next: FrameInsets) => void;
}) {
  // Destructured: `size` is a fresh object on some renders, and the memo below
  // must not rebuild for that.
  const { width, height } = size;
  // The insets at the moment the finger went down. Deltas are measured from
  // there, so a slow drag can't accumulate rounding drift.
  const dragStart = useRef<FrameInsets>(insets);
  const latest = useRef<FrameInsets>(insets);
  latest.current = insets;

  // `onChange` goes through a ref, and the responders are memoised on the
  // SIZE alone.
  //
  // This is load-bearing. Rebuilding a PanResponder swaps the handler props on
  // the handle View, which detaches the native gesture mid-drag — the finger
  // keeps moving and the frame snaps back to its last committed value. Every
  // move calls `onChange`, so if the responders depended on that callback's
  // IDENTITY, a parent passing an inline arrow (`(next) => setFrame(...)`)
  // would rebuild them on every single frame of the gesture and the handles
  // would be impossible to drag. Which is exactly what happened.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const responders = useMemo(() => {
    const make = (edge: FrameEdge, axis: "x" | "y") =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          dragStart.current = latest.current;
        },
        onPanResponderMove: (_event, gesture) => {
          onChangeRef.current(
            moveFrameEdge(
              dragStart.current,
              edge,
              axis === "x" ? gesture.dx : gesture.dy,
              { width, height },
            ),
          );
        },
      });
    return {
      top: make("top", "y"),
      bottom: make("bottom", "y"),
      left: make("left", "x"),
      right: make("right", "x"),
    };
  }, [width, height]);

  const frameWidth = Math.max(0, width - insets.left - insets.right);
  const frameHeight = Math.max(0, height - insets.top - insets.bottom);
  const centreX = insets.left + frameWidth / 2;
  const centreY = insets.top + frameHeight / 2;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Four dim panels around the selection rather than one full-screen
          overlay with a hole: RN has no cut-out, and stacking a lighter view
          inside a dark one would dim the selection too. */}
      <View style={[styles.dim, { left: 0, right: 0, top: 0, height: insets.top }]} />
      <View style={[styles.dim, { left: 0, right: 0, bottom: 0, height: insets.bottom }]} />
      <View
        style={[
          styles.dim,
          { left: 0, width: insets.left, top: insets.top, height: frameHeight },
        ]}
      />
      <View
        style={[
          styles.dim,
          { right: 0, width: insets.right, top: insets.top, height: frameHeight },
        ]}
      />

      {/* The selection outline. Not a touch target — the map shows through it. */}
      <View
        pointerEvents="none"
        style={[
          styles.outline,
          {
            left: insets.left,
            top: insets.top,
            width: frameWidth,
            height: frameHeight,
          },
        ]}
      />

      <View
        {...responders.top.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel="Drag to move the top edge of the area"
        style={[
          styles.handleH,
          { left: centreX - HANDLE_LENGTH / 2, top: insets.top - HANDLE_TOUCH / 2 },
        ]}
      >
        <View style={styles.barH} />
      </View>
      <View
        {...responders.bottom.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel="Drag to move the bottom edge of the area"
        style={[
          styles.handleH,
          {
            left: centreX - HANDLE_LENGTH / 2,
            top: height - insets.bottom - HANDLE_TOUCH / 2,
          },
        ]}
      >
        <View style={styles.barH} />
      </View>
      <View
        {...responders.left.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel="Drag to move the left edge of the area"
        style={[
          styles.handleV,
          { top: centreY - HANDLE_LENGTH / 2, left: insets.left - HANDLE_TOUCH / 2 },
        ]}
      >
        <View style={styles.barV} />
      </View>
      <View
        {...responders.right.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel="Drag to move the right edge of the area"
        style={[
          styles.handleV,
          {
            top: centreY - HANDLE_LENGTH / 2,
            left: width - insets.right - HANDLE_TOUCH / 2,
          },
        ]}
      >
        <View style={styles.barV} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Deliberately a black scrim, like the sheet scrims: the dimmed area is
  // "not this", and a scheme tint over a map reads as a colour cast.
  dim: { position: "absolute", backgroundColor: "rgba(0,0,0,0.45)" },
  outline: {
    position: "absolute",
    borderWidth: 2,
    borderColor: theme.accent,
    borderRadius: radius.sm,
  },
  handleH: {
    position: "absolute",
    width: HANDLE_LENGTH,
    height: HANDLE_TOUCH,
    alignItems: "center",
    justifyContent: "center",
  },
  handleV: {
    position: "absolute",
    width: HANDLE_TOUCH,
    height: HANDLE_LENGTH,
    alignItems: "center",
    justifyContent: "center",
  },
  barH: {
    width: HANDLE_LENGTH,
    height: BAR_THICKNESS,
    borderRadius: radius.pill,
    backgroundColor: theme.accent,
    borderWidth: 1,
    borderColor: withAlpha(theme.textPrimary, 0.6),
  },
  barV: {
    width: BAR_THICKNESS,
    height: HANDLE_LENGTH,
    borderRadius: radius.pill,
    backgroundColor: theme.accent,
    borderWidth: 1,
    borderColor: withAlpha(theme.textPrimary, 0.6),
  },
});
