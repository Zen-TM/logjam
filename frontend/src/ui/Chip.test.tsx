import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Chip, ChipRail } from "./Chip";

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

describe("ChipRail", () => {
  const options = [
    { value: "a", label: "A" },
    { value: "b", label: "B" },
  ];
  // jsdom has no ResizeObserver or scrollIntoView.
  globalThis.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView = () => {};

  // Mutation: drop `aria-describedby`, and a screen reader hears the choice
  // without the sentence about it.
  it("shows its hint and describes the group with it", () => {
    render(
      <ChipRail
        label="Format"
        options={options}
        value="a"
        onChange={() => {}}
        hint="A note about A."
      />,
    );
    expect(
      screen
        .getByRole("radiogroup", { name: "Format" })
        .getAttribute("aria-describedby"),
    ).toBe(screen.getByText("A note about A.").id);
  });

  it("has no description without a hint", () => {
    render(
      <ChipRail
        label="Format"
        options={options}
        value="a"
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByRole("radiogroup").getAttribute("aria-describedby"),
    ).toBeNull();
  });
});
