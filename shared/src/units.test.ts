import { afterEach, describe, expect, it } from "vitest";
import { formatNumber } from "./numberFormat.js";
import { formatElevationM } from "./profileSeries.js";
import { formatDistanceM, formatSpeedMps } from "./trackStats.js";
import {
  formatRainMm,
  weatherDayFacts,
  weatherRows,
} from "./contracts/weather.js";
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
  formatScaleStep,
  formatSpeed,
  formatTemperature,
  formatTemperatureRange,
  formatWind,
  lengthFromInput,
  lengthInputText,
  lengthToInput,
  lengthUnitLabel,
  choosesUnits,
  offersUnitsChoice,
  scaleBarSteps,
  setDisplayUnits,
  unitsOf,
} from "./units.js";
import { withFieldUnit, withRowUnit } from "./contracts/placePage.js";
import { formatThreshold } from "./placeFilterOptions.js";
import {
  coerceFieldInput,
  customFieldDisplayLabel,
  fieldInputText,
  withLengthUnit,
} from "./tripLogFields.js";
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

describe("scale bars", () => {
  // The step lists and labels the two bars wrote before this module, verbatim.
  const screenWas = [
    1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000,
    50_000, 100_000, 200_000, 500_000,
  ];
  const printWas = [100, 250, 500, 1000, 2000, 5000, 10000];
  const screenLabelWas = (m: number) =>
    m >= 1_000
      ? `${Number.isInteger(m / 1_000) ? m / 1_000 : (m / 1_000).toFixed(1)} km`
      : `${m} m`;
  const printLabelWas = (m: number) =>
    m >= 1000 ? `${m / 1000} km` : `${m} m`;

  // Mutation: add a step to the metric `screen` or `print` list in units.ts,
  // or change `formatScaleStep`'s metric branch to `formatDistance`.
  it("are what Logjam drew in metric, label by label", () => {
    expect(scaleBarSteps("screen")).toEqual(screenWas);
    expect(scaleBarSteps("print")).toEqual(printWas);
    for (const m of screenWas)
      expect(formatScaleStep(m)).toBe(screenLabelWas(m));
    for (const m of printWas) expect(formatScaleStep(m)).toBe(printLabelWas(m));
    // A clamped bar's label is of an arbitrary whole number of metres.
    expect(formatScaleStep(1500)).toBe("1.5 km");
    expect(formatScaleStep(7)).toBe("7 m");
  });

  // Mutation: `SCALE_STEPS.screen.imperial` becomes the metric list, or
  // `formatScaleStep` writes feet where it should write miles from half a mile.
  it("are round in feet then miles in imperial", () => {
    setDisplayUnits("imperial");
    for (const kind of ["screen", "print"] as const) {
      const steps = scaleBarSteps(kind);
      expect(steps.length).toBeGreaterThan(6);
      expect(steps).toEqual([...steps].sort((a, b) => a - b));
    }
    const labels = (kind: "screen" | "print") =>
      scaleBarSteps(kind).map(formatScaleStep);
    expect(labels("screen")).toEqual([
      "1 ft",
      "2 ft",
      "5 ft",
      "10 ft",
      "20 ft",
      "50 ft",
      "100 ft",
      "200 ft",
      "500 ft",
      "1000 ft",
      "2000 ft",
      "0.5 mi",
      "1 mi",
      "2 mi",
      "5 mi",
      "10 mi",
      "20 mi",
      "50 mi",
      "100 mi",
      "200 mi",
      "500 mi",
    ]);
    expect(labels("print")).toEqual([
      "200 ft",
      "500 ft",
      "1000 ft",
      "2000 ft",
      "0.5 mi",
      "1 mi",
      "2 mi",
      "5 mi",
      "10 mi",
    ]);
    // A clamped bar: 2500 m is 1.55 mi.
    expect(formatScaleStep(2500)).toBe("1.6 mi");
  });
});

