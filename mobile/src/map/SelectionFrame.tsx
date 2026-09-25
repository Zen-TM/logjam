// The download screen's area selector: a bright rectangle over a dimmed map,
// resized by dragging any of its four edges.
//
// Why EDGES and not corners: a corner drag is two coupled axes over the map's
// own pan gesture, and it can only make the shapes a corner reaches. An edge is
// one axis with nothing to anchor, so any aspect ratio is one drag away — tall
// and narrow for a creek line, wide and short for a plateau.
//
// NOTHING on this overlay is a touch target except the four handle bars. The
// scrim panels and the outline are all `pointerEvents="none"`, so the map keeps
// its own pan and pinch EVERYWHERE, dimmed or not: coarse positioning is done
// by moving the map, and the handles only shape the box. Getting this wrong is
// subtle — the panels went a long time swallowing every touch outside the
// selection, which left the map draggable only through the bright rectangle and
// read as the screen being half frozen.
import { useMemo, useRef } from "react";
import { PanResponder, PixelRatio, StyleSheet, View } from "react-native";

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

  // Snap every edge to a whole DEVICE pixel before anything is laid out from
  // it. This is what keeps the four scrim panels from parting: Yoga rounds each
  // node's frame to the physical pixel grid independently, so two panels that
  // meet at a fractional coordinate can round to different sides of it and
  // leave a hairline of undimmed map between them. Rounded first, they meet
  // exactly and the rounding is a no-op.
  //
  // (The previous fix — one view whose BORDERS were the scrim — had no seam but
  // two worse faults: its bounds covered the selection as well, so the map
  // under it stopped panning and zooming, and RN miters adjacent borders, so
  // the four translucent edges double-painted at the corners and the scrim came
  // out darker there than along the sides.)
  const snap = PixelRatio.roundToNearestPixel;
  const boxWidth = snap(width);
  const boxHeight = snap(height);
  const insetTop = snap(insets.top);
  const insetLeft = snap(insets.left);
  const insetRight = snap(insets.right);
  const insetBottom = snap(insets.bottom);
  const frameWidth = Math.max(0, boxWidth - insetLeft - insetRight);
  const frameHeight = Math.max(0, boxHeight - insetTop - insetBottom);
  const frameBottom = insetTop + frameHeight;
  const frameRight = insetLeft + frameWidth;
  const centreX = insetLeft + frameWidth / 2;
  const centreY = insetTop + frameHeight / 2;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Four dim panels around the selection rather than one full-screen
          overlay with a hole: RN has no cut-out, and stacking a lighter view
          inside a dark one would dim the selection too.

          Every panel is positioned by left/top/width/height off the snapped
          numbers above — never by `bottom: 0` or `right: 0`, which is how the
          bottom panel used to reach the frame's lower edge by different
          arithmetic from the side panels and round away from them.

          `pointerEvents="none"` on every one of them, and it is load-bearing.
          The parent is `box-none`, which stops the parent being a touch target
          but leaves its CHILDREN as targets — so the panels were eating every
          touch that landed outside the selection, and the map could only be
          panned and pinched through the small bright rectangle in the middle.
          The scrim says "not this"; it should not also mean "not here". */}
      <View
        pointerEvents="none"
        style={[styles.dim, { left: 0, top: 0, width: boxWidth, height: insetTop }]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.dim,
          { left: 0, top: frameBottom, width: boxWidth, height: boxHeight - frameBottom },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.dim,
          { left: 0, top: insetTop, width: insetLeft, height: frameHeight },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.dim,
          { left: frameRight, top: insetTop, width: boxWidth - frameRight, height: frameHeight },
        ]}
      />

      {/* The selection outline. Not a touch target — the map shows through it. */}
      <View
        pointerEvents="none"
        style={[
          styles.outline,
          {
            left: insetLeft,
            top: insetTop,
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
          { left: centreX - HANDLE_LENGTH / 2, top: insetTop - HANDLE_TOUCH / 2 },
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
            top: frameBottom - HANDLE_TOUCH / 2,
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
          { top: centreY - HANDLE_LENGTH / 2, left: insetLeft - HANDLE_TOUCH / 2 },
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
            left: frameRight - HANDLE_TOUCH / 2,
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
  // "not this", and a scheme tint over a map reads as a colour cast. The four
  // panels never overlap, so the alpha composites exactly once everywhere —
  // any overlap would show as a darker band where two panels met.
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
