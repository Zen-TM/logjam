import { describe, it, expect } from "vitest";
import {
  overlayAttributionLines,
  extractionCreditLine,
  GEOPDF_OVERLAY_ATTRIBUTION,
} from "./geoPdfBaseLayers.js";

describe("overlayAttributionLines", () => {
  it("credits both elevation and vegetation sources for the vegetation layer", () => {
    expect(overlayAttributionLines(["hillshade", "vegetation"])).toEqual([
      GEOPDF_OVERLAY_ATTRIBUTION.elevation,
      GEOPDF_OVERLAY_ATTRIBUTION.vegetation,
    ]);
  });

  it("dedupes multiple elevation-derived layers to a single line", () => {
    expect(overlayAttributionLines(["hillshade", "slope", "contours"])).toEqual([
      GEOPDF_OVERLAY_ATTRIBUTION.elevation,
    ]);
  });

  it("returns an empty array for no overlays", () => {
    expect(overlayAttributionLines([])).toEqual([]);
  });

  it("ignores unknown layer names", () => {
    expect(overlayAttributionLines(["unknown-layer"])).toEqual([]);
  });

  it("orders output by OVERLAY_SOURCE_ORDER regardless of input order", () => {
    expect(overlayAttributionLines(["features", "hillshade"])).toEqual([
      GEOPDF_OVERLAY_ATTRIBUTION.elevation,
      GEOPDF_OVERLAY_ATTRIBUTION.features,
    ]);
  });
});

describe("extractionCreditLine", () => {
  const extractedAt = new Date("2026-07-31T04:20:00Z");

  it("dates the credit for the SIX topo base map", () => {
    expect(extractionCreditLine("six-topo", extractedAt)).toBe(
      "© Department of Customer Service 2026-07-31",
    );
  });

  it("dates the credit for the SIX imagery base map", () => {
    expect(extractionCreditLine("six-imagery", extractedAt)).toBe(
      "© Department of Customer Service 2026-07-31",
    );
  });

  it("returns null for base layers that aren't NSW web services", () => {
    expect(extractionCreditLine("osm", extractedAt)).toBeNull();
    expect(extractionCreditLine("osm-topo", extractedAt)).toBeNull();
    expect(extractionCreditLine("osm-cycle", extractedAt)).toBeNull();
  });

  it("returns null for an unknown base layer rather than crashing", () => {
    expect(extractionCreditLine("nope", extractedAt)).toBeNull();
  });

  it("uses the UTC date, so a late-AEST render doesn't credit tomorrow", () => {
    // 2026-07-31 09:00 UTC is 2026-07-31 19:00 AEST — same day either way.
    // 2026-07-31 23:30 UTC is 2026-08-01 09:30 AEST; the extraction happened
    // on the 31st UTC and that is what must appear.
    expect(extractionCreditLine("six-topo", new Date("2026-07-31T23:30:00Z"))).toBe(
      "© Department of Customer Service 2026-07-31",
    );
  });
});
