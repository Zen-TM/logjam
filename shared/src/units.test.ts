import { afterEach, describe, expect, it } from "vitest";
import { formatNumber } from "./numberFormat.js";
import { formatElevationM } from "./profileSeries.js";
import { formatDistanceM, formatSpeedMps } from "./trackStats.js";
import { formatRainMm, weatherDayFacts } from "./contracts/weather.js";
import {
  displayUnits,
  formatArea,
  formatDistance,
  formatBoxSize,
  formatFixedMetres,
  formatGroundStep,
  formatHeight,
  formatHeightRange,
  formatRain,
  formatSpeed,
  formatTemperature,
  formatTemperatureRange,
  formatWind,
  lengthFromInput,
  lengthToInput,
  lengthUnitLabel,
  offersUnitsChoice,
  setDisplayUnits,
  unitsOf,
} from "./units.js";
import { NSW_REGION, simRegionsOn } from "./regions.js";
import { SIM_NZ, SIM_REGIONS, SIM_UTAH } from "./simRegions.js";

afterEach(() => setDisplayUnits("metric"));

// What Logjam wrote before this module, copied verbatim, so the metric branch
// cannot drift from it. Mutation: change a threshold or a decimal in the
// metric branch of units.ts and the sweep below turns red.
const NBSP = " ";
const was = {
  distance: (m: number) =>
    !Number.isFinite(m)
      ? "—"
      : m < 1000
        ? `${Math.round(m)} m`
        : `${(m / 1000).toFixed(1)} km`,
  speed: (mps: number | null) =>
    mps == null || !Number.isFinite(mps) || mps < 0
      ? "—"
      : `${(mps * 3.6).toFixed(1)} km/h`,
  elevation: (m: number) => `${Math.round(m)} m`,
  rain: (mm: number) =>
    `${mm > 0 && mm < 1 ? mm.toFixed(1) : Math.round(mm)}${NBSP}mm`,
  wind: (kmh: number) => `${Math.round(kmh)}${NBSP}km/h`,
  area: (km2: number) =>
    km2 >= 10
      ? `${km2.toFixed(0)} km²`
      : km2 > 0 && km2 < 0.005
        ? "<0.01 km²"
        : `${km2.toFixed(2)} km²`,
  degrees: (c: number) => `${Math.round(c)}°`,
};

// Values on and around every threshold, negatives, and a spread of decimals.
const SWEEP: number[] = [
  -1234.5, -50, -0.6, -0.4, 0, 0.001, 0.004, 0.005, 0.049, 0.05, 0.4, 0.5, 0.95,
  1, 1.5, 9.994, 9.995, 10, 14.5, 99.5, 849.5, 850, 999, 999.4, 999.5, 1000,
  1049, 1050, 1203.4, 1203.5, 5000.04, 123456.789,
];
for (let i = 0; i < 200; i++) SWEEP.push(i * 13.37 + (i % 7) * 0.113);

