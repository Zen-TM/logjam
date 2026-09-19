import { describe, expect, it } from "vitest";

import { routeArrowStyle } from "./routeArrowStyle";

/**
 * The arrowhead image, its centring and the segment split are asserted in
 * `@logjam/shared` (`routeArrow.test.ts`), because both clients draw them and
 * the centring rule is the whole reason the image exists. What is left here is
 * the MLRN-shaped style this module builds on top of them.
 */
describe("routeArrowStyle", () => {
  it("draws the shared arrow image, tinted per route", () => {
    // iconColor/iconHaloColor are IGNORED for an ordinary bitmap, which would
    // silently give every route the same arrow colour. The image is registered
    // as an SDF for exactly this expression's sake.
    const style = routeArrowStyle(["get", "routeColor"]);
    expect(style.iconImage).toBe("route-arrow");
    expect(style.iconColor).toEqual(["get", "routeColor"]);
  });

  it("rides the line, and never flips itself upright", () => {
    // An arrow that turns itself the right way up to stay readable is then
    // pointing the wrong way down the route.
    const style = routeArrowStyle("#fff");
    expect(style.symbolPlacement).toBe("line");
    expect(style.iconKeepUpright).toBe(false);
    expect(style.iconRotationAlignment).toBe("map");
  });

  it("never loses a placement contest with a label", () => {
    const style = routeArrowStyle("#fff");
    expect(style.iconAllowOverlap).toBe(true);
    expect(style.iconIgnorePlacement).toBe(true);
  });
});
