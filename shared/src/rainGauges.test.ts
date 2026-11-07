import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type RainFile,
  RAIN_GAUGE_MAX_M,
  RAIN_GAUGES_SHOWN,
  RAIN_PATH,
  nearbyRain,
  parseRainFile,
  rainCredit,
  rainOnDate,
} from "./rainGauges.js";
import { GAUGE_PREFIX } from "./gauges.js";

// Written by topo/tests/test_gauges.py from build_gauges.build_rain: a reader
// that stops understanding the builder's file fails here.
const fixture = JSON.parse(
  readFileSync(join(__dirname, "__fixtures__", "rain.json"), "utf8"),
);

describe("the rain file", () => {
  it("sits beside the river gauges' files", () => {
    expect(RAIN_PATH).toBe(`${GAUGE_PREFIX}rain.json`);
  });

  // Mutation: rename a field on either side, or drop `start` → red.
  it("reads the file the builder writes", () => {
    const file = parseRainFile(fixture);
    expect(file).not.toBeNull();
    const [gauge] = file!.gauges;
    expect(rainOnDate(file!, gauge, "2026-10-21")).toBe(12.5);
    expect(rainOnDate(file!, gauge, "2026-10-20")).toBe(0);
    // The builder left out a day WDO marked missing: null, not 0.
    expect(rainOnDate(file!, gauge, "2026-10-22")).toBeNull();
    // Outside the file's days.
    expect(rainOnDate(file!, gauge, "2026-10-19")).toBeNull();
    expect(rainOnDate(file!, gauge, "2026-10-30")).toBeNull();
  });

  // Mutation: drop the length check → red; a gauge one day short would put
  // each total on the day before.
  it("refuses a gauge whose days don't line up, and a negative total", () => {
    const short = structuredClone(fixture);
    short.gauges[1].mm.pop();
    expect(parseRainFile(short)).toBeNull();
    const negative = structuredClone(fixture);
    negative.gauges[0].mm[0] = -1;
    expect(parseRainFile(negative)).toBeNull();
    expect(parseRainFile({ ...fixture, version: 2 })).toBeNull();
    expect(parseRainFile({ ...fixture, start: "20 Oct" })).toBeNull();
    expect(parseRainFile(null)).toBeNull();
  });
});

describe("nearbyRain", () => {
  const at = (lat: number, lon: number, mm: (number | null)[]) => ({
    id: `${lat}`,
    name: `GAUGE ${lat}`,
    lat,
    lon,
    mm,
  });
  // 0.01° of latitude is about 1.1 km.
  const spot = { latitude: -33.7, longitude: 150.3 };
  const file: RainFile = {
    version: 1,
    generatedAt: "2026-10-30T12:00:00Z",
    attribution: "© Made-up owner",
    start: "2026-10-20",
    gauges: [
      at(-33.75, 150.3, [1, 2, 3]), // 5.6 km
      at(-33.71, 150.3, [null, null, null]), // 1.1 km, nothing measured
      at(-33.72, 150.3, [0, null, 4]), // 2.2 km
      at(-33.8, 150.3, [5, 5, 5]), // 11 km
      at(-33.83, 150.3, [6, 6, 6]), // 14.5 km
      at(-33.84, 150.3, [7, 7, 7]), // 15.6 km
    ],
  };
  const dates = ["2026-10-20", "2026-10-21", "2026-10-22"];

  // Mutation: drop the distance filter, or the measured-day filter, or the
  // sort → red.
  it("picks the nearest few within reach that measured a day", () => {
    const rain = nearbyRain(file, spot, dates);
    expect(rain.gauges.map((g) => g.gauge.lat)).toEqual([
      -33.72, -33.75, -33.8,
    ]);
    expect(rain.gauges).toHaveLength(RAIN_GAUGES_SHOWN);
    expect(rain.gauges[0].mm).toEqual([0, null, 4]);
    expect(rain.gauges[0].distanceM).toBeCloseTo(2224, -1);
  });

  // Mutation: raise RAIN_GAUGE_MAX_M, or drop the distance filter → red.
  it("stops at the cutoff", () => {
    const far = { latitude: -33.95, longitude: 150.3 };
    // 12 km to -33.84, 13 km to -33.83: both in; the rest past 15 km.
    expect(nearbyRain(file, far, dates).gauges.map((g) => g.gauge.lat)).toEqual(
      [-33.84, -33.83],
    );
    expect(RAIN_GAUGE_MAX_M).toBe(15_000);
    const nowhere = nearbyRain(file, { latitude: -35, longitude: 150 }, dates);
    expect(nowhere.gauges).toEqual([]);
    expect(nowhere.near).toBe(false);
    expect(rainCredit(nowhere)).toBeNull();
  });

  // A gauge in reach that sent nothing for the dates is not drawn, but it is
  // near: the row must not say no gauge is. Mutation: compute `near` from the
  // drawn gauges → red.
  it("tells a near gauge with no data from no gauge near", () => {
    const silent = nearbyRain(file, { latitude: -33.71, longitude: 150.3 }, [
      "2026-10-29",
    ]);
    expect(silent.gauges).toEqual([]);
    expect(silent.near).toBe(true);
    expect(nearbyRain(file, spot, dates).near).toBe(true);
  });

  it("credits the owner only where a gauge is drawn", () => {
    expect(rainCredit(nearbyRain(file, spot, dates))).toBe("© Made-up owner");
    expect(rainCredit(null)).toBeNull();
  });
});
