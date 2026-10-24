import { RASTER_TEMPLATE_DEFAULTS } from "@logjam/shared";
import { describe, expect, it } from "vitest";

import { sharpenJobRequest } from "./sharpenJob";

describe("sharpenJobRequest", () => {
  // Mutations: send the defaults' vegetation (on) whatever was ticked, and
  // every LAZ job also runs the legacy vegetation pass; or tick it for a
  // DEM-only ZIP, which has no points to draw it from.
  it("asks for vegetation only when ticked and the ZIP has point clouds", () => {
    const on = (tick: boolean, laz: number) =>
      sharpenJobRequest(RASTER_TEMPLATE_DEFAULTS, tick, laz).settings.vegetation
        .enabled;
    expect(RASTER_TEMPLATE_DEFAULTS.vegetation.enabled).toBe(true);
    expect(on(false, 3)).toBe(false);
    expect(on(true, 3)).toBe(true);
    expect(on(true, 0)).toBe(false);
  });
});
