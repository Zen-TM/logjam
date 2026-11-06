import { describe, expect, it } from "vitest";
import { collapseCreditsOnce } from "./collapseCredits";

const tick = () => new Promise((resolve) => setTimeout(resolve));

describe("collapseCreditsOnce", () => {
  // Mutation: drop `observer.disconnect()`, and the credits close again every
  // time the user opens them.
  it("closes the first auto-open and leaves a later open alone", async () => {
    const credits = document.createElement("details");
    collapseCreditsOnce(credits);

    credits.classList.add("maplibregl-compact", "maplibregl-compact-show");
    await tick();
    expect(credits.classList.contains("maplibregl-compact-show")).toBe(false);

    credits.classList.add("maplibregl-compact-show");
    await tick();
    expect(credits.classList.contains("maplibregl-compact-show")).toBe(true);
  });

  // Mutation: delete the `collapse()` call after `observe`, and credits that
  // are already open when the control is found stay open.
  it("closes credits that are already open", () => {
    const credits = document.createElement("details");
    credits.classList.add("maplibregl-compact-show");
    collapseCreditsOnce(credits);
    expect(credits.classList.contains("maplibregl-compact-show")).toBe(false);
  });
});
