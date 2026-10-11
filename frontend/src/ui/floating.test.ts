import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
    expect(
      floatingPosition(box(100, 100), size, viewport, "bottom-start"),
    ).toEqual({ top: 148, left: 100 });
  });

  it("end-aligns to the trigger's right edge", () => {
    expect(
      floatingPosition(box(100, 500), size, viewport, "bottom-end"),
    ).toEqual({ top: 148, left: 340 });
  });

  it("flips above when there is no room below but room above", () => {
    expect(
      floatingPosition(box(600, 100), size, viewport, "bottom-start").top,
    ).toBe(292);
  });

  it("stays below and clamps when neither side has room", () => {
    // A 300px menu beside a trigger in a 360px-tall viewport: clamped, not flipped off-screen.
    expect(
      floatingPosition(
        box(160, 100),
        size,
        { width: 1000, height: 360 },
        "bottom-start",
      ).top,
    ).toBe(52);
  });

  it("opens beside a row and flips left against the right edge", () => {
    expect(
      floatingPosition(box(100, 400), size, viewport, "right-start").left,
    ).toBe(448);
    expect(
      floatingPosition(box(100, 900), size, viewport, "right-start").left,
    ).toBe(692);
  });

  it("never leaves the viewport margin", () => {
    expect(
      floatingPosition(box(10, 980), size, viewport, "bottom-start"),
    ).toEqual({ top: 58, left: 792 });
  });
});

// WCAG 1.4.13 (hoverable): the tooltip's `::before` covers the gap
// `floatingPosition` leaves (8px = `--space-1`), so a slow pointer crossing it
// is off both the control nor the tip. Browser-checked: without it
// the tip closed when the crossing took over 150ms.
// Mutation that turns it red: delete the `.tip::before` rule in Tooltip.module.css.
describe("Tooltip bridges its gap", () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "Tooltip.module.css"),
    "utf8",
  );

  it("pads the tip by the gap on every side, and does not clip it", () => {
    expect(css).toMatch(
      /\.tip::before\s*{[^}]*inset:\s*calc\(-1 \* var\(--space-1\)\)/,
    );
    expect(css).toMatch(/\.tip\s*{\s*overflow:\s*visible/);
    expect(
      floatingPosition(box(100, 100), size, viewport, "bottom-start").top -
        box(100, 100).bottom,
    ).toBe(8);
  });
});
