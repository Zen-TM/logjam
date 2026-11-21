import { describe, expect, it } from "vitest";
import {
  itemFieldDefs,
  newPlaceWords,
  SYSTEM_PLACE_TYPE_IDS,
} from "@logjam/shared";
import { placeDetailsInvalid } from "./placeDetailsInvalid";

const canyon = SYSTEM_PLACE_TYPE_IDS.canyon;
const defs = itemFieldDefs({ placeTypeId: canyon });
const valid = () => ({
  ...newPlaceWords(canyon, { latitude: -33.5, longitude: 150.25 }),
  name: "Test drop",
});

describe("placeDetailsInvalid", () => {
  it("passes a place with a position, and blank elevation and attributes", () => {
    expect(placeDetailsInvalid(valid(), defs)).toBe(false);
    expect(
      placeDetailsInvalid(
        { ...valid(), elevation: "812", "attr:v_grade": "3" },
        defs,
      ),
    ).toBe(false);
  });

  // Mutation: drop the blank check on latitude or longitude, and a place with
  // no position is sent.
  it("wants a latitude and a longitude", () => {
    expect(placeDetailsInvalid({ ...valid(), latitude: " " }, defs)).toBe(true);
    expect(placeDetailsInvalid({ ...valid(), longitude: "" }, defs)).toBe(true);
  });

  // Mutation: drop the range constraint from either axis.
  it("refuses a position off the globe", () => {
    expect(placeDetailsInvalid({ ...valid(), longitude: "200" }, defs)).toBe(
      true,
    );
    expect(placeDetailsInvalid({ ...valid(), latitude: "-91" }, defs)).toBe(
      true,
    );
  });

  // Mutation: drop the elevation check.
  it("refuses an elevation that is not a number", () => {
    expect(placeDetailsInvalid({ ...valid(), elevation: "high" }, defs)).toBe(
      true,
    );
  });

  // Mutation: drop the attribute check, and a grade outside its bounds is sent
  // for the API to refuse.
  it("refuses an attribute outside its bounds", () => {
    expect(
      placeDetailsInvalid({ ...valid(), "attr:v_grade": "99" }, defs),
    ).toBe(true);
  });
});
