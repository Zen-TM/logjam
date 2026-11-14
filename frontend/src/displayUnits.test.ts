import { afterEach, describe, expect, it } from "vitest";
import {
  displayUnits,
  formatDistance,
  NSW_REGION,
  setDisplayUnits,
  type Region,
} from "@logjam/shared";

import { applyDisplayUnits } from "./displayUnits";

afterEach(() => setDisplayUnits("metric"));

const FEET: Region = {
  ...NSW_REGION,
  id: "simutah",
  name: "Simulated Utah",
  units: "imperial",
};
const REGIONS = [NSW_REGION, FEET];

describe("applyDisplayUnits", () => {
  // Mutation: return `unitsOf(...)` without calling `setDisplayUnits`, and a
  // distance keeps its old unit after the account's units change.
  it("sets the units the formatters write in from the account", () => {
    expect(applyDisplayUnits({ units: "imperial" }, REGIONS)).toBe("imperial");
    expect(displayUnits()).toBe("imperial");
    expect(formatDistance(1609.344)).toBe("1.0 mi");
    applyDisplayUnits({ units: "metric" }, REGIONS);
    expect(formatDistance(1609.344)).toBe("1.6 km");
  });

  // Mutation: leave the units as they were when the account has none (signed
  // out, or loading), and the last account's units outlast it.
  it("falls back to the home region's units with no account", () => {
    applyDisplayUnits({ units: "imperial" }, REGIONS);
    expect(applyDisplayUnits(undefined, REGIONS)).toBe("metric");
    expect(displayUnits()).toBe("metric");
    expect(applyDisplayUnits({ regions: ["simutah"] }, REGIONS)).toBe(
      "imperial",
    );
  });
});
