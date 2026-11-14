import { afterEach, describe, it, expect, vi } from "vitest";
import { toGridAt, type ExtentState } from "@logjam/shared";
import {
  coordTooltip,
  extentFieldText,
  parseExtentField,
  extentFieldErrors,
  hasExtentFieldError,
  scaleFieldError,
} from "./geoPdfExtentFields";

// A realistic Blue Mountains extent (MGA zone 56).
const baseState: ExtentState = {
  paperSize: "A4",
  orientation: "portrait",
  north: -33.5,
  south: -33.7,
  east: 150.4,
  west: 150.2,
  scale: 25000,
  coordMode: "latlon",
};

const values = (over: Partial<Record<"n" | "s" | "e" | "w", string>>) => ({
  n: String(baseState.north),
  s: String(baseState.south),
  e: String(baseState.east),
  w: String(baseState.west),
  ...over,
});

describe("parseExtentField", () => {
  it("passes degrees through in latlon mode", () => {
    expect(parseExtentField("n", "-33.55", baseState)).toBeCloseTo(-33.55, 10);
  });

  it("returns null for non-numeric and empty input", () => {
    expect(parseExtentField("n", "abc", baseState)).toBeNull();
    expect(parseExtentField("n", "", baseState)).toBeNull();
    expect(parseExtentField("n", "-", baseState)).toBeNull();
  });

  it("round-trips the displayed northing back to the same latitude (E/N mode)", () => {
    const en = { ...baseState, coordMode: "enNorthing" as const };
    const displayedN = toGridAt(en.north, en.west).northing;
    const lat = parseExtentField("n", displayedN.toFixed(1), en);
    expect(lat).not.toBeNull();
    expect(lat!).toBeCloseTo(en.north, 5);
  });

  it("round-trips the displayed easting back to the same longitude (E/N mode)", () => {
    const en = { ...baseState, coordMode: "enNorthing" as const };
    const displayedE = toGridAt(en.north, en.east).easting;
    const lon = parseExtentField("e", displayedE.toFixed(1), en);
    expect(lon).not.toBeNull();
    expect(lon!).toBeCloseTo(en.east, 5);
  });

  it("moving the northing up moves the latitude north (E/N mode)", () => {
    const en = { ...baseState, coordMode: "enNorthing" as const };
    const displayedN = toGridAt(en.north, en.west).northing;
    const lat = parseExtentField("n", String(displayedN + 1000), en);
    expect(lat!).toBeGreaterThan(en.north);
    expect(lat! - en.north).toBeCloseTo(1000 / 110540, 3); // ≈ metres per degree lat
  });
});

describe("extentFieldErrors", () => {
  it("is clean for a valid extent", () => {
    const errors = extentFieldErrors(values({}), baseState);
    expect(errors).toEqual({ n: null, s: null, e: null, w: null });
    expect(hasExtentFieldError(errors)).toBe(false);
  });

  it("requires numbers", () => {
    const errors = extentFieldErrors(values({ n: "abc", w: "" }), baseState);
    expect(errors.n).toBe("Enter a number");
    expect(errors.w).toBe("Enter a number");
  });

  it("enforces latitude and longitude ranges", () => {
    const errors = extentFieldErrors(values({ n: "95", e: "400" }), baseState);
    expect(errors.n).toMatch(/-90 and 90/);
    expect(errors.e).toMatch(/-180 and 180/);
  });

  it("flags an inverted North/South", () => {
    // North value south of South: -34 < -33.7.
    const errors = extentFieldErrors(values({ n: "-34" }), baseState);
    expect(errors.n).toBe("Must be north of the South value");
    expect(errors.s).toBeNull();
  });

  it("flags an inverted East/West", () => {
    const errors = extentFieldErrors(values({ e: "150.1" }), baseState);
    expect(errors.e).toBe("Must be east of the West value");
  });

  it("flags an inverted extent typed as MGA northings (E/N mode)", () => {
    const en = { ...baseState, coordMode: "enNorthing" as const };
    const southNorthing = toGridAt(en.south, en.east).northing;
    const errors = extentFieldErrors(
      {
        n: String(southNorthing - 5000), // north edge below the south edge
        s: String(southNorthing),
        e: String(toGridAt(en.north, en.east).easting),
        w: String(toGridAt(en.south, en.west).easting),
      },
      en,
    );
    expect(errors.n).toBe("Must be north of the South value");
  });
});

