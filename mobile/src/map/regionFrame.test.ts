import { describe, expect, it } from "vitest";

import {
  MIN_FRAME_PX,
  defaultFrameInsets,
  frameToBbox,
  metresPerPixel,
  moveFrameEdge,
  type FrameInsets,
  type FrameViewport,
} from "./regionFrame";

const VIEW: FrameViewport = {
  north: -33.6,
  south: -33.8,
  east: 150.5,
  west: 150.1,
  width: 400,
  height: 800,
};

describe("frameToBbox", () => {
  it("a full-bleed frame is the whole viewport", () => {
    const bbox = frameToBbox(VIEW, { top: 0, right: 0, bottom: 0, left: 0 });
    expect(bbox.west).toBeCloseTo(VIEW.west, 9);
    expect(bbox.east).toBeCloseTo(VIEW.east, 9);
    expect(bbox.north).toBeCloseTo(VIEW.north, 9);
    expect(bbox.south).toBeCloseTo(VIEW.south, 9);
  });

  it("maps longitude linearly in x", () => {
    const bbox = frameToBbox(VIEW, { top: 0, right: 100, bottom: 0, left: 100 });
    expect(bbox.west).toBeCloseTo(150.2, 9);
    expect(bbox.east).toBeCloseTo(150.4, 9);
  });

  it("maps latitude through Mercator, not through degrees", () => {
    // Halfway down the screen is NOT the degree midpoint — it is the midpoint in
    // Mercator y. At this latitude the difference is small but real, and using
    // degrees would skew every framed box.
    const bbox = frameToBbox(VIEW, { top: 400, right: 0, bottom: 0, left: 0 });
    const degreeMidpoint = (VIEW.north + VIEW.south) / 2;
    expect(bbox.north).not.toBe(degreeMidpoint);
    expect(bbox.north).toBeCloseTo(degreeMidpoint, 3);
    // Southern hemisphere: Mercator stretches toward the pole, so the screen's
    // midpoint sits slightly SOUTH of the degree midpoint.
    expect(bbox.north).toBeLessThan(degreeMidpoint);
  });

  it("keeps the box ordered for any inset", () => {
    const bbox = frameToBbox(VIEW, { top: 300, right: 150, bottom: 200, left: 50 });
    expect(bbox.west).toBeLessThan(bbox.east);
    expect(bbox.south).toBeLessThan(bbox.north);
  });
});

describe("moveFrameEdge", () => {
  const size = { width: 400, height: 800 };
  const frame: FrameInsets = { top: 100, right: 50, bottom: 100, left: 50 };

  it("moves only the dragged edge — any aspect ratio is reachable", () => {
    const tall = moveFrameEdge(frame, "left", 120, size);
    expect(tall).toEqual({ ...frame, left: 170 });
    // Dragging the bottom edge 200 px down consumes the whole 100 px inset and
    // stops at the view edge.
    const wide = moveFrameEdge(frame, "bottom", 200, size);
    expect(wide).toEqual({ ...frame, bottom: 0 });
  });

  it("a downward drag on the bottom edge grows the frame", () => {
    // Screen y increases downward, so the bottom INSET shrinks as the finger
    // moves down. Getting this sign wrong inverts the handle.
    const grown = moveFrameEdge(frame, "bottom", 40, size);
    expect(grown.bottom).toBe(60);
  });

  it("never shrinks below MIN_FRAME_PX", () => {
    const squeezed = moveFrameEdge(frame, "top", 10_000, size);
    expect(squeezed.top).toBe(size.height - frame.bottom - MIN_FRAME_PX);
    const remaining =
      size.height - squeezed.top - squeezed.bottom;
    expect(remaining).toBe(MIN_FRAME_PX);
  });

  it("never leaves the view", () => {
    expect(moveFrameEdge(frame, "left", -10_000, size).left).toBe(0);
    expect(moveFrameEdge(frame, "right", 10_000, size).right).toBe(0);
  });
});

describe("defaultFrameInsets", () => {
  it("leaves every handle on screen", () => {
    const size = { width: 400, height: 800 };
    const frame = defaultFrameInsets(size);
    expect(frame.left).toBeGreaterThan(0);
    expect(frame.top).toBeGreaterThan(0);
    expect(size.width - frame.left - frame.right).toBeGreaterThan(MIN_FRAME_PX);
    expect(size.height - frame.top - frame.bottom).toBeGreaterThan(MIN_FRAME_PX);
  });
});

describe("metresPerPixel", () => {
  it("halves with each zoom level", () => {
    const z14 = metresPerPixel(-33.7, 14);
    const z15 = metresPerPixel(-33.7, 15);
    expect(z15).toBeCloseTo(z14 / 2, 6);
  });

  it("is about 2 m/px at z16 in the Blue Mountains", () => {
    expect(metresPerPixel(-33.7, 16)).toBeGreaterThan(1.7);
    expect(metresPerPixel(-33.7, 16)).toBeLessThan(2.1);
  });
});
