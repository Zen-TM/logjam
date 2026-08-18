import { beforeEach, describe, expect, it } from "vitest";

import { cacheTile, cachedTile, clearDemTileCache } from "./demTileCache";

const TILE = new Float32Array([1, 2, 3]);

beforeEach(() => clearDemTileCache());

describe("demTileCache", () => {
  it("serves a saved tile in either mode", () => {
    cacheTile("1/2", TILE, "saved");
    expect(cachedTile("1/2", { allowNetwork: true })).toBe(TILE);
    expect(cachedTile("1/2", { allowNetwork: false })).toBe(TILE);
  });

  it("hides a network tile while simulating offline", () => {
    // The device bug this fixes: a tile fetched seconds earlier answered a tap
    // taken with "Simulating offline mode" ON, showing 1019 m for a place with
    // no saved region — coverage the field trip would not have had.
    cacheTile("1/2", TILE, "network");
    expect(cachedTile("1/2", { allowNetwork: true })).toBe(TILE);
    expect(cachedTile("1/2", { allowNetwork: false })).toBeUndefined();
  });

  it("has nothing for an unknown tile", () => {
    expect(cachedTile("9/9", { allowNetwork: true })).toBeUndefined();
  });

  it("forgets everything on clear", () => {
    cacheTile("1/2", TILE, "saved");
    clearDemTileCache();
    expect(cachedTile("1/2", { allowNetwork: true })).toBeUndefined();
  });

  it("evicts oldest first, so a long profile cannot grow it without bound", () => {
    for (let i = 0; i < 9; i += 1) cacheTile(`t/${i}`, TILE, "saved");
    expect(cachedTile("t/0", { allowNetwork: true })).toBeUndefined();
    expect(cachedTile("t/8", { allowNetwork: true })).toBe(TILE);
  });
});
