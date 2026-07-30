import { describe, expect, it } from "vitest";
import { planRegionTiles } from "@logjam/shared";

import {
  classifyTileResponse,
  deadTileBudget,
  regionPlanHash,
  regionTileSequence,
  tileUrlFrom,
} from "./regionTilePlanning";

const BBOX = { west: 150.26, south: -33.745, east: 150.368, north: -33.655 };

describe("regionTileSequence", () => {
  it("orders zoom ascending, then row-major — the order resume depends on", () => {
    const plan = planRegionTiles(BBOX, 8, 9);
    const sequence = regionTileSequence(plan);
    expect(sequence.length).toBe(plan.totalTiles);
    const zooms = sequence.map(([z]) => z);
    expect(zooms).toEqual([...zooms].sort((a, b) => a - b));
    // Within a level, y is the outer loop and x the inner.
    const level = plan.perZoom[0];
    expect(sequence[0]).toEqual([level.z, level.x0, level.y0]);
  });
});

describe("regionPlanHash", () => {
  it("is stable for the same premise", () => {
    const spec = { basemapId: "six-topo", bbox: BBOX, zMax: 16 };
    expect(regionPlanHash(spec)).toBe(regionPlanHash({ ...spec }));
  });

  it("changes when the source, the area or the depth changes", () => {
    const base = regionPlanHash({ basemapId: "six-topo", bbox: BBOX, zMax: 16 });
    expect(regionPlanHash({ basemapId: "six-base", bbox: BBOX, zMax: 16 })).not.toBe(base);
    expect(regionPlanHash({ basemapId: "six-topo", bbox: BBOX, zMax: 15 })).not.toBe(base);
    expect(
      regionPlanHash({
        basemapId: "six-topo",
        bbox: { ...BBOX, north: -33.6 },
        zMax: 16,
      }),
    ).not.toBe(base);
  });
});

describe("tileUrlFrom", () => {
  it("fills the ArcGIS z/row/col order without flipping the row", () => {
    // SIX's cache has a top-left origin, so {y} IS the XYZ y. The TMS flip
    // happens on the way into MBTiles, not on the way out of the provider —
    // flipping in both places renders a vertically mirrored map.
    const url = tileUrlFrom(
      "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Topo_Map/MapServer/tile/{z}/{y}/{x}",
      16,
      60131,
      39293,
    );
    expect(url).toMatch(/\/tile\/16\/39293\/60131$/);
  });
});

describe("classifyTileResponse", () => {
  it("treats a 404 as a gap, not a failure", () => {
    // Measured: six-imagery answers 404 for a third of z18 bush tiles. Retrying
    // those would grind against the provider for tiles that do not exist.
    expect(classifyTileResponse(404, null, 0)).toBe("gap");
  });

  it("stops the job on 403/429 rather than retrying into it", () => {
    expect(classifyTileResponse(403, null, 0)).toBe("backoff");
    expect(classifyTileResponse(429, null, 0)).toBe("backoff");
  });

  it("refuses a 200 that isn't an image", () => {
    // A provider error page served as 200 text/html must never be written into
    // the archive as a tile — it would render as a hole with no explanation.
    expect(classifyTileResponse(200, "text/html; charset=utf-8", 512)).toBe("retry");
    expect(classifyTileResponse(200, "image/png", 0)).toBe("retry");
    expect(classifyTileResponse(200, null, 900)).toBe("retry");
  });

  it("accepts both formats the MIXED cache serves", () => {
    expect(classifyTileResponse(200, "image/png", 1200)).toBe("ok");
    expect(classifyTileResponse(200, "image/jpeg", 1200)).toBe("ok");
  });

  it("retries a server error", () => {
    expect(classifyTileResponse(500, null, 0)).toBe("retry");
    expect(classifyTileResponse(503, null, 0)).toBe("retry");
  });
});

describe("deadTileBudget", () => {
  it("tolerates a handful on any size, and 1% on a large region", () => {
    expect(deadTileBudget(50)).toBe(10);
    expect(deadTileBudget(4000)).toBe(40);
  });
});