describe("metric output is what Logjam wrote before", () => {
  // Mutation: `let current: Units = "imperial"` in units.ts.
  it("is the default", () => {
    expect(displayUnits()).toBe("metric");
  });

  it("matches the old formatters over a sweep, through the old names too", () => {
    expect(SWEEP.length).toBeGreaterThan(200);
    for (const n of SWEEP) {
      expect(formatDistance(n)).toBe(was.distance(n));
      expect(formatDistanceM(n)).toBe(was.distance(n));
      expect(formatHeight(n)).toBe(was.elevation(n));
      expect(formatElevationM(n)).toBe(was.elevation(n));
      expect(formatSpeed(n)).toBe(was.speed(n));
      expect(formatSpeedMps(n)).toBe(was.speed(n));
      expect(formatRain(n)).toBe(was.rain(n));
      expect(formatRainMm(n)).toBe(was.rain(n));
      expect(formatWind(n)).toBe(was.wind(n));
      expect(formatTemperature(n)).toBe(was.degrees(n));
      if (n >= 0) expect(formatArea(n)).toBe(was.area(n));
    }
    expect(formatDistance(NaN)).toBe("—");
    expect(formatDistance(Infinity)).toBe("—");
    expect(formatSpeed(null)).toBe("—");
    expect(formatSpeed(-1)).toBe("—");
  });

  // Mutation: `NBSP` in units.ts becomes a plain space.
  it("keeps the weather card's literal strings", () => {
    const day = weatherDayFacts(
      {
        date: "2026-11-20",
        code: 3,
        tempMinC: 4.4,
        tempMaxC: 17.2,
        rainMm: 6.2,
        rainChance: 40,
        windMaxKmh: 23.4,
      } as Parameters<typeof weatherDayFacts>[0],
      Date.UTC(2026, 10, 19, 12),
    );
    expect(day.temperature).toBe("4–17°");
    expect(day.rain).toBe(`6${NBSP}mm`);
    expect(day.wind).toBe(`23${NBSP}km/h`);
    expect(formatTemperatureRange(4.4, 17.2)).toBe("4–17°");
  });

  // Mutation: `lengthUnitLabel` returns "ft" in both branches.
  it("writes literal examples", () => {
    expect(formatDistance(850)).toBe("850 m");
    expect(formatDistance(1250)).toBe("1.3 km");
    expect(formatHeight(1203.4)).toBe("1203 m");
    expect(formatSpeed(1)).toBe("3.6 km/h");
    expect(formatArea(0.3)).toBe("0.30 km²");
    expect(formatArea(0.001)).toBe("<0.01 km²");
    expect(formatArea(152.6)).toBe("153 km²");
    expect(formatRain(0.3)).toBe(`0.3${NBSP}mm`);
    expect(formatRain(6.2)).toBe(`6${NBSP}mm`);
    expect(formatWind(23.4)).toBe(`23${NBSP}km/h`);
    expect(lengthUnitLabel()).toBe("m");
  });

  // Mutation: drop `!Number.isFinite(km2)` from `formatArea`'s guard (NaN passes), or its `km2 < 0` half (-1 passes).
  it("throws on an invalid area, as before", () => {
    expect(() => formatArea(-1)).toThrow();
    expect(() => formatArea(NaN)).toThrow();
  });
});

describe("imperial", () => {
  // Mutation: `FEET_BELOW_METRES = 0.2 * METRES_PER_MILE` in units.ts.
  it("writes feet below 0.1 mi and miles from it", () => {
    setDisplayUnits("imperial");
    expect(formatDistance(0)).toBe("0 ft");
    expect(formatDistance(100)).toBe("328 ft");
    expect(formatDistance(160)).toBe("525 ft");
    expect(formatDistance(161)).toBe("0.1 mi");
    expect(formatDistance(850)).toBe("0.5 mi");
    expect(formatDistance(1609.344)).toBe("1.0 mi");
    expect(formatDistance(1930)).toBe("1.2 mi");
    expect(formatDistance(42195)).toBe("26.2 mi");
    expect(formatDistance(NaN)).toBe("—");
  });

  // Mutation: drop `+ 32` from the temperature conversion, or the area boundary `>= 10` becomes `>= 11`.
  it("writes the other figures", () => {
    setDisplayUnits("imperial");
    expect(displayUnits()).toBe("imperial");
    expect(formatHeight(1203.4)).toBe("3948 ft");
    expect(formatElevationM(100)).toBe("328 ft");
    expect(formatSpeed(1)).toBe("2.2 mph");
    expect(formatSpeedMps(null)).toBe("—");
    expect(formatWind(16.09344)).toBe(`10${NBSP}mph`);
    expect(formatRain(6)).toBe(`0.24${NBSP}in`);
    expect(formatRain(0)).toBe(`0.00${NBSP}in`);
    expect(formatRain(30)).toBe(`1.2${NBSP}in`);
    expect(formatTemperature(0)).toBe("32°");
    expect(formatTemperature(14)).toBe("57°");
    expect(formatTemperature(-10)).toBe("14°");
    expect(formatTemperatureRange(4, 17)).toBe("39–63°");
    expect(formatArea(26)).toBe("10 sq mi");
    expect(formatArea(1)).toBe("0.39 sq mi");
    expect(formatArea(0.0005)).toBe("<0.01 sq mi");
    expect(formatArea(0)).toBe("0.00 sq mi");
    expect(() => formatArea(-1)).toThrow();
    expect(lengthUnitLabel()).toBe("ft");
  });

  // Mutation: `lengthFromInput` divides by `METRES_PER_FOOT` where it should multiply.
  it("converts what a length field holds both ways", () => {
    expect(lengthFromInput(35)).toBe(35);
    expect(lengthToInput(35)).toBe(35);
    setDisplayUnits("imperial");
    expect(lengthFromInput(100)).toBeCloseTo(30.48, 10);
    expect(lengthToInput(30.48)).toBeCloseTo(100, 10);
    for (const metres of [0, 1, 12.5, 30, 250.25]) {
      expect(lengthFromInput(lengthToInput(metres))).toBeCloseTo(metres, 10);
    }
  });
});

