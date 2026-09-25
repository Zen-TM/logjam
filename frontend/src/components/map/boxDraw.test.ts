import { describe, it, expect } from "vitest";

import { boxOverlayRect, cornersToBbox } from "./boxDraw";

const RECT = { left: 40, top: 100 };

describe("boxOverlayRect", () => {
  it("spans the anchor and the cursor, dragging down-right", () => {
    expect(boxOverlayRect({ x: 10, y: 20 }, { x: 150, y: 220 }, RECT)).toEqual({
      left: 10,
      top: 20,
      width: 100,
      height: 100,
    });
  });

  it("gives the same rectangle dragging up-left", () => {
    // The corner the user anchored is not necessarily the top-left one — a box
    // drawn back towards the origin has to come out identical, not inverted.
    expect(boxOverlayRect({ x: 110, y: 120 }, { x: 50, y: 120 }, RECT)).toEqual({
      left: 10,
      top: 20,
      width: 100,
      height: 100,
    });
  });

  it("offsets the cursor by the container, and the anchor not at all", () => {
    // The anchor is re-projected each frame and is already container-relative;
    // the cursor comes straight off a mouse event in client coordinates.
    // Offsetting both (or neither) shifts the box by the container's position,
    // which is how the overlay ends up lagging the pointer.
    const atAnchor = boxOverlayRect({ x: 10, y: 20 }, { x: 50, y: 120 }, RECT);
    expect(atAnchor).toEqual({ left: 10, top: 20, width: 0, height: 0 });
  });

  it("is a zero-size box before the cursor has moved", () => {
    expect(boxOverlayRect({ x: 0, y: 0 }, { x: 40, y: 100 }, RECT)).toEqual({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    });
  });
});

describe("cornersToBbox", () => {
  const southWest = { lng: 150.1, lat: -33.8 };
  const northEast = { lng: 150.5, lat: -33.6 };
  const expected = { west: 150.1, south: -33.8, east: 150.5, north: -33.6 };

  it("normalises whichever pair of opposite corners it is given", () => {
    // All four drag directions, since the user anchors any corner they like.
    expect(cornersToBbox(southWest, northEast)).toEqual(expected);
    expect(cornersToBbox(northEast, southWest)).toEqual(expected);
    expect(
      cornersToBbox({ lng: 150.1, lat: -33.6 }, { lng: 150.5, lat: -33.8 }),
    ).toEqual(expected);
    expect(
      cornersToBbox({ lng: 150.5, lat: -33.8 }, { lng: 150.1, lat: -33.6 }),
    ).toEqual(expected);
  });

  it("keeps south below north in the southern hemisphere", () => {
    // Both latitudes are negative here, which is where a naive "first is north"
    // reading of the corners inverts the box and matches nothing.
    const bbox = cornersToBbox(southWest, northEast);
    expect(bbox.south).toBeLessThan(bbox.north);
  });

  it("collapses to a point when both corners are the same", () => {
    expect(cornersToBbox(southWest, southWest)).toEqual({
      west: 150.1,
      south: -33.8,
      east: 150.1,
      north: -33.8,
    });
  });
});
