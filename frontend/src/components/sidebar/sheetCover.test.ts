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
    sheet("translateY(272.5px)");
    expect(sheetCoverPx(844)).toBe(571.5);
  });

  // Mutation: drop the cap, and a full-height sheet pads the fit past the map.
  it("never asks for more than most of the map", () => {
    sheet("translateY(0px)");
    expect(sheetCoverPx(844)).toBeCloseTo(844 * 0.7);
  });

  it("is nothing on wide Logjam Web, where the page sits beside the map", () => {
    expect(sheetCoverPx(900)).toBe(0);
  });
});
