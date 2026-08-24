import { describe, expect, it } from "vitest";

import {
  ANCHOR_GRAB_DP,
  ANCHOR_TAP_SLOP_DP,
  anchorIndexAtPress,
  dragIsTap,
  pressIsOnAnchor,
} from "./anchorHit";
import { degreesPerDp } from "./scaleBar";

// Zoom 15-ish: about 2.1e-5 degrees per DP. The exact value does not matter to
// these cases, only that the tolerance scales with it.
const DEGREES_PER_PIXEL = degreesPerDp(15);
const TOLERANCE = DEGREES_PER_PIXEL * ANCHOR_GRAB_DP;

const ANCHORS: [number, number][] = [
  [150.4033, -33.5603],
  [150.4083, -33.5653],
];

describe("pressIsOnAnchor", () => {
  it("catches the press that starts a drag", () => {
    // The device repro: press-and-hold lands on an anchor, MLRN 11 forwards it
    // to the map's onLongPress, and without this the map inserts a point there.
    expect(pressIsOnAnchor(ANCHORS, [150.4033, -33.5603], DEGREES_PER_PIXEL)).toBe(
      true,
    );
  });

  it("catches a press a few pixels off — a thumb is not a pixel", () => {
    const nudged: [number, number] = [
      ANCHORS[0][0] + TOLERANCE * 0.5,
      ANCHORS[0][1] - TOLERANCE * 0.5,
    ];
    expect(pressIsOnAnchor(ANCHORS, nudged, DEGREES_PER_PIXEL)).toBe(true);
  });

  it("lets a press on the line between anchors through", () => {
    // This is the gesture the insert exists for; breaking it would trade one
    // bug for another.
    const midpoint: [number, number] = [
      (ANCHORS[0][0] + ANCHORS[1][0]) / 2,
      (ANCHORS[0][1] + ANCHORS[1][1]) / 2,
    ];
    expect(pressIsOnAnchor(ANCHORS, midpoint, DEGREES_PER_PIXEL)).toBe(false);
  });

  it("checks every anchor, not just the first", () => {
    expect(pressIsOnAnchor(ANCHORS, ANCHORS[1], DEGREES_PER_PIXEL)).toBe(true);
  });

  it("scales with zoom: the same gap is a hit zoomed out and a miss zoomed in", () => {
    const gap: [number, number] = [
      ANCHORS[0][0] + TOLERANCE * 0.8,
      ANCHORS[0][1],
    ];
    expect(pressIsOnAnchor(ANCHORS, gap, DEGREES_PER_PIXEL)).toBe(true);
    expect(pressIsOnAnchor(ANCHORS, gap, DEGREES_PER_PIXEL / 4)).toBe(false);
  });

  it("has nothing to hit on an empty draft", () => {
    expect(pressIsOnAnchor([], [150.4, -33.5], DEGREES_PER_PIXEL)).toBe(false);
  });
});

describe("anchorIndexAtPress", () => {
  it("names the anchor the finger landed on", () => {
    // The tap path: this is what turns a press into a SELECTED point instead of
    // a duplicate vertex stacked on the one the user aimed at.
    expect(anchorIndexAtPress(ANCHORS, ANCHORS[0], DEGREES_PER_PIXEL)).toBe(0);
    expect(anchorIndexAtPress(ANCHORS, ANCHORS[1], DEGREES_PER_PIXEL)).toBe(1);
  });

  it("is null on open map, so the tap places a point as before", () => {
    const midpoint: [number, number] = [
      (ANCHORS[0][0] + ANCHORS[1][0]) / 2,
      (ANCHORS[0][1] + ANCHORS[1][1]) / 2,
    ];
    expect(anchorIndexAtPress(ANCHORS, midpoint, DEGREES_PER_PIXEL)).toBeNull();
    expect(anchorIndexAtPress([], ANCHORS[0], DEGREES_PER_PIXEL)).toBeNull();
  });

  it("picks the NEAREST of two anchors both within reach", () => {
    // Two vertices a few pixels apart is ordinary at the end of a fiddly line.
    // Answering with the first one in the list would delete the wrong point.
    const close: [number, number][] = [
      [150.4033, -33.5603],
      [150.4033 + TOLERANCE * 0.5, -33.5603],
    ];
    const nearSecond: [number, number] = [
      close[1][0] + TOLERANCE * 0.1,
      close[1][1],
    ];
    expect(anchorIndexAtPress(close, nearSecond, DEGREES_PER_PIXEL)).toBe(1);
    expect(anchorIndexAtPress(close, close[0], DEGREES_PER_PIXEL)).toBe(0);
  });
});

describe("dragIsTap", () => {
  const anchor = ANCHORS[0];

  it("reads a finger that wobbled a couple of DP as a TAP", () => {
    // The operator's report: "they tap and accidentally drag a miniscule
    // amount, so the delete option is never actually triggered."
    const wobble: [number, number] = [
      anchor[0] + DEGREES_PER_PIXEL * 2,
      anchor[1] - DEGREES_PER_PIXEL,
    ];
    expect(dragIsTap(anchor, wobble, DEGREES_PER_PIXEL)).toBe(true);
  });

  it("reads a deliberate move as a DRAG, so anchors can still be moved", () => {
    const moved: [number, number] = [
      anchor[0] + DEGREES_PER_PIXEL * (ANCHOR_TAP_SLOP_DP + 4),
      anchor[1],
    ];
    expect(dragIsTap(anchor, moved, DEGREES_PER_PIXEL)).toBe(false);
  });

  it("measures in DP, so the threshold is the same at every zoom", () => {
    // A move of a fixed number of DEGREES is a drag when zoomed in and a tap
    // when zoomed out — the finger is what the threshold is about.
    const gap: [number, number] = [
      anchor[0] + DEGREES_PER_PIXEL * (ANCHOR_TAP_SLOP_DP + 2),
      anchor[1],
    ];
    expect(dragIsTap(anchor, gap, DEGREES_PER_PIXEL)).toBe(false);
    expect(dragIsTap(anchor, gap, DEGREES_PER_PIXEL * 4)).toBe(true);
  });

  it("is a tap when nothing moved at all", () => {
    expect(dragIsTap(anchor, [...anchor], DEGREES_PER_PIXEL)).toBe(true);
  });
});
