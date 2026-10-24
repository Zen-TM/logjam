import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  sharpenedAreasEpoch,
  stopSharpenedAreasForWipe,
} from "./sharpenedArchives";
import { writeTileJsons } from "./tileJsonFile";
import type { ResolvedTileSource } from "./sourceResolver";

// The phone's files, and whether the next write runs out of room.
const disk = vi.hoisted(() => ({
  files: new Map<string, string>(),
  full: false,
}));
vi.mock("expo-file-system", () => ({
  File: class {
    constructor(public uri: string) {}
    get exists() {
      return disk.files.has(this.uri);
    }
    write(text: string) {
      // A write that fails part-way leaves a file behind.
      disk.files.set(this.uri, disk.full ? "" : text);
      if (disk.full) throw new Error("ENOSPC");
    }
    delete() {
      disk.files.delete(this.uri);
    }
  },
  Directory: class {
    exists = true;
    create() {}
  },
}));
// The real file reaches react-native (Flow syntax vitest cannot parse).
vi.mock("../offline/localStores", () => ({
  TILEJSON_DIR: "file:///cache/logjam-tilejson/",
}));
vi.mock("@maplibre/maplibre-react-native", () => ({
  TransformRequestManager: {
    addUrlTransform: () => {},
    removeUrlTransform: () => {},
    clearUrlTransforms: () => {},
  },
}));

type Drawn = Extract<ResolvedTileSource, { status: "ok" }>;
const statewide: Drawn = {
  status: "ok",
  key: "nsw-5m-slope:remote:x",
  sourceType: "raster-dem",
  url: "pmtiles://https://cdn.example/master/dem/nsw-5m-slope.pmtiles",
  layerMaxZoom: 15,
  origin: "remote",
};
const routed: Drawn = {
  status: "ok",
  key: "nsw-5m-slope:routed:y",
  sourceType: "raster-dem",
  tileJson: {
    tiles: ["pmtiles://https://sharpened-area.invalid/a1/slope.pmtiles"],
    minzoom: 15,
    maxzoom: 17,
    bounds: [150, -34, 150.1, -33.9],
    encoding: "terrarium",
  },
  layerMinZoom: 15,
  origin: "remote",
};

beforeEach(() => {
  disk.files.clear();
  disk.full = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("writeTileJsons", () => {
  it("writes each TileJSON and points its source at the file", () => {
    const [first, second] = writeTileJsons(
      [statewide, routed],
      sharpenedAreasEpoch(),
    );
    expect(first).toEqual(statewide);
    expect(second.url).toMatch(/^file:\/\/\/cache\/logjam-tilejson\/.+\.json$/);
    expect(JSON.parse(disk.files.get(second.url!)!)).toMatchObject(
      routed.tileJson!,
    );
  });

  // Red if a failed write is let through (it throws in the map's render), or
  // its half-written file is left to be read.
  it("draws statewide alone at every zoom when a TileJSON can't be written", () => {
    disk.full = true;
    const drawn = writeTileJsons([statewide, routed], sharpenedAreasEpoch());
    const { layerMaxZoom: _, ...unlimited } = statewide;
    expect(drawn).toEqual([unlimited]);
    expect(disk.files.size).toBe(0);
  });

  // Red if the epoch isn't checked: the map, still mounted while the sign-out
  // wipe runs, would write the departing account's tile ranges again.
  it("writes nothing for a list of areas read before the sign-out wipe", () => {
    const before = sharpenedAreasEpoch();
    stopSharpenedAreasForWipe();
    expect(writeTileJsons([statewide, routed], before)).toHaveLength(1);
    expect(disk.files.size).toBe(0);
  });
});
