import { describe, expect, it } from "vitest";

import { NSW_REGION, type Region } from "./regions.js";
import { SIM_NZ, SIM_UTAH, SIM_WORLD } from "./simRegions.js";
import { SNAP_TILE_ZOOM, snapArchiveFor } from "./snapTiles.js";

const two = [NSW_REGION, SIM_NZ];

describe("snapArchiveFor", () => {
  // Mutation: return the first region's archive whatever the segment, and a
  // segment in New Zealand snaps to NSW's archive, which holds no ways there.
  it("is the archive of the region the segment is in", () => {
    expect(snapArchiveFor([150.3, -33.7], [150.31, -33.71], two)).toBe(
      NSW_REGION.vector,
    );
    expect(snapArchiveFor([169.25, -44.06], [169.26, -44.05], two)).toBe(
      SIM_NZ.vector,
    );
  });

  // Mutation: read `regionInView` in place of `regionInView`, and a
  // segment drawn on a map panned a turn round the world finds no region.
  it("reads a segment drawn a turn past the antimeridian where it is on the globe", () => {
    const [lon, lat] = SIM_NZ.view.center;
    expect(snapArchiveFor([lon + 360, lat], [lon + 360.01, lat], two)).toBe(
      SIM_NZ.vector,
    );
  });

  // Mutation: fall back to any declared archive, and snapping outside every
  // region reads an archive that has nothing there.
  it("is none where no region is, unless a world archive is declared", () => {
    expect(snapArchiveFor([160, -40], [160.01, -40], two)).toBeNull();
    expect(snapArchiveFor([160, -40], [160.01, -40], two, SIM_WORLD)).toBe(
      SIM_WORLD.vector,
    );
  });

  // Mutation: fall back to the first declared archive when the region in view
  // has none, and a region with no vector extract snaps to NSW's.
  it("is none where the region in view declares no vector archive", () => {
    const bare: Region = { ...SIM_UTAH, vector: null };
    const [lon, lat] = bare.view.center;
    expect(snapArchiveFor([lon, lat], [lon + 0.01, lat], [bare])).toBeNull();
  });

  // Mutation: drop the `maxzoom` test, and an archive that stops at z12 is
  // asked for z15 tiles it does not hold, which reads as "no ways here".
  it("is none where the archive stops short of the zoom snapping reads", () => {
    const shallow: Region = {
      ...SIM_NZ,
      vector: {
        archivePath: "master/basemap/shallow.pmtiles",
        maxzoom: SNAP_TILE_ZOOM - 1,
      },
    };
    const [lon, lat] = shallow.view.center;
    expect(snapArchiveFor([lon, lat], [lon + 0.01, lat], [shallow])).toBeNull();
  });
});