describe("weather facts in imperial", () => {
  const facts = (rainMm: number, windKmh: number) =>
    weatherDayFacts(
      {
        date: "2026-11-20",
        code: 3,
        tempMinC: 4,
        tempMaxC: 17,
        rainMm,
        rainChance: 40,
        windMaxKmh: windKmh,
      } as Parameters<typeof weatherDayFacts>[0],
      Date.UTC(2026, 10, 19, 12),
    );

  // Mutation: `figureOrNone` in weather.ts returns `text` unconditionally.
  it("draws the dash where the written figure would read zero", () => {
    setDisplayUnits("imperial");
    // 0.06 mm is 0.002 in ("0.00 in"); 0.6 km/h is 0.4 mph ("0 mph").
    expect(facts(0.06, 0.6)).toMatchObject({ rain: "–", wind: "–" });
    expect(facts(0.2, 1.2)).toMatchObject({
      rain: `0.01${NBSP}in`,
      wind: `1${NBSP}mph`,
    });
  });

  // Mutation: `RAIN_SHOWN_MM = 0.1` in weather.ts.
  it("still draws metric figures from 0.05 mm and 0.5 km/h", () => {
    expect(facts(0.05, 0.5)).toMatchObject({
      rain: `0.1${NBSP}mm`,
      wind: `1${NBSP}km/h`,
    });
    expect(facts(0.04, 0.4)).toMatchObject({ rain: "–", wind: "–" });
  });
});

describe("formatNumber", () => {
  // Mutation: `formatNumber` goes through `toLocaleString("en-US", …)`, which groups 1234567.9.
  it("is toFixed, with no grouping: grouping is the language's call", () => {
    expect(formatNumber(1203, 0)).toBe("1203");
    expect(formatNumber(1234567.891, 1)).toBe("1234567.9");
    expect(formatNumber(0.5, 2)).toBe("0.50");
  });
});

describe("one unit after two figures", () => {
  // Mutation: in `formatHeightRange` or `formatBoxSize` write the unit after
  // each figure ("412 m–655 m"), or round the box sides with `Math.floor`.
  it("writes metric as Logjam did before", () => {
    expect(formatHeightRange(411.6, 655.2)).toBe("412–655 m");
    expect(formatBoxSize(17.6, 11.4)).toBe("18 × 11 km");
  });

  // Mutation: `formatBoxSize` converts with `METRES_PER_MILE` (a km as miles),
  // or `formatHeightRange` leaves the metres unconverted.
  it("writes imperial in feet and miles", () => {
    setDisplayUnits("imperial");
    expect(formatHeightRange(300, 600)).toBe("984–1969 ft");
    expect(formatBoxSize(16.09344, 8.04672)).toBe("10 × 5 mi");
  });
});

