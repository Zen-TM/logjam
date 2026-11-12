import { describe, expect, it } from "vitest";
import {
  EMPTY_PLACE_FILTERS,
  NSW_REGION,
  PLACES_ADD,
  canyonRegionsOf,
  regionEdgesKm,
  type PlaceFilters,
} from "@logjam/shared";
import {
  bucketOf,
  clearSheetFilters,
  idRange,
  normaliseBucket,
  placesBounds,
  ropewikiAddEntries,
  sheetFilterCount,
  withBucket,
} from "./placesModel";

const filters = (overrides: Partial<PlaceFilters> = {}): PlaceFilters => ({
  ...EMPTY_PLACE_FILTERS,
  custom: {},
  ...overrides,
});

describe("status buckets", () => {
  it("round-trips every chip through the filter", () => {
    for (const bucket of ["all", "todo", "done", "shared"] as const) {
      expect(bucketOf(withBucket(filters(), bucket))).toBe(bucket);
    }
  });

  it("normalises a combination the sheet cannot show, so no hidden axis narrows the list", () => {
    const legacy = filters({ ownership: "owned", completion: "any" });
    expect(normaliseBucket(legacy)).toMatchObject({
      ownership: "all",
      completion: "any",
    });
    const shown = withBucket(filters(), "done");
    expect(normaliseBucket(shown)).toBe(shown);
  });
});

describe("the sheet's filters", () => {
  // Mutation: count `ownership` and `completion` apart, and Visited reads as 2.
  it("counts the status once and not the type rail", () => {
    const statusOnly = withBucket(filters({ placeTypeId: "t" }), "todo");
    expect(sheetFilterCount(statusOnly)).toBe(1);
    expect(sheetFilterCount(filters({ placeTypeId: "t" }))).toBe(0);
    expect(
      sheetFilterCount({
        ...statusOnly,
        ropewiki: "linked",
        shared_by_me: true,
      }),
    ).toBe(3);
  });

  it("clears its own filters, the status with them, and keeps the rail", () => {
    const set = withBucket(
      filters({
        placeTypeId: "t",
        ropewiki: "linked",
        custom: { hours: { kind: "text", value: "x" } },
      }),
      "shared",
    );
    expect(clearSheetFilters(set)).toEqual(filters({ placeTypeId: "t" }));
  });
});

describe("placesBounds", () => {
  it("is null for nothing", () => {
    expect(placesBounds([])).toBeNull();
  });

  it("gives a single place a useful minimum area", () => {
    const [width, height] = regionEdgesKm(
      placesBounds([{ latitude: -33.56, longitude: 150.4 }])!,
    );
    expect(width).toBeCloseTo(2, 1);
    expect(height).toBeCloseTo(2, 1);
  });

  it("pads a spread of places by a tenth on each side", () => {
    const box = placesBounds([
      { latitude: -34, longitude: 150 },
      { latitude: -33, longitude: 151 },
    ])!;
    expect(box.south).toBeCloseTo(-34.1);
    expect(box.north).toBeCloseTo(-32.9);
    expect(box.west).toBeCloseTo(149.9);
    expect(box.east).toBeCloseTo(151.1);
  });
});

describe("idRange", () => {
  const ids = ["a", "b", "c", "d"];

  it("selects from the anchor to the clicked row in either direction", () => {
    expect(idRange(ids, "b", "d")).toEqual(["b", "c", "d"]);
    expect(idRange(ids, "d", "b")).toEqual(["b", "c", "d"]);
  });

  it("falls back to the clicked row when there is no anchor in the list", () => {
    expect(idRange(ids, null, "c")).toEqual(["c"]);
    expect(idRange(ids, "gone", "c")).toEqual(["c"]);
  });
});

describe("the Add menu's RopeWiki entries", () => {
  const NZ = { ...NSW_REGION, id: "nz", name: "New Zealand" };
  const NO_LIST = { ...NSW_REGION, id: "none", name: "Nowhere", canyons: null };

  // Mutation: build one entry whatever the regions, or keep a region whose
  // `canyons` is null.
  it("lists one per canyon region and none for a region without a list", () => {
    const regions = canyonRegionsOf(
      ["nsw", "nz", "none"],
      [NSW_REGION, NZ, NO_LIST],
    );
    expect(ropewikiAddEntries(regions, null).map((entry) => entry.id)).toEqual([
      "importRopewiki-nsw",
      "importRopewiki-nz",
    ]);
    expect(ropewikiAddEntries([], null)).toEqual([]);
  });

  // Mutation: pass a constant for `offers` to ROPEWIKI_OFFER.menu, or label
  // by region index.
  it("names the region only when there is a choice, and keeps today's label for one", () => {
    expect(ropewikiAddEntries([NSW_REGION], null)[0].label).toBe(
      PLACES_ADD.copy.importRopewiki,
    );
    expect(
      ropewikiAddEntries([NSW_REGION, NZ], null).map((entry) => entry.label),
    ).toEqual(["Import NSW from RopeWiki", "Import New Zealand from RopeWiki"]);
  });

  // Mutation: set the busy label on every entry, or leave the others enabled.
  it("marks only the region being imported busy and locks the rest", () => {
    const entries = ropewikiAddEntries([NSW_REGION, NZ], "nz");
    expect(entries.map((entry) => entry.label)).toEqual([
      "Import NSW from RopeWiki",
      PLACES_ADD.copy.importingRopewiki,
    ]);
    expect(entries.every((entry) => entry.disabled)).toBe(true);
  });
});