describe("scaleFieldError", () => {
  it("accepts a normal scale", () => {
    expect(scaleFieldError("25000")).toBeNull();
  });

  it("rejects empty, non-numeric, zero and negative", () => {
    expect(scaleFieldError("")).toBe("Enter a number");
    expect(scaleFieldError("abc")).toBe("Enter a number");
    expect(scaleFieldError("0")).toBe("Must be at least 1");
    expect(scaleFieldError("-25000")).toBe("Must be at least 1");
  });
});

// The text a field shows must parse back to the edge it shows, in both coord
// modes, or leaving a field untouched would move it. Mutation: pair an edge
// with another corner in `extentFieldText` (say, N with the east edge).
describe("extentFieldText", () => {
  it.each(["latlon", "enNorthing"] as const)(
    "parses back to the same edges in %s",
    (coordMode) => {
      const state = { ...baseState, coordMode };
      const edge = { n: "north", s: "south", e: "east", w: "west" } as const;
      for (const field of ["n", "s", "e", "w"] as const) {
        const back = parseExtentField(
          field,
          extentFieldText(field, state),
          state,
        );
        expect(back).toBeCloseTo(state[edge[field]], 5);
      }
    },
  );
});

afterEach(() => {
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).LOGJAM_SIM_REGIONS;
});

/** The module as it loads with the simulated regions on, which the grid reads once at load. */
async function withSimRegions() {
  vi.resetModules();
  (globalThis as Record<string, unknown>).LOGJAM_SIM_REGIONS = true;
  return import("./geoPdfExtentFields");
}

const asEN = (box: Pick<ExtentState, "north" | "south" | "east" | "west">) =>
  ({ ...baseState, ...box, coordMode: "enNorthing" }) as ExtentState;

// A sheet's four fields are one rectangle in one grid, the zone at its
// centre, as the printed grid is. Read each at its own corner's zone, the
// fields across a zone edge differ by hundreds of kilometres (or, across the
// equator, a 10,000 km false northing), and a sheet there can not be typed.
describe("the fields of a sheet across a zone edge or the equator", () => {
  const boxes = [
    [
      "MGA 55 and 56 at 150 E",
      { north: -33.6, south: -33.7, east: 150.05, west: 149.95 },
      9260,
      11100,
    ],
    [
      "UTM 32 and 33 at 12 E",
      { north: 46.05, south: 45.95, east: 12.05, west: 11.95 },
      7750,
      11100,
    ],
    [
      "the equator, a 10,000 km false northing on one side",
      { north: 0.05, south: -0.05, east: 12.1, west: 12.0 },
      11100,
      11100,
    ],
  ] as const;

  // Mutation: read each corner with `toGridAt` (its own zone) in `extentFieldText`.
  it.each(boxes)("shows %s as one rectangle", (_name, box, width, height) => {
    const state = asEN(box);
    const text = (field: "n" | "s" | "e" | "w") =>
      Number(extentFieldText(field, state));
    expect(Math.abs(text("e") - text("w") - width)).toBeLessThan(600);
    expect(Math.abs(text("n") - text("s") - height)).toBeLessThan(600);
  });

  // Mutation: pair `parseExtentField`'s edge with `toGridAt`'s zone for its corner.
  it.each(boxes)("parses back %s to the edges it shows", (_name, box) => {
    const state = asEN(box);
    const edge = { n: "north", s: "south", e: "east", w: "west" } as const;
    for (const field of ["n", "s", "e", "w"] as const) {
      expect(
        parseExtentField(field, extentFieldText(field, state), state),
      ).toBeCloseTo(state[edge[field]], 5);
    }
  });
});

// The extent follows the map into another world copy, past 180°, and the grid
// answers in [-180, 180]: a typed easting gives the longitude in the copy the
// extent is in. Mutation: return `point.lon` as it is from `sheetGrid`'s
// `fromGrid`, and the east edge reads back as -179.95.
it.each([
  ["east of 180", 179.95, 180.05],
  ["west of -180", -180.05, -179.95],
])(
  "reads an easting back in the world copy the extent is in, %s",
  (_name, west, east) => {
    const state = asEN({ north: -15.95, south: -16.05, east, west });
    expect(
      parseExtentField("e", extentFieldText("e", state), state),
    ).toBeCloseTo(east, 5);
    expect(
      parseExtentField("w", extentFieldText("w", state), state),
    ).toBeCloseTo(west, 5);
  },
);

