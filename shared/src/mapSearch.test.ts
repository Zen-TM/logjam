import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  addRecentSearch,
  MAX_RECENT_SEARCHES,
  parseCoordinates,
  readRecentSearches,
  SEARCH_STATUS,
  searchPinAfter,
} from "./mapSearch";
import { toGridAt } from "./grids";
import type { LonLatBox } from "./regions";

const viewAround = (lat: number, lon: number): LonLatBox => ({
  west: lon - 0.2,
  south: lat - 0.2,
  east: lon + 0.2,
  north: lat + 0.2,
});
const shifted = (v: LonLatBox, turn: number): LonLatBox => ({
  ...v,
  west: v.west + turn,
  east: v.east + turn,
});
const OVER_UTAH = viewAround(40.7, -111.9);
const OVER_NZ = viewAround(-41.3, 174.8);
const OVER_SYDNEY = viewAround(-33.8, 151.2);

describe("parseCoordinates", () => {
  it.each([
    "-33.71, 150.31",
    "-33.71 150.31",
    "-33.71,150.31",
    "33.71S 150.31E",
    "S33.71 E150.31",
    "150.31E, 33.71S",
    "150.31, -33.71",
    "33.71 150.31",
    `33°42'36"S 150°18'36"E`,
    `33°25.2'S 150°18.6'E`,
  ])("reads %s", (text) => {
    const p = parseCoordinates(text);
    expect(p).not.toBeNull();
    expect(p!.lat).toBeCloseTo(
      text.includes("°") ? (text.includes("25.2") ? -33.42 : -33.71) : -33.71,
      2,
    );
    expect(p!.lon).toBeCloseTo(150.31, 2);
  });

  // Bug: an unsigned pair was forced south and east whatever was typed, so it
  // flew to the wrong side of the world anywhere but Australia.
  // Mutation: force the signs again (`lat = -lat`, lon positive).
  it.each([
    ["40.7 111.9", OVER_UTAH, 40.7, -111.9],
    ["40.7, 111.9", OVER_UTAH, 40.7, -111.9],
    ["41.3 174.8", OVER_NZ, -41.3, 174.8],
    ["111.9 40.7", OVER_UTAH, 40.7, -111.9],
    ["33.71 150.31", OVER_SYDNEY, -33.71, 150.31],
  ])(
    "takes the hemispheres of an unsigned %j from the map over it",
    (text, view, lat, lon) => {
      const p = parseCoordinates(text, view)!;
      expect([p.lat, p.lon]).toEqual([lat, lon]);
    },
  );

  // Mutation: ignore the typed minus and use the centre's hemisphere.
  it.each([
    ["-33.7 150.3", OVER_UTAH, -33.7, 150.3],
    ["-33.7 150.3", OVER_NZ, -33.7, 150.3],
    ["-33.7, 150.3", null, -33.7, 150.3],
    ["40.7 -111.9", OVER_SYDNEY, 40.7, -111.9],
    ["-40.7 -111.9", OVER_SYDNEY, -40.7, -111.9],
    ["-41.3 174.8", OVER_UTAH, -41.3, 174.8],
  ])(
    "keeps the sign typed in %j wherever the map is",
    (text, view, lat, lon) => {
      const p = parseCoordinates(text, view)!;
      expect([p.lat, p.lon]).toEqual([lat, lon]);
    },
  );

  // Mutation: put back magnitude windows (a latitude of at most 65), which
  // read "70 25" as 25, 70 and read "-70 25" as 25 N 70 W.
  it.each([
    ["70 25", OVER_SYDNEY, -70, 25],
    ["69.6 18.9", OVER_UTAH, 69.6, -18.9],
    ["-70 25", OVER_UTAH, -70, 25],
    ["-33.71, 10.31", OVER_SYDNEY, -33.71, 10.31],
    ["40.7 41.9", OVER_UTAH, 40.7, -41.9],
    ["150.3 -33.7", OVER_UTAH, -33.7, 150.3],
  ])(
    "reads a bare pair %j latitude first, swapped only when the first cannot be one",
    (text, view, lat, lon) => {
      const p = parseCoordinates(text, view)!;
      expect([p.lat, p.lon]).toEqual([lat, lon]);
    },
  );

  // Mutation: fall back to a centre of [0, 0] (everything north) instead of
  // the first region's centre.
  it("falls back to the home region's hemispheres when the map has no view", () => {
    expect(parseCoordinates("33.71 150.31", null)).toMatchObject({
      lat: -33.71,
      lon: 150.31,
    });
    expect(parseCoordinates("33.71 150.31")).toMatchObject({
      lat: -33.71,
      lon: 150.31,
    });
  });

  // MapLibre's bounds run past ±180 after a pan around the world: the copy of
  // the world a view sits in must not decide east or west. Mutation: drop the
  // `wrapView` call in `parseLatLon`.
  it.each([
    [
      "Sydney, 360 west",
      shifted(OVER_SYDNEY, -360),
      "33.7 150.3",
      -33.7,
      150.3,
    ],
    ["Utah, 360 east", shifted(OVER_UTAH, 360), "40.7 111.9", 40.7, -111.9],
  ])(
    "reads an unsigned pair the same in another copy of the world: %s",
    (_n, view, text, lat, lon) => {
      const p = parseCoordinates(text, view)!;
      expect([p.lat, p.lon]).toEqual([lat, lon]);
    },
  );

  // A comma is a separator here, never a thousands mark: "1,050" is 1 and 50,
  // as "33,150" must stay a pair. Mutation: drop the comma from the separator
  // test in `parseLatLon`, and this and every comma-separated read goes red.
  it("reads a comma between two numbers as the pair's separator", () => {
    expect(parseCoordinates("1,050", null)).toMatchObject({ lat: -1, lon: 50 });
  });

  it("labels a decimal pair to five places", () => {
    expect(parseCoordinates("-33.71 150.31")!.label).toBe(
      "-33.71000, 150.31000",
    );
  });

  it.each([
    "56 245000 6264000",
    "56H 245000E 6264000N",
    "MGA zone 56 245000mE 6264000mN",
    "mga56 245000, 6264000",
  ])("reads MGA %s", (text) => {
    const p = parseCoordinates(text)!;
    expect(p.label).toBe("MGA 56 245000 6264000");
    const back = toGridAt(p.lat, p.lon);
    expect(back.zone.name).toBe("MGA 56");
    expect(back.easting).toBeCloseTo(245000, 0);
    expect(back.northing).toBeCloseTo(6264000, 0);
  });

  // Every input above is zone 56. Mutation: read every reference in zone 56.
  it("reads a zone 55 reference in zone 55", () => {
    const p = parseCoordinates("55 700000 6264000")!;
    expect(p.label).toBe("MGA 55 700000 6264000");
    const back = toGridAt(p.lat, p.lon);
    expect(back.zone.name).toBe("MGA 55");
    expect(back.easting).toBeCloseTo(700000, 0);
    expect(back.northing).toBeCloseTo(6264000, 0);
  });

  // Mutation: decimals back outside the capture groups (metres truncated).
  it("keeps the metres' decimals", () => {
    const p = parseCoordinates("56 245000.6 6264000.4")!;
    const back = toGridAt(p.lat, p.lon);
    expect(back.easting).toBeCloseTo(245000.6, 1);
    expect(back.northing).toBeCloseTo(6264000.4, 1);
  });

  // 40.7 N, 111.9 W is 12 423966 4505845 (a made-up point near Salt Lake City).
  // A band letter is a latitude band: "12S" is north of the equator, and "N" is
  // the first band north of it. Mutation: read any band letter as "south", or
  // "N" as south (the `south` line of `parseGridReference`).
  it.each([
    ["12S 423966 4505845", OVER_UTAH],
    ["12S 423966E 4505845N", OVER_NZ],
    ["UTM 12T 423966 4505845", OVER_SYDNEY],
    ["12N 423966 4505845", OVER_UTAH],
    ["utm zone 12 423966 4505845", OVER_UTAH],
  ])("reads the UTM reference %j", (text, view) => {
    const p = parseCoordinates(text, view)!;
    expect(p.label).toBe(`UTM 12 423966 4505845`);
    expect(p.lat).toBeCloseTo(40.7, 3);
    expect(p.lon).toBeCloseTo(-111.9, 3);
  });

  // With no letter the hemisphere is the map's. Mutation: always north, or
  // always south, for a reference with no letter.
  it.each([
    ["12 423966 4505845", OVER_UTAH, 40.7, -111.9],
    ["19 351205 6303224", viewAround(-33.4, -70.6), -33.4, -70.6],
    ["19M 351205 6303224", OVER_UTAH, -33.4, -70.6],
  ])(
    "takes the hemisphere of the UTM reference %j from the map",
    (text, view, lat, lon) => {
      const p = parseCoordinates(text, view)!;
      expect(p.lat).toBeCloseTo(lat, 3);
      expect(p.lon).toBeCloseTo(lon, 3);
    },
  );

  // Over no region an unprefixed zone 56 reads as MGA too, so this holds the
  // prefix through the map's hemisphere. Mutation: make the MGA branch of
  // `parseGridReference` need a southern map (`prefix === "MGA" && south`),
  // and zone 56 over Utah reads as UTM north.
  it("reads MGA over a map that is not over Australia when the text says MGA", () => {
    const p = parseCoordinates("MGA 56 245000 6264000", OVER_UTAH)!;
    expect(p.label).toBe("MGA 56 245000 6264000");
    expect(p.lat).toBeCloseTo(-33.7, 0);
  });

  // The map decides what an unprefixed zone means: over Australia's grid only
  // zones 54 to 56 are zones. Mutation: read a zone outside 54-56 as UTM even
  // when the map is over MGA's region.
  it("reads a zone number in the grid of the map: no UTM zone 12 over NSW without the name", () => {
    expect(parseCoordinates("12 423966 4505845", OVER_SYDNEY)).toBeNull();
    expect(parseCoordinates("12S 423966 4505845", OVER_SYDNEY)).toBeNull();
    expect(
      parseCoordinates("UTM 12S 423966 4505845", OVER_SYDNEY),
    ).not.toBeNull();
  });

  // Mutation: gate the NZTM branch on the map alone, ignoring the "NZTM"
  // prefix (`nz[1]` in `parseGridReference`): the Utah and Sydney rows go red.
  it.each([
    ["NZTM 1749046 5427521", OVER_UTAH],
    ["nztm2000 1749046E 5427521N", OVER_SYDNEY],
  ])("reads the NZTM reference %j wherever the map is", (text, view) => {
    const p = parseCoordinates(text, view)!;
    expect(p.label).toBe("NZTM 1749046 5427521");
    expect(p.lat).toBeCloseTo(-41.29, 3);
    expect(p.lon).toBeCloseTo(174.78, 3);
  });

  // A bare pair of seven-digit numbers is a reference only over an NZTM region
  // (grids.test.ts, "reads a bare NZTM pair over an NZTM region"). Mutation:
  // delete the lookahead after the zone in `REFERENCE`, which reads
  // "1749046 5427521" as zone 1.
  it.each([
    ["1749046 5427521", OVER_UTAH],
    ["1749046 5427521", OVER_SYDNEY],
    ["1749046 5427521", null],
  ])("does not read a bare pair %j far from NZ", (text, view) => {
    expect(parseCoordinates(text, view)).toBeNull();
  });

  // What read before reads the same where the map is over no region, whichever
  // hemisphere it looks at: zones 54 to 56 are MGA, with the MGA label.
  // Mutation: read an unprefixed zone as UTM whenever the map is over no
  // region (drop the `!nearGrid` branch of `parseGridReference`).
  it.each([
    ["56 245000 6264000", viewAround(40, -100), "MGA 56 245000 6264000"],
    ["56H 245000 6264000", viewAround(40, -100), "MGA 56 245000 6264000"],
    ["55 320000 5812000", viewAround(-37.8, 145), "MGA 55 320000 5812000"],
  ])("reads %j over no region as MGA", (text, view, label) => {
    const p = parseCoordinates(text, view)!;
    expect(p.label).toBe(label);
    expect(p.lat).toBeLessThan(-30);
  });

  // A band letter keeps its meaning outside an MGA region. Mutation: let the
  // MGA branch ignore a northern band letter.
  it("reads 55N over no region as UTM north", () => {
    const p = parseCoordinates("55N 245000 6264000", OVER_UTAH)!;
    expect(p.label).toBe("UTM 55 245000 6264000");
    expect(p.lat).toBeGreaterThan(50);
  });

  // MGA's own zones need no gap before the easting; nothing else does.
  // Mutation: delete the `(?<=5[456])` alternative from `REFERENCE`.
  it.each(["56245000 6264000", "MGA 56245000 6264000", "mga56245000, 6264000"])(
    "reads %j with no gap after the zone",
    (text) => {
      const p = parseCoordinates(text)!;
      expect(p.label).toBe("MGA 56 245000 6264000");
      expect(p.lat).toBeCloseTo(-33.7, 0);
    },
  );

  // A six-digit northing is a northern UTM reference only. 1 N, 111 W is
  // 12 400000 110574 (made up). Mutation: require a seven-digit northing
  // again (`\d{6,7}` to `\d{7}` in `REFERENCE`); or drop the latitude check
  // on an MGA point (the NSW row) or on a UTM one (the 19M row), which are what
  // refuse a six-digit northing in the south.
  it("reads a six-digit northing in the northern hemisphere only", () => {
    const p = parseCoordinates("12N 400000 110574", OVER_UTAH)!;
    expect(p.label).toBe("UTM 12 400000 110574");
    expect(p.lat).toBeCloseTo(1, 1);
    expect(parseCoordinates("12 400000 110574", OVER_UTAH)).not.toBeNull();
    expect(parseCoordinates("56 245000 626400")).toBeNull(); // over NSW
    expect(parseCoordinates("19M 351205 630322", OVER_UTAH)).toBeNull();
    expect(parseCoordinates("MGA 56 245000 626400", OVER_UTAH)).toBeNull();
  });

  // Mutation: drop the zone range check, which reads zone 61 as zone 1, or
  // drop the latitude check on a UTM point, or the latitude or the longitude
  // check on an NZTM one.
  it.each([
    ["61 423966 4505845", OVER_UTAH],
    ["0 423966 4505845", OVER_UTAH],
    ["12S 423966 9500000", OVER_UTAH], // past 84 N
    ["NZTM 1749046 1000000", OVER_UTAH], // nowhere near NZ
    ["NZTM 1749046 9000000", OVER_UTAH],
    ["NZTM 2900000 5427521", OVER_UTAH], // the right latitude, 1,300 km east of the zone
    // Mutation: drop the easting range check, which projects these into a
    // neighbouring zone under this zone's label.
    ["UTM 12 999999 4000000", OVER_UTAH],
    ["UTM 12 050000 4000000", OVER_UTAH],
    ["MGA 55 950000 6264000", OVER_SYDNEY],
  ])("does not read the grid reference %j", (text, view) => {
    expect(parseCoordinates(text, view)).toBeNull();
  });

  it.each([
    "",
    "Katoomba",
    "245000 6264000", // no zone: not guessed
    "56 24500 6264000",
    "57 245000 6264000",
    "56 245000 5000000", // lands outside Australia
    "-33.71", // one number
    "2024",
    "33.71S 150.31S", // two latitudes
    "33.71S 150.31", // letter on one part only
    "200 300",
    `33°72'00"S 150°18'36"E`, // 72 minutes
    "1 2 3 4",
    // Mutation: raise the first latitude bound in `parseLatLon` (`am <= 90`)
    // past 90.
    "100 120", // neither can be a latitude
    // A lone angle with spaces is not a pair whose first number was cut in two.
    // Mutation: delete the `(?!\d)` after the degrees in `PART`.
    `33 42' 36"`,
    "33° 42'",
    // Written together, two numbers are not a pair. Mutation: delete the
    // separator check in `parseLatLon`.
    "33.7-150.3",
    "33.7°150.3°",
  ])("does not read %j", (text) => {
    expect(parseCoordinates(text)).toBeNull();
  });
});