describe("formatGroundStep", () => {
  // Mutation: `formatGroundStep` rounds `metres` where it should round the
  // converted `value` (imperial 9 m would read "29.5 ft", not "30 ft"), or
  // drops the `Number.isInteger` check ("2 m" reads "2.0 m").
  it("writes a map's ground step in the shown unit, whole from 10 up", () => {
    expect(formatGroundStep(0.5)).toBe("0.5 m");
    expect(formatGroundStep(2.04)).toBe("2 m");
    expect(formatGroundStep(2.4)).toBe("2.4 m");
    expect(formatGroundStep(31.6)).toBe("32 m");
    setDisplayUnits("imperial");
    expect(formatGroundStep(0.5)).toBe("1.6 ft");
    expect(formatGroundStep(2.4)).toBe("7.9 ft");
    expect(formatGroundStep(9)).toBe("30 ft");
    expect(formatGroundStep(31.6)).toBe("104 ft");
  });
});

describe("formatFixedMetres", () => {
  // Mutation: `formatFixedMetres` converts when the units are imperial, or
  // writes a space before the "m".
  it("writes a contour label and a resolution tight, in metres, in either setting", () => {
    expect(formatFixedMetres(1200)).toBe("1200m");
    expect(formatFixedMetres(0.5)).toBe("0.5m");
    setDisplayUnits("imperial");
    expect(formatFixedMetres(1200)).toBe("1200m");
  });
});

describe("offersUnitsChoice", () => {
  // Mutation: test `regions.length > 0` instead of a region that uses feet,
  // and prod, which declares NSW alone, shows a choice with nothing to choose.
  it("is not offered while every region is metric, prod's NSW alone included", () => {
    expect(offersUnitsChoice([NSW_REGION])).toBe(false);
    expect(offersUnitsChoice([NSW_REGION, SIM_NZ])).toBe(false);
    // Prod's own declaration: the premise is that the simulated regions are off.
    expect(simRegionsOn()).toBe(false);
    expect(offersUnitsChoice()).toBe(false);
  });

  // Mutation: return false, or declare `SIM_UTAH` metric, and an account whose
  // region uses feet is never asked its units.
  it("is offered once a region uses feet", () => {
    expect(offersUnitsChoice([NSW_REGION, SIM_UTAH])).toBe(true);
    // The simulated regions, which the switch declares, hold one that does.
    expect(offersUnitsChoice(SIM_REGIONS)).toBe(true);
  });
});

describe("unitsOf", () => {
  const REGIONS_THREE = [NSW_REGION, SIM_NZ, SIM_UTAH];

  // Mutation: ignore `uiPreferences.units`, and a choice made in Settings
  // never changes a figure; or prefer the region over it, and it is undone.
  it("is the user's choice, whichever region is home", () => {
    expect(
      unitsOf({ units: "imperial", regions: ["nsw"] }, REGIONS_THREE),
    ).toBe("imperial");
    expect(
      unitsOf({ units: "metric", regions: ["simutah"] }, REGIONS_THREE),
    ).toBe("metric");
  });

  // Mutation: take the last chosen region instead of the first in `REGIONS`
  // order, or default to metric whatever the region says.
  it("is the home region's when nothing was chosen, and never throws on damage", () => {
    expect(unitsOf({ regions: ["simutah"] }, REGIONS_THREE)).toBe("imperial");
    expect(unitsOf({ regions: ["simnz", "simutah"] }, REGIONS_THREE)).toBe(
      "metric",
    );
    expect(unitsOf({ regions: ["nsw", "simutah"] }, REGIONS_THREE)).toBe(
      "metric",
    );
    for (const prefs of [undefined, null, {}, { units: "furlongs" }, 7]) {
      expect(unitsOf(prefs, REGIONS_THREE)).toBe("metric");
    }
  });
});
