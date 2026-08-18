import { describe, expect, it } from "vitest";

import { ANCHOR_GRAB_PIXELS, pressIsOnAnchor } from "./anchorHit";

// Zoom 15-ish on a 3x screen: about 3.6e-6 degrees per pixel. The exact value
// does not matter to these cases, only that the tolerance scales with it.
const DEGREES_PER_PIXEL = 3.6e-6;
const TOLERANCE = DEGREES_PER_PIXEL * ANCHOR_GRAB_PIXELS;

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
