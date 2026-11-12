import { beforeEach, describe, expect, it } from "vitest";
import {
  cacheProfile,
  cachedProfile,
  cachedProfileCount,
  clearProfileCache,
  profileCacheGeneration,
  profileCacheScope,
  scopeProfileCache,
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
    cacheProfile("[[150,-33]]", profile(1), profileCacheGeneration());
    expect(cachedProfile("[[150,-33]]")?.gainM).toBe(1);
    expect(cachedProfile("[[150.1,-33]]")).toBeNull();
  });

  // The whole point: moving a vertex changes the key, so the profile is
  // re-sampled rather than a stale one being handed back. This is what lets an
  // in-memory cache coexist with "a profile is never persisted".
  it("treats a moved vertex as different geometry", () => {
    cacheProfile(
      JSON.stringify([
        [150, -33],
        [150.1, -33],
      ]),
      profile(1),
      profileCacheGeneration(),
    );
    expect(
      cachedProfile(
        JSON.stringify([
          [150, -33],
          [150.1, -33.5],
        ]),
      ),
    ).toBeNull();
  });

  it("replaces rather than duplicates when the same line is sampled again", () => {
    cacheProfile("k", profile(1), profileCacheGeneration());
    cacheProfile("k", profile(2), profileCacheGeneration());
    expect(cachedProfileCount()).toBe(1);
    expect(cachedProfile("k")?.gainM).toBe(2);
  });

  it("stays bounded", () => {
    for (let i = 0; i < 60; i++)
      cacheProfile(`line-${i}`, profile(i), profileCacheGeneration());
    expect(cachedProfileCount()).toBe(40);
    // The earliest are gone; the most recent survive.
    expect(cachedProfile("line-0")).toBeNull();
    expect(cachedProfile("line-59")?.gainM).toBe(59);
  });

  // Least recently USED, not oldest stored: the line someone keeps coming back
  // to is the one worth keeping, however long ago it was first sampled.
  it("evicts what has not been read, not what was stored first", () => {
    for (let i = 0; i < 40; i++)
      cacheProfile(`line-${i}`, profile(i), profileCacheGeneration());
    // Touch the oldest, then push one more in.
    expect(cachedProfile("line-0")?.gainM).toBe(0);
    cacheProfile("line-40", profile(40), profileCacheGeneration());

    expect(cachedProfile("line-0")?.gainM).toBe(0);
    expect(cachedProfile("line-1")).toBeNull();
  });
});

describe("who the cache was filled for", () => {
  // Mutations: a scope without the signed-in state (the next user on the tab
  // keeps the cache) or without the areas (a revoked share keeps it), or one
  // that changes when the same areas come back in another order.
  it("is the signed-in state and the set of areas, in any order", () => {
    const scope = profileCacheScope(true, ["a", "b"]);
    expect(profileCacheScope(true, ["b", "a"])).toBe(scope);
    expect(profileCacheScope(false, ["a", "b"])).not.toBe(scope);
    expect(profileCacheScope(true, ["a"])).not.toBe(scope);
    expect(profileCacheScope(true, ["a", "b", "c"])).not.toBe(scope);
  });

  // Mutation: store an answer whatever scope it was asked in, and a profile
  // read through a revoked area is cached again after the cache emptied.
  it("drops a profile asked for before the scope changed", () => {
    scopeProfileCache("true,area-1");
    const askedIn = profileCacheGeneration();
    scopeProfileCache("true");
    cacheProfile("[[150,-33]]", profile(1), askedIn);
    expect(cachedProfile("[[150,-33]]")).toBeNull();
    cacheProfile("[[150,-33]]", profile(1), profileCacheGeneration());
    expect(cachedProfile("[[150,-33]]")?.gainM).toBe(1);
  });

  // Mutation: keep the cache across a change of user or of visible areas, and
  // the next person to sign in on the tab, or a sharee whose share was
  // revoked, is handed heights read from an area they cannot see.
  it("forgets every profile when the user or their areas change", () => {
    scopeProfileCache("true,area-1");
    cacheProfile("[[150,-33]]", profile(1), profileCacheGeneration());
    scopeProfileCache("true,area-1");
    expect(cachedProfile("[[150,-33]]")?.gainM).toBe(1);
    scopeProfileCache("true");
    expect(cachedProfileCount()).toBe(0);
    cacheProfile("[[150,-33]]", profile(2), profileCacheGeneration());
    scopeProfileCache("false");
    expect(cachedProfileCount()).toBe(0);
  });
});