describe("recent searches", () => {
  const r = (n: number) => ({ label: `P${n}`, lat: -33 - n / 100, lon: 150 });
  it("puts the newest first and keeps a repeat once", () => {
    const list = addRecentSearch(addRecentSearch([], r(1)), r(2));
    expect(addRecentSearch(list, r(1)).map((x) => x.label)).toEqual([
      "P1",
      "P2",
    ]);
  });
  it("caps the list", () => {
    let list: ReturnType<typeof addRecentSearch> = [];
    for (let i = 0; i < 20; i++) list = addRecentSearch(list, r(i));
    expect(list).toHaveLength(MAX_RECENT_SEARCHES);
    expect(list[0].label).toBe("P19");
  });
  it("reads junk from a store as empty and drops bad rows", () => {
    expect(readRecentSearches("x")).toEqual([]);
    expect(
      readRecentSearches([
        null,
        { label: 1 },
        { label: "a", lat: 1, lon: 2, extra: 1 },
      ]),
    ).toEqual([{ label: "a", lat: 1, lon: 2 }]);
  });
});

// Mutation: return the pick's point for "tap" or "clear", or drop a picked
// point (or keep a stale one when the pick is a place), and these go red.
describe("searchPinAfter", () => {
  it("drops the pin exactly at a picked point, label left out", () => {
    expect(
      searchPinAfter({ pick: { label: "x", lat: -33.7, lon: 150.3 } }),
    ).toEqual({
      lat: -33.7,
      lon: 150.3,
    });
  });
  it("is gone after a tap, a cleared box, or a pick that is not a point", () => {
    expect(searchPinAfter("tap")).toBeNull();
    expect(searchPinAfter("clear")).toBeNull();
    expect(searchPinAfter({ pick: null })).toBeNull();
  });
});

describe("search status words", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const clients = [
    "frontend/src/components/map/MapSearchBox.tsx",
    "mobile/src/map/MapSearchBar.tsx",
    "mobile/src/map/placeSearch.ts",
  ];

  // Mutation: type one of the five sentences back into a client's search file.
  it("are read from SEARCH_STATUS, never typed in a client", () => {
    for (const file of clients) {
      const source = readFileSync(join(root, file), "utf8");
      for (const sentence of Object.values(SEARCH_STATUS)) {
        expect(source, `${file}: ${sentence}`).not.toContain(`"${sentence}"`);
      }
    }
  });
});
