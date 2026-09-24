import { beforeEach, describe, expect, it } from "vitest";
import {
  cacheProfile,
  cachedProfile,
  cachedProfileCount,
  clearProfileCache,
  type CachedProfile,
} from "./elevationCache";

const profile = (gainM: number): CachedProfile => ({
  samples: [{ distanceM: 0, elevationM: 100 }],
  gainM,
  lossM: 0,
  minM: 100,
  maxM: 100,
  attribution: "Terrain Tiles",
});

beforeEach(clearProfileCache);

describe("the elevation profile cache", () => {
  it("answers for geometry it has seen, and not for geometry it has not", () => {
    cacheProfile("[[150,-33]]", profile(1));
    expect(cachedProfile("[[150,-33]]")?.gainM).toBe(1);
    expect(cachedProfile("[[150.1,-33]]")).toBeNull();
  });

  // The whole point: moving a vertex changes the key, so the profile is
  // re-sampled rather than a stale one being handed back. This is what lets an
  // in-memory cache coexist with "a profile is never persisted".
  it("treats a moved vertex as different geometry", () => {
    cacheProfile(JSON.stringify([[150, -33], [150.1, -33]]), profile(1));
    expect(cachedProfile(JSON.stringify([[150, -33], [150.1, -33.5]]))).toBeNull();
  });

  it("replaces rather than duplicates when the same line is sampled again", () => {
    cacheProfile("k", profile(1));
    cacheProfile("k", profile(2));
    expect(cachedProfileCount()).toBe(1);
    expect(cachedProfile("k")?.gainM).toBe(2);
  });

  it("stays bounded", () => {
    for (let i = 0; i < 60; i++) cacheProfile(`line-${i}`, profile(i));
    expect(cachedProfileCount()).toBe(40);
    // The earliest are gone; the most recent survive.
    expect(cachedProfile("line-0")).toBeNull();
    expect(cachedProfile("line-59")?.gainM).toBe(59);
  });

  // Least recently USED, not oldest stored: the line someone keeps coming back
  // to is the one worth keeping, however long ago it was first sampled.
  it("evicts what has not been read, not what was stored first", () => {
    for (let i = 0; i < 40; i++) cacheProfile(`line-${i}`, profile(i));
    // Touch the oldest, then push one more in.
    expect(cachedProfile("line-0")?.gainM).toBe(0);
    cacheProfile("line-40", profile(40));

    expect(cachedProfile("line-0")?.gainM).toBe(0);
    expect(cachedProfile("line-1")).toBeNull();
  });
});
