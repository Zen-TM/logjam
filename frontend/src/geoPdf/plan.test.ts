import {
  extentFromCentreAndSize,
  lat2tileY,
  lon2tileX,
  getMapDimensions,
  NSW_REGION,
  RASTER_TEMPLATE_DEFAULTS,
  SIM_NZ,
  SIM_REGIONS,
  type GeoPdfConfig,
  type SharpenedOverlay,
} from "@logjam/shared";
import { describe, expect, it } from "vitest";
import {
  planTerrainBlocks,
  printGeometry,
  rasterBaseTiles,
  statewideReads,
  vectorBasemap,
} from "./plan";
import { sheetTerrain } from "./sheetTerrain";
import type { GeoPdfRenderInput } from "./types";

// A made-up point inside the NSW coverage, and one inside the first simulated
// New Zealand box.
const CENTRE = { lat: -30, lon: 150 };
const NZ_CENTRE = { lat: -44.62, lon: 169.07 };

function input(
  over: Partial<GeoPdfConfig>,
  areas: SharpenedOverlay[] = [],
  centre = CENTRE,
): GeoPdfRenderInput {
  const base = {
    paperSize: "A5" as const,
    orientation: "portrait" as const,
    scale: 25000,
  };
  const map = getMapDimensions({
    ...base,
    north: 0,
    south: 0,
    east: 0,
    west: 0,
    coordMode: "latlon",
  });
  return {
    config: {
      ...base,
      extent: extentFromCentreAndSize(
        centre.lat,
        centre.lon,
        base.scale * (map.w / 1000),
        base.scale * (map.h / 1000),
      ),
      elements: { compass: false, scaleText: false, scaleBar: false },
      baseLayer: "six-base",
      overlays: ["hillshade", "slope"],
      ...over,
    },
    slopeBands: RASTER_TEMPLATE_DEFAULTS.slope.bands,
    areas,
    vegetationUrls: [],
    origin: "https://app.example",
  };
}

const paths = (reads: { path: string }[]) => [
  ...new Set(reads.map((r) => r.path)),
];

describe("statewideReads", () => {
  it("names the height and slope tiles of a hillshade and slope print, each once", () => {
    const reads = statewideReads(input({}));
    expect(paths(reads).sort()).toEqual(
      [
        NSW_REGION.terrain.hillshade.archivePath,
        NSW_REGION.terrain.slope.archivePath,
      ].sort(),
    );
    const keys = reads.map((r) => `${r.path} ${r.z}/${r.x}/${r.y}`);
    expect(new Set(keys).size).toBe(keys.length);
    // The map is a few tiles across at z15, with the halo row each side.
    expect(reads.length).toBeGreaterThan(20);
    expect(reads.every((r) => r.z === 15)).toBe(true);
  });

  // Mutation: read the layer list from the wrong flag, and a print with no
  // slope asks for the slope archive.
  it("reads only the layers the print draws", () => {
    expect(paths(statewideReads(input({ overlays: [] })))).toEqual([]);
    expect(paths(statewideReads(input({ overlays: ["slope"] })))).toEqual([
      NSW_REGION.terrain.slope.archivePath,
    ]);
    // Imagery carries its own shadows: a hillshade asked for is not drawn.
    expect(
      paths(
        statewideReads(
          input({ baseLayer: "six-imagery", overlays: ["hillshade"] }),
        ),
      ),
    ).toEqual([]);
  });

  it("adds the contours over imagery, which a topographic sheet prints itself", () => {
    const imagery = statewideReads(
      input({ baseLayer: "six-imagery", overlays: ["contours"] }),
    );
    expect(paths(imagery)).toEqual([NSW_REGION.terrain.contours.archivePath]);
    expect(paths(statewideReads(input({ overlays: ["contours"] })))).toEqual(
      [],
    );
  });

  // Mutation: leave Land out of the plan, and a saved print reads it from the
  // network again, or fails offline.
  it("adds Land where the print asks for it, over any sheet", () => {
    expect(paths(statewideReads(input({ overlays: ["land"] })))).toEqual([
      NSW_REGION.terrain.land.archivePath,
    ]);
  });

  it("is empty for a map with no size", () => {
    const empty = input({});
    empty.config.extent = { north: -30, south: -30, east: 150, west: 150 };
    expect(statewideReads(empty)).toEqual([]);
  });

  // Mutation: keep the reads an area serves: they are presigned and never
  // belong to a prefetch.
  it("leaves out what a sharpened area serves", () => {
    const plain = input({});
    const { north, south, east, west } = plain.config.extent;
    const area: SharpenedOverlay = {
      id: "a1",
      zmax: 16,
      tiles15: [
        lon2tileX(west, 15) - 3,
        lat2tileY(north, 15) - 3,
        lon2tileX(east, 15) + 3,
        lat2tileY(south, 15) + 3,
      ],
      coverage: [0, 0, 0, 0],
      contours: false,
      credit: "made up",
      createdAt: "2026-10-24T00:00:00.000Z",
      heightsUrl: "https://b.s3.ap-southeast-2.amazonaws.com/h.pmtiles?sig=1",
      slopeUrl: "https://b.s3.ap-southeast-2.amazonaws.com/s.pmtiles?sig=1",
      contoursUrl: null,
    };
    expect(statewideReads(input({}, [area]))).toEqual([]);
    expect(statewideReads(plain).length).toBeGreaterThan(0);
  });
});

