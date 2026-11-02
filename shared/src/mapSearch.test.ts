import { describe, expect, it } from "vitest";
import {
  addRecentSearch,
  MAX_RECENT_SEARCHES,
  parseCoordinates,
  readRecentSearches,
} from "./mapSearch";
import { toEastingNorthing } from "./geoPdfExtent";

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
    const back = toEastingNorthing(p.lat, p.lon);
    expect(back.zone).toBe(56);
    expect(back.easting).toBeCloseTo(245000, 0);
    expect(back.northing).toBeCloseTo(6264000, 0);
  });

  // Mutation: decimals back outside the capture groups (metres truncated).
  it("keeps the metres' decimals", () => {
    const p = parseCoordinates("56 245000.6 6264000.4")!;
    const back = toEastingNorthing(p.lat, p.lon);
    expect(back.easting).toBeCloseTo(245000.6, 1);
    expect(back.northing).toBeCloseTo(6264000.4, 1);
  });

  it.each([
    "",
    "Katoomba",
    "245000 6264000", // no zone: not guessed
    "56 24500 6264000",
    "57 245000 6264000",
    "56 245000 5000000", // lands outside Australia
    "-33.71", // one number
    "33.71S 150.31S", // two latitudes
    "33.71S 150.31", // letter on one part only
    "200 300",
    "-33.71, 10.31", // neither longitude nor latitude fits
    `33°72'00"S 150°18'36"E`, // 72 minutes
    "1 2 3 4",
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