describe("a length field", () => {
  const longest = "longest_abseil";

  // Mutation: `withFieldUnit` writes `${text} m` whatever the units, or
  // `isLengthField` is true for `num_abseils` too ("6 m").
  it("is read in the display units, and in metric as it always was", () => {
    expect(withFieldUnit(longest, "15")).toBe("15 m");
    expect(withFieldUnit(longest, "12.345")).toBe("12.345 m");
    expect(withFieldUnit("num_abseils", "6")).toBe("6");
    expect(withRowUnit([longest, "Longest pitch", 15, "float"])[2]).toBe(
      "15 m",
    );
    setDisplayUnits("imperial");
    expect(withFieldUnit(longest, "15")).toBe("49.2 ft");
    expect(withFieldUnit("num_abseils", "6")).toBe("6");
    expect(withRowUnit([longest, "Longest pitch", 30.48, "float"])[2]).toBe(
      "100 ft",
    );
    // Text that is not a number keeps its words, with the unit it is read in.
    expect(withFieldUnit(longest, "about 15")).toBe("about 15 ft");
  });

  // Mutation: `fieldInputText` returns `String(stored)` for a length, or
  // `coerceFieldInput` skips `lengthFromInput`.
  it("is typed in the display units and stored in metres", () => {
    expect(fieldInputText(longest, 15)).toBe("15");
    expect(coerceFieldInput(longest, "15", "float")).toBe(15);
    setDisplayUnits("imperial");
    expect(fieldInputText(longest, 30.48)).toBe("100");
    expect(fieldInputText(longest, null)).toBe("");
    expect(coerceFieldInput(longest, "100", "float")).toBeCloseTo(30.48, 10);
    expect(coerceFieldInput(longest, "", "float")).toBeNull();
    // Another field is untouched by the unit.
    expect(fieldInputText("num_abseils", 6)).toBe("6");
    expect(coerceFieldInput("num_abseils", "6", "integer")).toBe(6);
  });

  // Mutation: `withLengthUnit` appends the unit in metric too, or for every
  // key, or `customFieldDisplayLabel` stops calling it.
  it("says the unit it is typed in once the setting is not metric", () => {
    const def = (key: string, over = {}) =>
      ({ key, label: "Longest pitch", type: "float", ...over }) as Parameters<
        typeof customFieldDisplayLabel
      >[0];
    const longestDef = def(longest, { min: 0, max: null });
    expect(customFieldDisplayLabel(longestDef)).toBe("Longest pitch (0+)");
    expect(withLengthUnit(longest, "Longest pitch")).toBe("Longest pitch");
    setDisplayUnits("imperial");
    expect(customFieldDisplayLabel(longestDef)).toBe("Longest pitch (0+ ft)");
    expect(customFieldDisplayLabel(def(longest))).toBe("Longest pitch (ft)");
    expect(withLengthUnit(longest, "Longest pitch")).toBe("Longest pitch (ft)");
    expect(customFieldDisplayLabel(def("num_abseils", { min: 0 }))).toBe(
      "Longest pitch (0+)",
    );
  });

  // Mutation: drop the rounding in `lengthFromInput` (`value * METRES_PER_FOOT`
  // alone): 35 ft stores 10.668000000000001 m.
  it("stores feet as clean metres a metric reader reads exactly", () => {
    setDisplayUnits("imperial");
    const ten = coerceFieldInput(longest, "35", "float");
    const ninety = coerceFieldInput(longest, "98.4", "float");
    expect([ten, ninety]).toEqual([10.668, 29.99232]);
    // Nothing switched: the feet typed read back as typed.
    expect(fieldInputText(longest, ninety)).toBe("98.4");
    setDisplayUnits("metric");
    expect(fieldInputText(longest, ten)).toBe("10.668");
    expect(fieldInputText(longest, ninety)).toBe("29.99232");
    expect(withFieldUnit(longest, String(ten))).toBe("10.668 m");
    expect(formatThreshold(["More than", ten as number], true)).toBe(
      "Over 10.668",
    );
  });

  // Mutation: drop the `stored` comparison from `coerceFieldInput`, and a
  // save with nothing edited turns 15 m into 14.9961 m.
  it("keeps its stored metres while the text is as it was shown", () => {
    setDisplayUnits("imperial");
    const shown = fieldInputText(longest, 15);
    expect(shown).toBe("49.2");
    expect(coerceFieldInput(longest, shown, "float", 15)).toBe(15);
    // Edited: the new text wins.
    expect(coerceFieldInput(longest, "50", "float", 15)).toBeCloseTo(15.24, 10);
  });

  // Mutation: `formatThreshold` writes `filter[1]` for a length in imperial.
  it("writes a filter's threshold in the display units, with no unit, as before", () => {
    expect(formatThreshold(["More than", 30], true)).toBe("Over 30");
    expect(formatThreshold(["More than", 30])).toBe("Over 30");
    setDisplayUnits("imperial");
    expect(formatThreshold(["More than", 30.48], true)).toBe("Over 100");
    expect(formatThreshold(["Less than", 6])).toBe("Under 6");
  });
});

