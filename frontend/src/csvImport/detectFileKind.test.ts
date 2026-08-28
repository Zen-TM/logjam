import { describe, it, expect } from "vitest";
import { detectFileKind } from "./detectFileKind";

describe("detectFileKind", () => {
  it("classifies a file with latitude+longitude as a canyon list", () => {
    expect(detectFileKind(["Name", "Latitude", "Longitude"])).toBe("canyon");
  });

  it("recognises lat/lng abbreviations", () => {
    expect(detectFileKind(["canyon", "lat", "lng"])).toBe("canyon");
    expect(detectFileKind(["site", "y", "x"])).toBe("canyon");
  });

  it("classifies a file with a date and name (no coords) as a logbook", () => {
    expect(detectFileKind(["Canyon", "Date", "Notes"])).toBe("triplog");
  });

  it("recognises date/name aliases", () => {
    expect(detectFileKind(["Location", "Trip Date"])).toBe("triplog");
    expect(detectFileKind(["place", "visited"])).toBe("triplog");
  });

  it("prefers canyon when coords AND a date are both present", () => {
    // A canyon list that also happens to carry a date column is still a canyon
    // list — coords are the strong signal.
    expect(
      detectFileKind(["Name", "Latitude", "Longitude", "Date"]),
    ).toBe("canyon");
  });

  it("returns unknown when neither coords nor (date+name) are present", () => {
    expect(detectFileKind(["Foo", "Bar", "Baz"])).toBe("unknown");
  });

  it("returns unknown for a date column with no name column", () => {
    expect(detectFileKind(["Date", "Notes"])).toBe("unknown");
  });

  it("returns unknown for a name column with no date and no coords", () => {
    expect(detectFileKind(["Canyon", "Notes"])).toBe("unknown");
  });

  it("returns unknown for empty headers", () => {
    expect(detectFileKind([])).toBe("unknown");
  });

  // FECO-004: detectFileKind used to keep its own copy of the header
  // normalizer, which never got the camelCase-splitting fix canyonColumns.ts
  // added for IMPORT-4 — so a `latDD`/`lonDD` file (with no override, since an
  // unknown-kind file never becomes a LoadedFile) failed detection outright.
  // Now both share canyonColumns.ts's `normalize`.
  it("recognises camelCase coordinate headers (latDD/lonDD) — FECO-004", () => {
    expect(detectFileKind(["Name", "latDD", "lonDD"])).toBe("canyon");
  });
});
