import {
  extentFromCentreAndSize,
  lat2tileY,
  lon2tileX,
  getMapDimensions,
  NSW_CONTOURS,
  NSW_HILLSHADE,
  NSW_SLOPE,
  RASTER_TEMPLATE_DEFAULTS,
  type GeoPdfConfig,
  type SharpenedOverlay,
} from "@logjam/shared";
import { describe, expect, it } from "vitest";
import { statewideReads } from "./plan";
import type { GeoPdfRenderInput } from "./types";

// A made-up point inside the NSW coverage.
const CENTRE = { lat: -30, lon: 150 };

function input(
  over: Partial<GeoPdfConfig>,
  areas: SharpenedOverlay[] = [],
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
        CENTRE.lat,
        CENTRE.lon,
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
      [NSW_HILLSHADE.archivePath, NSW_SLOPE.archivePath].sort(),
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
      NSW_SLOPE.archivePath,
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
    expect(paths(imagery)).toEqual([NSW_CONTOURS.archivePath]);
    expect(paths(statewideReads(input({ overlays: ["contours"] })))).toEqual(
      [],
    );
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
