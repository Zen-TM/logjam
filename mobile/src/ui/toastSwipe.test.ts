import { describe, expect, it } from "vitest";

import { claimsHorizontalDrag, swipeDismisses } from "./toastSwipe";

// Red when the thresholds are dropped: a stray 10 px wobble would then clear
// every toast, or a real swipe would never clear one.
describe("toast swipe", () => {
  it("dismisses on a long pull or a flick, either way", () => {
    expect(swipeDismisses(80, 0)).toBe(true);
    expect(swipeDismisses(-80, 0)).toBe(true);
    expect(swipeDismisses(10, 0.9)).toBe(true);
    expect(swipeDismisses(10, 0.1)).toBe(false);
  });

  it("leaves taps and vertical drags to the screen", () => {
    expect(claimsHorizontalDrag(2, 0)).toBe(false);
    expect(claimsHorizontalDrag(20, 40)).toBe(false);
    expect(claimsHorizontalDrag(-30, 4)).toBe(true);
  });
});