describe("a sheet in another region", () => {
  const nz = SIM_NZ.terrain;
  const read = (over: Partial<GeoPdfConfig>) => {
    const sheet = input(over, [], NZ_CENTRE);
    return statewideReads(
      sheet,
      sheetTerrain(sheet.config.extent, SIM_REGIONS),
    );
  };

  // Mutation: recompute `terrain` from the sheet's extent in statewideReads,
  // ignoring its argument, and a print is planned from the regions the page
  // knows, not the ones it was given.
  it("reads the archives of its own region", () => {
    expect(paths(read({})).sort()).toEqual(
      [nz.hillshade!.archivePath, nz.slope!.archivePath].sort(),
    );
    expect(
      paths(read({ baseLayer: "six-imagery", overlays: ["contours"] })),
    ).toEqual([nz.contours!.archivePath]);
    expect(paths(read({ overlays: ["land"] }))).toEqual([nz.land!.archivePath]);
  });

  // Mutation: add `?? regions[0]` after `regionInView` in sheetTerrain, and a
  // print outside every region prefetches NSW's tiles.
  it("reads nothing where no region holds the sheet", () => {
    const outside = input(
      { overlays: ["hillshade", "slope", "land"] },
      [],
      NZ_CENTRE,
    );
    expect(statewideReads(outside)).toEqual([]);
  });

  // Mutation: read the zoom from a literal 15 in planTerrainBlocks in place of
  // `archive.maxzoom`, and a region whose archive stops shallower is asked for
  // tiles it does not hold.
  it("reads no deeper than its archive holds", () => {
    const { config } = input({ overlays: ["slope"] });
    const whole = [{ from: 0, to: 1000 }];
    const g = printGeometry(config);
    const plan = (maxzoom: number) =>
      planTerrainBlocks(config, g, [], "slope", { maxzoom }, whole).demZoom;
    expect(plan(12)).toBe(12);
    expect(plan(15)).toBe(15);
  });
});

describe("rasterBaseTiles", () => {
  // Mutation: read at `geometry.zoom`, and a 1:25 000 print's labels land at
  // half the size, off a base with four times the tiles.
  it("reads a base with fixed-size labels shallower than the map image", () => {
    const { config } = input({ baseLayer: "six-base", overlays: [] });
    const geometry = printGeometry(config);
    const tiles = rasterBaseTiles(config, geometry);
    expect(geometry.zoom).toBe(16);
    expect(tiles.tiles[0]!.z).toBe(15);
    expect(tiles.scaleX).toBeCloseTo(2, 2);
  });

  it("reads SIX Topo at the map image's own zoom", () => {
    const { config } = input({ baseLayer: "six-topo", overlays: [] });
    expect(rasterBaseTiles(config, printGeometry(config)).tiles[0]!.z).toBe(16);
  });
});

describe("vectorBasemap", () => {
  const print = (baseLayer: string, scale: number) => {
    const { config } = input({ baseLayer, overlays: [] });
    const scaled = { ...config, scale };
    return { config: scaled, geometry: printGeometry(scaled) };
  };

  it("is nothing for a raster base", () => {
    const { config, geometry } = print("six-base", 25000);
    expect(vectorBasemap(config, geometry)).toBeNull();
  });

  // Mutation: read at the print's own zoom, and a 1:25 000 print asks for
  // z15 tiles, or for tiles the archive stops short of at a larger scale.
  it("reads at the style's zoom, up to the archive's deepest", () => {
    const coarse = print("protomaps", 25000);
    expect(
      vectorBasemap(coarse.config, coarse.geometry)!.transform.tiles[0]!.z,
    ).toBe(14);
    const fine = print("protomaps", 2000);
    expect(
      vectorBasemap(fine.config, fine.geometry)!.transform.tiles[0]!.z,
    ).toBe(15);
  });

  it("is warmed by the dialog's prefetch", () => {
    const vector = input({ baseLayer: "protomaps", overlays: [] });
    expect(statewideReads(vector).map((r) => r.path)).toContain(
      "master/basemap/protomaps-nsw.pmtiles",
    );
  });
});
