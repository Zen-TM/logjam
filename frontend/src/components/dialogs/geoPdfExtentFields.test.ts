import { describe, it, expect } from "vitest";
import { toEastingNorthing, type ExtentState } from "@logjam/shared";
import {
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
  lockMode: "scale",
  pivot: "mc",
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
    const displayedN = toEastingNorthing(en.north, en.west).northing;
    const lat = parseExtentField("n", displayedN.toFixed(1), en);
    expect(lat).not.toBeNull();
    expect(lat!).toBeCloseTo(en.north, 5);
  });

  it("round-trips the displayed easting back to the same longitude (E/N mode)", () => {
    const en = { ...baseState, coordMode: "enNorthing" as const };
    const displayedE = toEastingNorthing(en.north, en.east).easting;
    const lon = parseExtentField("e", displayedE.toFixed(1), en);
    expect(lon).not.toBeNull();
    expect(lon!).toBeCloseTo(en.east, 5);
  });

  it("moving the northing up moves the latitude north (E/N mode)", () => {
    const en = { ...baseState, coordMode: "enNorthing" as const };
    const displayedN = toEastingNorthing(en.north, en.west).northing;
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

  it("requires numbers (the UAT non-numeric case)", () => {
    const errors = extentFieldErrors(values({ n: "abc", w: "" }), baseState);
    expect(errors.n).toBe("Enter a number");
    expect(errors.w).toBe("Enter a number");
  });

  it("enforces latitude and longitude ranges", () => {
    const errors = extentFieldErrors(values({ n: "95", e: "200" }), baseState);
    expect(errors.n).toMatch(/-90 and 90/);
    expect(errors.e).toMatch(/-180 and 180/);
  });

  it("flags an inverted North/South (the UAT GEOPDF-1 case)", () => {
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
    const southNorthing = toEastingNorthing(en.south, en.east).northing;
    const errors = extentFieldErrors(
      {
        n: String(southNorthing - 5000), // north edge below the south edge
        s: String(southNorthing),
        e: String(toEastingNorthing(en.north, en.east).easting),
        w: String(toEastingNorthing(en.south, en.west).easting),
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
