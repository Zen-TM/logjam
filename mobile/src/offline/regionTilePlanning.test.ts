import { describe, expect, it } from "vitest";
import {
  MAP_TERRAIN,
  NSW_REGION,
  SIM_REGIONS,
  SIM_UTAH,
  SIM_WORLD,
  planRegionForBasemaps,
  planRegionTiles,
  type Region,
} from "@logjam/shared";

import {
  archiveLabel,
  classifyTileResponse,
  clipSourceType,
  deadTileBudget,
  exhaustedTileOutcome,
  regionClipKind,
  regionClipSpecs,
  regionPlanHash,
  regionTileSequence,
  settledStop,
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
  const SPEC = { basemapId: "six-topo", bbox: BBOX, zMin: 8, zMax: 16 };

  it("is stable for the same premise", () => {
    expect(regionPlanHash(SPEC)).toBe(regionPlanHash({ ...SPEC }));
  });

  it("changes when the source, the area or the depth changes", () => {
    const base = regionPlanHash(SPEC);
    expect(regionPlanHash({ ...SPEC, basemapId: "six-base" })).not.toBe(base);
    expect(regionPlanHash({ ...SPEC, zMax: 15 })).not.toBe(base);
    expect(
      regionPlanHash({ ...SPEC, bbox: { ...BBOX, north: -33.6 } }),
    ).not.toBe(base);
  });

  // The DEM plans one flat level over the same area a basemap plans a whole
  // pyramid over. Without zMin in the hash those two premises collide, and a
  // resume would diff the wrong plan against the file.
  it("changes when only the shallowest level changes", () => {
    expect(regionPlanHash({ ...SPEC, zMin: 13, zMax: 13 })).not.toBe(
      regionPlanHash({ ...SPEC, zMin: 8, zMax: 13 }),
    );
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
    expect(classifyTileResponse(200, "text/html; charset=utf-8", 512)).toBe(
      "retry",
    );
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

describe("regionClipSpecs", () => {
  const run = {
    bbox: BBOX,
    groupId: "g",
    groupLabel: "Area",
    allowCellular: false,
  };
  const specsFor = (
    box: typeof BBOX,
    regions?: readonly Region[],
    world?: Region,
  ): ReturnType<typeof regionClipSpecs> => {
    let n = 0;
    return regionClipSpecs(
      { ...run, bbox: box },
      planRegionForBasemaps(box, [], 15, () => 16, regions, world).clips,
      (basemapId) => ({ id: `id${n++}`, label: basemapId }),
    );
  };
  const archives = (specs: ReturnType<typeof regionClipSpecs>) =>
    specs.map((s) => [s.basemapId, s.archiveId]);

  // A save over NSW queues one clip per archive of NSW's Terrain group, heights
  // first, then the vector map.
  // Mutation: drop the vector map from the list, or the sort by `CLIP_ORDER`
  // (the slope would queue before the contours), and this goes red: a saved area is then blank offline, with tools
  // that draw straight lines, or has a Slope switch that draws nothing. That
  // the screen enqueues this list for every account has no guard.
  it("gives an area over NSW the DEM archive, the contours, the slope, land, fire, coverage and the vector map", () => {
    const specs = specsFor(BBOX);
    expect(archives(specs)).toEqual([
      ["nsw-5m", "nsw-5m"],
      ["nsw-contours", "nsw-contours"],
      ["nsw-5m-slope", "nsw-5m-slope"],
      ["nsw-land", "nsw-land"],
      ["nsw-fire", "nsw-fire"],
      ["nsw-coverage", "nsw-coverage"],
      ["protomaps", undefined],
    ]);
    for (const spec of specs) {
      expect(spec).toMatchObject({ taskKind: "clip", ...run });
    }
    expect(new Set(specs.map((s) => s.id)).size).toBe(7);
  });

  // Mutation: queue NSW's archives for every box, and a save in New Zealand
  // cuts clips from archives that do not cover it, or one in the sea cuts any.
  it("gives an area the archives of the region it lies in, and one in the sea only the vector map", () => {
    const makarora = {
      west: 169.22,
      south: -44.08,
      east: 169.28,
      north: -44.03,
    };
    expect(archives(specsFor(makarora, SIM_REGIONS))).toEqual([
      ["simnz-heights", "simnz-heights"],
      ["simnz-contours", "simnz-contours"],
      ["simnz-slope", "simnz-slope"],
      ["simnz-land", "simnz-land"],
      ["simnz-fire", "simnz-fire"],
      ["simnz-coverage", "simnz-coverage"],
      ["protomaps", undefined],
    ]);
    const sea = { west: 160, south: -30, east: 160.1, north: -29.9 };
    expect(archives(specsFor(sea, [NSW_REGION, ...SIM_REGIONS]))).toEqual([
      ["protomaps", undefined],
    ]);
  });

  // Mutation: leave `world.terrain` out of the clips `saveClipsFor` lists (in
  // shared/src/mapRegionEstimate.ts), and a save queues no worldwide heights
  // where the world declares an archive: offline it has none beyond the
  // regions' own, and a save in the sea has no heights at all.
  it("gives every area the world's heights clip too, where the world declares an archive", () => {
    const sea = { west: 160, south: -30, east: 160.1, north: -29.9 };
    expect(archives(specsFor(sea, [NSW_REGION], SIM_WORLD))).toEqual([
      ["simworld-heights", "simworld-heights"],
      ["protomaps", undefined],
    ]);
    expect(
      archives(specsFor(BBOX, [NSW_REGION], SIM_WORLD))
        .map(([id]) => id)
        .slice(0, 3),
    ).toEqual(["nsw-5m", "simworld-heights", "nsw-contours"]);
  });

  // Mutation: stop at the first region a box touches, and the second region's
  // archives are never cut.
  it("gives an area every region it touches its archives", () => {
    const overlap: Region = { ...SIM_UTAH, borders: NSW_REGION.borders };
    expect(
      archives(specsFor(BBOX, [NSW_REGION, overlap]))
        .map(([id]) => id)
        .filter((id) => id!.endsWith("-slope")),
    ).toEqual(["nsw-5m-slope", "simutah-slope"]);
  });
});

describe("a clip's kind, source type and label", () => {
  // Mutation: file a clip by its archive's layer wrongly (the slope as
  // `dem-region`, say), or let an area's clip fall through to the archive
  // lookup, and a row goes red: offline the map draws the clip as another
  // layer, or a sharpened area's as a region's.
  it("follows the archive a clip is cut from, and a sharpened area's own layer", () => {
    const kindOf = (archiveId?: string, layer?: "slope" | "contours") => [
      regionClipKind({
        archiveId,
        area: layer && {
          id: "a",
          layer,
          url: "",
          zmax: 16,
          tiles: [0, 0, 1, 1],
        },
      }),
      clipSourceType({
        archiveId,
        area: layer && {
          id: "a",
          layer,
          url: "",
          zmax: 16,
          tiles: [0, 0, 1, 1],
        },
      }),
    ];
    expect(kindOf("nsw-5m")).toEqual(["dem-region", "raster"]);
    expect(kindOf("nsw-5m-slope")).toEqual(["slope-region", "raster-dem"]);
    expect(kindOf("nsw-contours")).toEqual(["contours-region", "vector"]);
    expect(kindOf("nsw-land")).toEqual(["land-region", "vector"]);
    expect(kindOf("nsw-fire")).toEqual(["fire-region", "vector"]);
    expect(kindOf("nsw-coverage")).toEqual(["coverage-region", "vector"]);
    expect(kindOf()).toEqual(["basemap-region", "vector"]);
    // An area's own layer wins over any archive id.
    expect(kindOf("nsw-5m", "slope")).toEqual(["slope-region", "raster-dem"]);
  });

  // Mutation: label the heights without their source's name and the first
  // line goes red: a card lists every elevation clip alike.
  it("names a clip by its layer, and a height clip by its source", () => {
    expect(archiveLabel("nsw-5m")).toBe("Elevation data, NSW 5 m");
    expect(archiveLabel("nsw-contours")).toBe("Contours");
    expect(archiveLabel("nsw-5m-slope")).toBe("Slope");
    expect(archiveLabel("nsw-land")).toBe(MAP_TERRAIN.copy.land);
    expect(archiveLabel("nsw-fire")).toBe(MAP_TERRAIN.copy.fire);
    expect(archiveLabel("nsw-coverage")).toBe(MAP_TERRAIN.copy.coverage);
    expect(archiveLabel("protomaps")).toBeNull();
  });
});

describe("settledStop", () => {
  // Two workers run a job. One sees the cancel and stops; the other is midway
  // through a tile's retries and halts the job as paused for a connection.
  // Mutation: return what the workers halted on and the first line goes red.
  // The partial file is then kept and the job resumes itself on reconnect.
  it("lets a cancel win over whatever a worker halted on", () => {
    const cancelled = { kind: "cancelled" };
    expect(
      settledStop("cancel", { kind: "paused", reason: "connectivity" }),
    ).toEqual(cancelled);
    expect(settledStop("cancel", { kind: "failed" })).toEqual(cancelled);
    expect(settledStop("cancel", null)).toEqual(cancelled);
  });

  // Mutation: keep the worker's reason. A download the user paused is then
  // restarted by the next reconnect.
  it("keeps a pause the user asked for the user's", () => {
    expect(
      settledStop("pause", { kind: "paused", reason: "connectivity" }),
    ).toEqual({ kind: "paused", reason: "user" });
  });

  it("is what the workers halted on when nobody asked", () => {
    const failed = { kind: "failed" };
    expect(settledStop(null, failed)).toBe(failed);
    expect(settledStop("pause", failed)).toBe(failed);
    expect(settledStop("pause", null)).toBeNull();
  });
});

// Mutation: return "dead" whatever the app state and the second line goes red.
// The download then counts every tile Android refused it behind another app
// against the dead budget and ends as a failure instead of waiting.
describe("exhaustedTileOutcome", () => {
  it("counts a tile dead in the foreground and parks the job behind another app", () => {
    expect(exhaustedTileOutcome("active", true)).toBe("dead");
    expect(exhaustedTileOutcome("background", true)).toBe("park");
  });

  // Mutation: ignore `online` and both lines go red. Behind another app the
  // job then parks until the user is back instead of waiting for the
  // connection (seen on the emulator: airplane mode stopped the download for
  // good); in front, a dropped connection spends the dead-tile budget.
  it("waits for the connection when there is none, wherever the app is", () => {
    expect(exhaustedTileOutcome("background", false)).toBe("offline");
    expect(exhaustedTileOutcome("active", false)).toBe("offline");
  });
});
