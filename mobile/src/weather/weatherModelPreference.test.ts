// Mutation that turns it red: return the stored string without `isWeatherModelId`
// (a model Open-Meteo no longer serves is then requested for good), or write
// under another key than the one read.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readWeatherModel, writeWeatherModel } from "./weatherModelPreference";

const store = vi.hoisted(() => new Map<string, string>());
vi.mock("../prefsDb", () => ({
  readPref: (key: string) => store.get(key) ?? null,
  writePref: (key: string, value: string) => {
    store.set(key, value);
    return true;
  },
}));

beforeEach(() => store.clear());

describe("the weather model preference", () => {
  it("is best match until one is chosen, then the one chosen", () => {
    expect(readWeatherModel()).toBe("best_match");
    writeWeatherModel("ecmwf_ifs");
    expect(readWeatherModel()).toBe("ecmwf_ifs");
  });

  it("reads a model the list doesn't have as best match", () => {
    store.set("weatherModel", "bom_access_global");
    expect(readWeatherModel()).toBe("best_match");
  });
});
