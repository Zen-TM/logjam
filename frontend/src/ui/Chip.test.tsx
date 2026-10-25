import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Chip } from "./Chip";

afterEach(cleanup);

describe("Chip", () => {
  // Mutation: set `--chip-hue` to `hue` as given, and a hue that fails 3:1
  // against Sandstone's card (waypoint, 2.5:1) fills a selected chip unmoved.
  it("fills with the hue moved off the card, and a hue that passes as given", () => {
    render(
      <>
        <Chip label="Waypoint" active hue="#D98170" />
        <Chip label="Scrub" active hue="#BED9B5" />
      </>,
    );
    const fill = (name: string) =>
      screen.getByRole("button", { name }).style.getPropertyValue("--chip-hue");
    expect(fill("Waypoint").toLowerCase()).not.toBe("#d98170");
    expect(fill("Scrub").toLowerCase()).toBe("#bed9b5");
  });

  // Mutation: make `cssHue` return `hue` as given, and a chip handed
  // `var(--hue-…)` (most callers) silently gets the unshifted fill.
  it("resolves a var(--hue-*) hue from :root before moving it", () => {
    document.documentElement.style.setProperty("--hue-waypoint", "#D98170");
    render(<Chip label="Pin" active hue="var(--hue-waypoint)" />);
    const fill = screen
      .getByRole("button", { name: "Pin" })
      .style.getPropertyValue("--chip-hue");
    document.documentElement.style.removeProperty("--hue-waypoint");
    expect(fill.toLowerCase()).toMatch(/^#[0-9a-f]{6}$/);
    expect(fill.toLowerCase()).not.toBe("#d98170");
  });
});