describe("lengthInputText", () => {
  // Mutation: `lengthInputText` rounds in metric too (12.345 reads "12.3").
  it("keeps the stored digits in metric and rounds feet to one decimal", () => {
    expect(lengthInputText(12.345)).toBe("12.345");
    expect(lengthInputText(40)).toBe("40");
    setDisplayUnits("imperial");
    expect(lengthInputText(30.48)).toBe("100");
    expect(lengthInputText(35)).toBe("114.8");
    expect(lengthInputText(0)).toBe("0");
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

  // Mutation: `temperature` in `weatherDayFacts` goes back to
  // `${Math.round(day.tempMinC)}–${Math.round(day.tempMaxC)}°`, or the hour
  // card's goes back to `${Math.round(hour.tempC)}°`.
  it("converts a day's and an hour's temperature, and keeps its degrees sign", () => {
    setDisplayUnits("imperial");
    // 4 °C is 39.2 °F and 17 °C is 62.6 °F.
    expect(facts(0, 0).temperature).toBe("39–63°");
    const hour = { at: 0, time: "2026-11-19T12:00", code: 3 } as const;
    const forecast = {
      fetchedAt: 0,
      hours: [{ ...hour, tempC: 14, rainMm: 0, rainChance: null, windKmh: 0 }],
      days: [],
      past: { source: "model", days: [] },
    } as unknown as Parameters<typeof weatherRows>[0];
    expect(weatherRows(forecast, 0)[0].cards[0].temperature).toBe("57°");
  });

  // Mutation: `rainLevels` in weather.ts goes back to
  // `value >= RAIN_SHOWN_MM ? value / full : 0`.
  it("draws no bar for rain its text reads as the dash", () => {
    const level = (rainMm: number) => {
      const forecast = {
        fetchedAt: 0,
        hours: [],
        days: [],
        past: {
          source: "model",
          days: [{ date: "2026-11-18", rainMm }],
        },
      } as unknown as Parameters<typeof weatherRows>[0];
      const [card] = weatherRows(forecast, Date.UTC(2026, 10, 19, 12))[0].cards;
      return [card.rain, card.rainLevel] as const;
    };
    setDisplayUnits("imperial");
    // 0.1 mm is 0.004 in, which reads "0.00 in": the dash and an empty bar.
    expect(level(0.1)).toEqual(["–", 0]);
    expect(level(0.2)[1]).toBeGreaterThan(0);
    setDisplayUnits("metric");
    expect(level(0.1)[1]).toBeGreaterThan(0);
    expect(level(0.04)).toEqual(["–", 0]);
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

describe("unitsOf where no choice is offered", () => {
  // Mutation: read the stored choice without `offersUnitsChoice(regions)`, and a
  // crafted PATCH leaves a prod account in feet with no row to undo it.
  it("reads the region's units over a stored choice, and the choice again once one is offered", () => {
    const stored = { units: "imperial", regions: ["nsw"] };
    expect(unitsOf(stored, [NSW_REGION])).toBe("metric");
    expect(unitsOf(stored, [NSW_REGION, SIM_UTAH])).toBe("imperial");
  });
});

describe("choosesUnits", () => {
  // Mutation: compare with the units in force (what the home region gives)
  // instead of the stored choice, and tapping the default with nothing stored
  // stores nothing, so a later change of home region moves the figures.
  it("stores a tap unless that choice is already stored, the region's default included", () => {
    // Nothing stored: even the tap that matches the home region's units stores.
    expect(unitsOf({}, [NSW_REGION, SIM_UTAH])).toBe("metric");
    expect(choosesUnits(undefined, "metric")).toBe(true);
    expect(choosesUnits(undefined, "imperial")).toBe(true);
    expect(choosesUnits("metric", "imperial")).toBe(true);
    expect(choosesUnits("imperial", "imperial")).toBe(false);
    // A damaged stored value is no choice.
    expect(choosesUnits("furlongs", "metric")).toBe(true);
  });
});
