import { describe, expect, it } from "vitest";
import { floatingPosition } from "./floating";

const viewport = { width: 1000, height: 800 };
const size = { width: 200, height: 300 };
const box = (top: number, left: number, width = 40, height = 40) => ({
  top,
  left,
  right: left + width,
  bottom: top + height,
});

describe("floatingPosition", () => {
  it("sits below the trigger, start-aligned, with the gap", () => {
    expect(floatingPosition(box(100, 100), size, viewport, "bottom-start")).toEqual({ top: 148, left: 100 });
  });

  it("end-aligns to the trigger's right edge", () => {
    expect(floatingPosition(box(100, 500), size, viewport, "bottom-end")).toEqual({ top: 148, left: 340 });
  });

  it("flips above when there is no room below but room above", () => {
    expect(floatingPosition(box(600, 100), size, viewport, "bottom-start").top).toBe(292);
  });

  it("stays below and clamps when neither side has room", () => {
    // A 300px menu beside a trigger in a 360px-tall viewport: clamped, not flipped off-screen.
    expect(floatingPosition(box(160, 100), size, { width: 1000, height: 360 }, "bottom-start").top).toBe(52);
  });

  it("opens beside a row and flips left against the right edge", () => {
    expect(floatingPosition(box(100, 400), size, viewport, "right-start").left).toBe(448);
    expect(floatingPosition(box(100, 900), size, viewport, "right-start").left).toBe(692);
  });

  it("never leaves the viewport margin", () => {
    expect(floatingPosition(box(10, 980), size, viewport, "bottom-start")).toEqual({ top: 58, left: 792 });
  });
});
