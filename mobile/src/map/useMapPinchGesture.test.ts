import { describe, expect, it } from "vitest";

import {
  MAX_PINCH_ZOOM,
  MIN_PINCH_ZOOM,
  pinchHeading,
  pinchZoomLevel,
  touchAngleDeg,
  touchSeparation,
} from "./useMapPinchGesture";

describe("touch geometry", () => {
  it("measures the separation of two fingers", () => {
    expect(
      touchSeparation([
        { pageX: 0, pageY: 0 },
        { pageX: 3, pageY: 4 },
      ]),
    ).toBe(5);
  });

  it("reads the finger angle clockwise, because screen y grows downward", () => {
    const right = touchAngleDeg([
      { pageX: 0, pageY: 0 },
      { pageX: 10, pageY: 0 },
    ]);
    const down = touchAngleDeg([
      { pageX: 0, pageY: 0 },
      { pageX: 0, pageY: 10 },
    ]);
    expect(right).toBe(0);
    expect(down).toBe(90);
  });
});

describe("pinchZoomLevel", () => {
  it("gives one zoom level per doubling of separation", () => {
    expect(pinchZoomLevel(12, 100, 200)).toBe(13);
    expect(pinchZoomLevel(12, 100, 50)).toBe(11);
    expect(pinchZoomLevel(12, 100, 100)).toBe(12);
  });

  it("clamps to the range MapLibre's own gesture would not have needed", () => {
    expect(pinchZoomLevel(19, 1, 1000)).toBe(MAX_PINCH_ZOOM);
    expect(pinchZoomLevel(3, 1000, 1)).toBe(MIN_PINCH_ZOOM);
  });
});

describe("pinchHeading", () => {
  it("turns the map WITH the fingers (bearing moves the other way)", () => {
    // Fingers rotate 30° clockwise on screen → the camera bearing drops 30°.
    expect(pinchHeading(90, 0, 30)).toBe(60);
    expect(pinchHeading(90, 30, 0)).toBe(120);
  });

  it("wraps rather than going negative or past 360", () => {
    expect(pinchHeading(10, 0, 30)).toBe(340);
    expect(pinchHeading(350, 30, 0)).toBe(20);
  });
});
