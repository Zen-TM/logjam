import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const made = vi.hoisted(() => [] as unknown[]);
vi.mock("maplibre-gl", () => ({
  ScaleControl: class {
    constructor(options: unknown) {
      made.push(options);
    }
  },
}));

import { makeScaleControl } from "./scaleControl";

beforeEach(() => {
  made.length = 0;
});

describe("the map's scale bar", () => {
  // Mutation: pass `unit: "metric"` whatever the units (the bar was fixed to
  // metric before), or swap the two widths.
  it("is made in the display units, and as wide as it always was", () => {
    makeScaleControl("metric", false);
    makeScaleControl("imperial", false);
    makeScaleControl("imperial", true);
    expect(made).toEqual([
      { unit: "metric", maxWidth: 160 },
      { unit: "imperial", maxWidth: 160 },
      { unit: "imperial", maxWidth: 100 },
    ]);
  });

  // The map is too large to mount in a test, so this reads its source for the
  // two places the unit reaches the control: when it is made and when the
  // units change. Mutation: drop either call.
  it("is made with the display units and told when they change", () => {
    const map = readFileSync(
      join(import.meta.dirname, "Map.tsx"),
      "utf8",
    ).replace(/\s+/g, " ");
    expect(map).toContain(
      "makeScaleControl( displayUnits(), window.innerWidth <= MOBILE_MAX_WIDTH_PX, )",
    );
    expect(map).toContain(
      "scaleControlRef.current?.setUnit(units); }, [units]);",
    );
  });
});