// An easting the grid cannot place is refused in the name of the grid the sheet
// is in; with only NSW declared that is MGA wherever the sheet is, as the
// Layers popover reads. Mutation: write "MGA" in the message whatever the
// grid, and the Utah and NZ rows read it; drop the `Number.isFinite` guard in
// `sheetGrid`'s `fromGrid` and an Infinity longitude becomes NaN, which no
// range check refuses.
describe("a typed easting no grid can place", () => {
  const SYDNEY = { north: -33.6, south: -33.7, east: 150.4, west: 150.3 };
  const MELBOURNE = { north: -37.7, south: -37.9, east: 145.0, west: 144.8 };
  const UTAH = { north: 37.55, south: 37.45, east: -107.95, west: -108.05 };
  const WANAKA = { north: -44.6, south: -44.7, east: 169.2, west: 169.1 };

  it.each([
    ["Sydney", SYDNEY],
    ["Melbourne, which no region holds", MELBOURNE],
  ])("is named for MGA at %s with only NSW declared", (_name, box) => {
    expect(extentFieldErrors(values({ e: "1000000000" }), asEN(box)).e).toBe(
      "Not a valid MGA easting",
    );
  });

  it.each([
    ["Utah", UTAH, "UTM"],
    ["Wanaka", WANAKA, "NZTM"],
    ["Melbourne", MELBOURNE, "UTM"],
  ])(
    "is named for the grid at %s with regions declared",
    async (_name, box, grid) => {
      const { extentFieldErrors: errors } = await withSimRegions();
      expect(errors(values({ e: "1000000000" }), asEN(box)).e).toBe(
        `Not a valid ${grid} easting`,
      );
    },
  );
});

// The E/N chip's tooltip names the grid the Layers popover names for the same
// ground; NSW's, and Melbourne's with only NSW declared, read as they always
// have.
describe("the E/N chip's tooltip", () => {
  const NSW_TIP =
    "Lat/Lon is what a GPS shows you. E/N is the MGA2020 grid, the one printed on NSW topo maps.";

  // Mutation: have `gridOf` answer UTM for any extent outside NSW's border,
  // and Melbourne reads the UTM sentence.
  it.each([
    ["Sydney", { north: -33.6, south: -33.7, east: 150.4, west: 150.3 }],
    ["Melbourne", { north: -37.7, south: -37.9, east: 145.0, west: 144.8 }],
  ])("reads as it always has at %s", (_name, box) => {
    expect(coordTooltip(box)).toBe(NSW_TIP);
  });

  // Mutation: return NSW's sentence whatever the grid.
  it("names UTM in Utah and NZTM2000 in New Zealand when regions are declared", async () => {
    const { coordTooltip: tip } = await withSimRegions();
    expect(
      tip({ north: 37.55, south: 37.45, east: -107.95, west: -108.05 }),
    ).toMatch(/E\/N is the UTM grid/);
    expect(
      tip({ north: -44.6, south: -44.7, east: 169.2, west: 169.1 }),
    ).toMatch(
      /E\/N is the NZTM2000 grid, the one printed on New Zealand topo maps/,
    );
  });
});

// The extent follows the map into another world copy, so a sheet across the
// date line has an east edge past 180 and the dialog must take it in both
// modes. Mutation: test the longitude against a fixed -180 to 180 in
// `rangeError`, and Make is blocked for a sheet east of 180.
it.each(["latlon", "enNorthing"] as const)(
  "takes a sheet across the date line in %s",
  (coordMode) => {
    const state: ExtentState = {
      ...baseState,
      north: -15.95,
      south: -16.05,
      east: 180.05,
      west: 179.95,
      coordMode,
    };
    const typed = {
      n: extentFieldText("n", state),
      s: extentFieldText("s", state),
      e: extentFieldText("e", state),
      w: extentFieldText("w", state),
    };
    expect(extentFieldErrors(typed, state)).toEqual({
      n: null,
      s: null,
      e: null,
      w: null,
    });
  },
);
