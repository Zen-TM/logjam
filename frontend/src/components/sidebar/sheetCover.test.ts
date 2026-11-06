import { afterEach, describe, expect, it } from "vitest";

import { BOTTOM_SHEET_ATTR, sheetCoverPx } from "./sheetSnap";

afterEach(() => {
  document.body.replaceChildren();
});

function sheet(transform: string) {
  const el = document.createElement("aside");
  el.setAttribute(BOTTOM_SHEET_ATTR, "");
  el.style.transform = transform;
  document.body.append(el);
}

// A place fit on narrow Logjam Web keeps the pin clear of the bottom sheet by
// padding the camera with the part of the map the sheet covers.
describe("how much of the map the bottom sheet covers", () => {
  // Mutation: read nothing from the transform (return 0), and the pin sits
  // under the half-height sheet again.
  it("is the viewport below the sheet's top edge, where the sheet is going", () => {
    sheet("translateY(472.5px)");
    expect(sheetCoverPx(844)).toBe(371.5);
  });

  // Mutation: drop the cap, and a full-height sheet pads the fit past the map.
  it("never asks for more than most of the map", () => {
    sheet("translateY(0px)");
    expect(sheetCoverPx(844)).toBeCloseTo(844 * 0.65);
  });

  // Mutation: drop `fitPadding` from the cap, and a 375 px landscape phone's
  // way fit has no room left (80 + cover + 24 passes the height).
  it("leaves room for the fit's own padding on a short viewport", () => {
    sheet("translateY(100px)");
    const cover = sheetCoverPx(375, 104);
    expect(cover + 104).toBeLessThanOrEqual(375 * 0.65);
    expect(cover).toBeGreaterThan(0);
  });

  // Mutation: apply the place cap to a fit, and a half-height sheet's cover is
  // cut short of the sheet's real top, so the extent lands under it again.
  it("covers the real sheet for a fit, leaving only a thin strip clear", () => {
    sheet("translateY(202px)");
    expect(sheetCoverPx(844, 104, 96)).toBe(642);
  });

  it("is nothing on wide Logjam Web, where the page sits beside the map", () => {
    expect(sheetCoverPx(900)).toBe(0);
  });
});
