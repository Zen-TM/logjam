import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  indexPlaceRegistry,
  isPlaceRegistryPointer,
  normalizeSearchText,
  PLACE_REGISTRY_ATTRIBUTION,
  PLACE_SEARCH_MAX_RESULTS,
  placeKindLabel,
  placeKindRank,
  placeRegistryUrl,
  type PlaceRegistryFile,
  searchPlaces,
} from "./placeRegistry.js";

// Both written by topo/build_place_registry.py: topo/tests/test_place_registry.py
// fails when the builder stops writing exactly these, so the reader is tested
// against the builder's real output, not a hand-made guess at it.
const readFixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, "__fixtures__", name), "utf8"),
  );
const fixture = readFixture("place-registry.json") as PlaceRegistryFile;
const pointer = readFixture("place-registry-pointer.json");

const index = indexPlaceRegistry(fixture);
const names = (query: string, limit = 10) =>
  searchPlaces(index, query, limit).map((r) => r.name);

describe("searchPlaces", () => {
  it("ranks the whole name, then a prefix, then word starts, then a substring", () => {
    // Mutation: swap any two tiers in nameTier → red.
    expect(names("katoomba").slice(0, 2)).toEqual([
      "Katoomba",
      "Katoomba Falls",
    ]);
    expect(names("castle")).toEqual([
      "Castlereagh Highway",
      "Ruined Castle",
      "Newcastle Street",
    ]);
  });

  it("matches every typed word at a word start, in any order", () => {
    expect(names("falls kat")).toEqual([
      "Katoomba Falls",
      "Katoomba Falls Road",
      "Katoomba Falls Inn",
    ]);
  });

  it("puts the kind a walker means before a shorter name", () => {
    // The inn's name is shorter than the road's; the road still comes first.
    // Mutation: compare length before kind in `better` → red.
    expect(names("katoomba falls")).toEqual([
      "Katoomba Falls",
      "Katoomba Falls Road",
      "Katoomba Falls Inn",
    ]);
  });

  it("matches alternate names below every main-name match", () => {
    // Govetts Leap matches only by its alternate "Govett's Leap Lookout", and
    // its name is shorter. Mutation: drop the `4 +` on an alternate's tier → red.
    expect(names("lookout")).toEqual(["Echo Point Lookout", "Govetts Leap"]);
    expect(names("govett's leap lookout")).toEqual(["Govetts Leap"]);
  });

  it("ignores case, accents, apostrophes and punctuation", () => {
    expect(names("DEVILS HOLE")).toEqual(["Devil's Hole"]);
    expect(names("devil’s")).toEqual(["Devil's Hole"]);
    expect(names("mount-solitary")).toEqual(["Mount Solitary"]);
    expect(normalizeSearchText("Mont Blanc—Côte")).toBe("mont blanc cote");
  });

  it("normalizes plain ASCII as the general path does", () => {
    // Appending " é" sends the same text down the general path. Mutation:
    // change one path's punctuation rule and not the other's → red.
    for (const text of [
      "Devil's Hole",
      "Mount-Solitary (Upper)",
      "A&B  St.",
      "`Echo` Point #2",
      "  O'Hara's_Gap  ",
    ]) {
      expect(normalizeSearchText(text)).toBe(
        normalizeSearchText(`${text} é`).replace(/ e$/, ""),
      );
    }
  });

  it("tells namesakes apart by the nearest settlement", () => {
    const results = searchPlaces(index, "station street", 10);
    expect(results.map((r) => [r.kind, r.near])).toEqual([
      ["Street", "Blackheath"],
      ["Street", "Katoomba"],
    ]);
    expect(searchPlaces(index, "katoomba", 1)[0].near).toBe("Blackheath");
  });

  it("returns a point and a readable kind", () => {
    expect(searchPlaces(index, "ruined", 1)).toEqual([
      {
        name: "Ruined Castle",
        kind: "Peak",
        near: "Katoomba",
        lon: 150.29,
        lat: -33.74,
      },
    ]);
  });

  it("answers nothing below the minimum length, and honours the limit", () => {
    expect(names("k")).toEqual([]);
    expect(names("  ")).toEqual([]);
    expect(names("ka", 2)).toHaveLength(2);
  });

  it("answers nothing for a limit that is not a number, and caps a large one", () => {
    // Mutation: drop the clamp → the NaN case returns every match.
    expect(names("ka", Number.NaN)).toEqual([]);
    expect(names("ka", 0)).toEqual([]);
    const n = PLACE_SEARCH_MAX_RESULTS + 5;
    const column = (value: number) => Array.from({ length: n }, () => value);
    const many = indexPlaceRegistry({
      ...fixture,
      names: Array.from({ length: n }, (_, i) => `Ka ${i}`),
      kind: column(0),
      lon: column(15_000_000),
      lat: column(-3_300_000),
      near: column(-1),
      alternates: [],
    });
    expect(searchPlaces(many, "ka", 1_000_000)).toHaveLength(
      PLACE_SEARCH_MAX_RESULTS,
    );
  });
});

describe("indexPlaceRegistry", () => {
  it("refuses a format it does not know", () => {
    expect(() => indexPlaceRegistry({ ...fixture, format: 2 })).toThrow(
      /format 2/,
    );
  });

  it("reads a file crediting OpenStreetMap as the results do", () => {
    // Mutation: change ATTRIBUTION in the builder → red.
    expect(fixture.attribution).toBe(PLACE_REGISTRY_ATTRIBUTION);
  });
});

describe("placeKindLabel", () => {
  it("names the kinds whose OSM value reads wrong, and reads the rest", () => {
    expect(placeKindLabel("highway=residential")).toBe("Street");
    expect(placeKindLabel("waterway=stream")).toBe("Creek");
    expect(placeKindLabel("tourism=camp_site")).toBe("Camp site");
  });

  it("names a `key=yes` kind by its key", () => {
    // OSM tags many canyons natural=yes; "Yes" says nothing.
    expect(placeKindLabel("natural=yes")).toBe("Natural feature");
    expect(placeKindLabel("building=yes")).toBe("Building");
  });
});

describe("placeKindRank", () => {
  it("ranks a town before a farm, though both are `place`", () => {
    // Mutation: add `place: 0` to KIND_RANKS → red.
    expect(placeKindRank("place=town")).toBeLessThan(
      placeKindRank("natural=peak"),
    );
    expect(placeKindRank("place=farm")).toBeGreaterThan(
      placeKindRank("highway=residential"),
    );
  });
});

describe("isPlaceRegistryPointer", () => {
  it("accepts the builder's pointer and builds its URL", () => {
    // Mutation: rename a field in the builder's pointer() → red.
    expect(isPlaceRegistryPointer(pointer)).toBe(true);
    if (!isPlaceRegistryPointer(pointer)) return;
    expect(placeRegistryUrl("https://cdn.example", pointer)).toBe(
      `https://cdn.example/master/places/v1/${pointer.path}`,
    );
  });

  it("refuses another format, and a path that leaves the prefix", () => {
    // Mutation: drop the path pattern → red.
    const good = pointer as Record<string, unknown>;
    expect(isPlaceRegistryPointer({ ...good, format: 2 })).toBe(false);
    expect(isPlaceRegistryPointer({ ...good, path: "../x" })).toBe(false);
    expect(isPlaceRegistryPointer({ ...good, path: "a/b" })).toBe(false);
    expect(isPlaceRegistryPointer({ ...good, path: ".." })).toBe(false);
    expect(isPlaceRegistryPointer(null)).toBe(false);
  });
});
