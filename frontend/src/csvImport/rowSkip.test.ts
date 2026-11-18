import { describe, it, expect } from "vitest";
import {
  describeDroppedPlaceRow,
  describeDroppedTripRow,
  skippedRowLine,
} from "./rowSkip";

describe("describeDroppedPlaceRow", () => {
  it("returns null when name and coords are all readable", () => {
    expect(
      describeDroppedPlaceRow({
        name: "Claustral",
        latitude: -33.6,
        longitude: 150.3,
        rawLatitude: "-33.6",
        rawLongitude: "150.3",
      }),
    ).toBeNull();
  });

  it("reports a missing name", () => {
    expect(
      describeDroppedPlaceRow({
        name: "",
        latitude: -33.6,
        longitude: 150.3,
        rawLatitude: "-33.6",
        rawLongitude: "150.3",
      }),
    ).toEqual({ kind: "name" });
  });

  it("reports an unreadable latitude with the offending raw value", () => {
    expect(
      describeDroppedPlaceRow({
        name: "Claustral",
        latitude: NaN,
        longitude: 150.3,
        rawLatitude: "not-a-number",
        rawLongitude: "150.3",
      }),
    ).toEqual({ kind: "latitude", raw: "not-a-number" });
  });

  it("reports an unreadable longitude with the offending raw value", () => {
    expect(
      describeDroppedPlaceRow({
        name: "Claustral",
        latitude: -33.6,
        longitude: NaN,
        rawLatitude: "-33.6",
        rawLongitude: "??",
      }),
    ).toEqual({ kind: "longitude", raw: "??" });
  });
});

describe("describeDroppedTripRow", () => {
  it("returns null for a readable date", () => {
    expect(describeDroppedTripRow("2023-06-15", "15/06/2023")).toBeNull();
  });

  it("reports an unreadable date with the offending raw value", () => {
    expect(describeDroppedTripRow(null, "15.06.2023")).toEqual({
      kind: "date",
      raw: "15.06.2023",
    });
  });

  it("trims the raw value in the message", () => {
    expect(describeDroppedTripRow(null, "  garbage  ")).toEqual({
      kind: "date",
      raw: "garbage",
    });
  });
});

// Mutation: drop one `case` of skippedRowLine, or put its row number after the
// reason, and the line differs from what the importer has always shown.
describe("skippedRowLine", () => {
  it("is one whole sentence per reason", () => {
    expect(skippedRowLine(4, { kind: "name" })).toBe(
      "Row 4: name is missing — skipped",
    );
    expect(skippedRowLine(4, { kind: "latitude", raw: "x" })).toBe(
      'Row 4: latitude "x" couldn\'t be read — skipped',
    );
    expect(skippedRowLine(5, { kind: "longitude", raw: "??" })).toBe(
      'Row 5: longitude "??" couldn\'t be read — skipped',
    );
    expect(skippedRowLine(6, { kind: "date", raw: "soon" })).toBe(
      'Row 6: date "soon" couldn\'t be read — skipped',
    );
  });
});
