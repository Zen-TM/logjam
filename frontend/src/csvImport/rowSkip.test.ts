import { describe, it, expect } from "vitest";
import { describeDroppedCanyonRow, describeDroppedTripRow } from "./rowSkip";

describe("describeDroppedCanyonRow", () => {
  it("returns null when name and coords are all readable", () => {
    expect(
      describeDroppedCanyonRow({
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
      describeDroppedCanyonRow({
        name: "",
        latitude: -33.6,
        longitude: 150.3,
        rawLatitude: "-33.6",
        rawLongitude: "150.3",
      }),
    ).toBe("name is missing");
  });

  it("reports an unreadable latitude with the offending raw value", () => {
    expect(
      describeDroppedCanyonRow({
        name: "Claustral",
        latitude: NaN,
        longitude: 150.3,
        rawLatitude: "not-a-number",
        rawLongitude: "150.3",
      }),
    ).toBe('latitude "not-a-number" couldn\'t be read');
  });

  it("reports an unreadable longitude with the offending raw value", () => {
    expect(
      describeDroppedCanyonRow({
        name: "Claustral",
        latitude: -33.6,
        longitude: NaN,
        rawLatitude: "-33.6",
        rawLongitude: "??",
      }),
    ).toBe('longitude "??" couldn\'t be read');
  });
});

describe("describeDroppedTripRow", () => {
  it("returns null for a readable date", () => {
    expect(describeDroppedTripRow("2023-06-15", "15/06/2023")).toBeNull();
  });

  it("reports an unreadable date with the offending raw value, matching the D5 example wording", () => {
    expect(describeDroppedTripRow(null, "15.06.2023")).toBe(
      'date "15.06.2023" couldn\'t be read',
    );
  });

  it("trims the raw value in the message", () => {
    expect(describeDroppedTripRow(null, "  garbage  ")).toBe('date "garbage" couldn\'t be read');
  });
});
