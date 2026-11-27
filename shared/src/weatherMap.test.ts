import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parseRgbaHex } from "./topoSettings.js";

import {
  OVERLAY_LEGENDS,
  overlayChoiceLabel,
  overlayChoiceOption,
  overlayChoicePick,
  overlayLegendRows,
} from "./overlayLegends.js";
import {
  parseWeatherMap,
  parseWeatherWind,
  WEATHER_LAYERS,
  WEATHER_MAP,
  WEATHER_PERIODS,
  WEATHER_TOTALS_CHIP,
  isWeatherEstimate,
  isWeatherTotal,
  weatherChip,
  weatherChipLayer,
  weatherPeriodDefault,
  weatherPeriodHint,
  weatherPeriodOptions,
  weatherLayer,
  weatherLayerUrl,
  weatherLegendRows,
  weatherScale,
  weatherReliefColor,
  weatherShown,
  weatherShownLabel,
  weatherTotalsNow,
  weatherNextStep,
  weatherStepAt,
  weatherTimeLabel,
  weatherWindUrl,
  type WeatherWindFile,
  windArrowsIn,
} from "./weatherMap.js";

// Written by topo/tests/test_weather.py from the builder itself: this reads
// what the job writes.
const readFixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, "__fixtures__", name), "utf8"),
  );
const file = parseWeatherMap(readFixture("weather-latest.json"))!;
const wind = readFixture("weather-wind.json") as WeatherWindFile;
const BASE = "https://cdn.example";

/** The colour a `color-relief` expression gives a value: its linear rule. */
function reliefAt(expression: unknown[], value: number): string {
  const stops = expression.slice(3) as (number | string)[];
  let at = stops[1] as string;
  for (let i = 0; i < stops.length; i += 2)
    if (value >= (stops[i] as number)) at = stops[i + 1] as string;
  return at;
}

describe("the weather map's manifest", () => {
  // Mutation: rename or drop a manifest field on either side, or bump the
  // format on one, and the parse comes back null.
  it("reads the file the builder writes", () => {
    expect(file).not.toBeNull();
    expect(file.model).toBe("ecmwf_ifs");
    expect(file.steps[0]).toEqual({ time: file.anchor, hours: 1 });
    expect(file.totals).toEqual([
      "rainPast168",
      "rainPast72",
      "rainPast24",
      "rainNext24",
      "rainNext72",
    ]);
  });

  // Mutation: drop the folder pattern and a manifest could point a client at
  // any path on the CDN.
  it("refuses a manifest it can't draw", () => {
    const raw = readFixture("weather-latest.json") as Record<string, unknown>;
    expect(parseWeatherMap({ ...raw, format: 2 })).toBeNull();
    expect(parseWeatherMap({ ...raw, path: "../gauges/" })).toBeNull();
    expect(parseWeatherMap({ ...raw, steps: [] })).toBeNull();
    expect(parseWeatherMap({ ...raw, totals: ["rainNext999"] })).toBeNull();
    expect(parseWeatherMap(null)).toBeNull();
  });

  // Mutation: name a step without its zero padding, a total under the
  // fields, or a step past the run, and a client asks for a file the job
  // never wrote.
  it("names each layer's archive under the run's folder", () => {
    const folder = `${BASE}/${WEATHER_MAP.prefix}${file.path}`;
    expect(weatherLayerUrl(`${BASE}/`, file, "rain", 7)).toBe(
      `${folder}rain/007.pmtiles`,
    );
    expect(weatherLayerUrl(BASE, file, "rainPast24", 7)).toBe(
      `${folder}totals/rainPast24.pmtiles`,
    );
    expect(weatherLayerUrl(BASE, file, "rain", file.steps.length)).toBeNull();
    expect(
      weatherLayerUrl(BASE, { ...file, totals: [] }, "rainPast24", 0),
    ).toBeNull();
    expect(weatherWindUrl(BASE, file)).toBe(`${folder}wind.json`);
  });
});

describe("the slider", () => {
  const anchor = Date.parse(file.anchor);

  it("starts at the step now falls in", () => {
    expect(weatherStepAt(file, anchor + 30 * 60_000)).toBe(1);
    expect(weatherStepAt(file, anchor - 3 * 3_600_000)).toBe(0);
  });

  // Mutation: return `step + 1` without the wrap (Play runs off the end and
  // asks for an archive that is not there), or wrap to 0 instead of `first`
  // (it plays hours already past).
  it("plays on by one and loops from the last step to the first allowed", () => {
    expect(weatherNextStep(3, 2, 9)).toBe(4);
    expect(weatherNextStep(8, 2, 9)).toBe(9);
    expect(weatherNextStep(9, 2, 9)).toBe(2);
    expect(weatherNextStep(0, 2, 9)).toBe(2);
    expect(weatherNextStep(0, 0, 0)).toBe(0);
  });

  // Mutation: fall back to the last step and a run a week old draws as now.
  it("has no step once every one is past", () => {
    const last = Date.parse(file.steps.at(-1)!.time);
    expect(weatherStepAt(file, last + 3_600_000)).toBeNull();
  });

  it("says when a step is, on this device's clock", () => {
    const at = new Date(2026, 10, 8, 14);
    expect(weatherTimeLabel(at.toISOString(), at.getTime())).toBe(
      "Today, 2 pm",
    );
    expect(weatherTimeLabel(at.toISOString(), at.getTime() - 86_400_000)).toBe(
      "Sun 8, 2 pm",
    );
    expect(
      weatherTimeLabel(new Date(2026, 10, 8, 0).toISOString(), at.getTime()),
    ).toBe("Today, 12 am");
  });

  it("says a total's window by where it ends", () => {
    const now = anchor;
    expect(weatherShownLabel(file, "rainPast24", 0, now)).toBe(
      `To ${weatherTimeLabel(file.anchor, now)}`,
    );
    expect(weatherShownLabel(file, "rainNext24", 0, now)).toBe(
      `To ${weatherTimeLabel(new Date(anchor + 86_400_000).toISOString(), now)}`,
    );
    expect(weatherShownLabel(file, "rain", 2, now)).toBe(
      weatherTimeLabel(file.steps[2]!.time, now),
    );
  });
});

describe("the colours", () => {
  const clear = /,0\.000\)$/;
  // Mutation: drop temperature's clear first stop and the tile's no-value
  // pixels (−32768) paint the coldest blue.
  it("leaves no value clear for every layer", () => {
    for (const layer of WEATHER_LAYERS)
      expect(reliefAt(weatherReliefColor(layer.key), -32768)).toMatch(clear);
  });

  it("leaves a dry or calm map clear", () => {
    expect(reliefAt(weatherReliefColor("rain"), 0)).toMatch(clear);
    expect(reliefAt(weatherReliefColor("rainPast168"), 0.5)).toMatch(clear);
    expect(reliefAt(weatherReliefColor("wind"), 3)).toMatch(clear);
  });

  // Mutation: make a clear stop "#00000000", and the fade into the first
  // colour passes through grey: a dark fringe round every shower.
  it("fades in from the first colour, not from black", () => {
    for (const layer of WEATHER_LAYERS) {
      const [first, second] = layer.stops;
      expect(parseRgbaHex(first!.colour)[3]).toBe(0);
      expect(first!.colour.slice(0, 7)).toBe(second!.colour.slice(0, 7));
    }
  });

  // Mutation: put two stops out of order or on one value, and MapLibre
  // refuses the whole expression and draws nothing.
  it("interpolates stops in rising order", () => {
    for (const layer of WEATHER_LAYERS) {
      const values = layer.stops.map((s) => s.value);
      expect(values).toEqual([...values].sort((a, b) => a - b));
      expect(new Set(values).size).toBe(values.length);
    }
  });

  // Mutation: list an unlabelled stop, or a translucent colour, and the key
  // shows a row the map has no band for, or a swatch the sheet swallows.
  it("keys the legend by each labelled stop, opaque", () => {
    const rows = weatherLegendRows("rain");
    expect(rows.map((r) => r.label)).toEqual([
      "0.2 mm/h",
      "1 mm/h",
      "2.5 mm/h",
      "5 mm/h",
      "10 mm/h",
      "20 mm/h",
      "40 mm/h",
    ]);
    for (const row of rows) expect(row.colour).toMatch(/^#[0-9a-f]{6}$/);
  });

  // Mutation: carry the unit into the scale's labels, and the bar's strip
  // repeats "mm/h" under every notch.
  it("gives the bar's scale bare numbers, the same colours as the key", () => {
    expect(weatherScale("temperature").map((s) => s.label)).toEqual([
      "−5",
      "0",
      "8",
      "15",
      "22",
      "30",
      "38",
      "45",
    ]);
    expect(weatherScale("rain").map((s) => s.colour)).toEqual(
      weatherLegendRows("rain").map((r) => r.colour),
    );
  });

  it("falls back to rain for a stored layer it doesn't know", () => {
    expect(weatherLayer("snow").key).toBe("rain");
  });
});

describe("the wind arrows", () => {
  // A 3 × 3 grid of 0.5°, from 149°E 33°S, blowing from the west at 18 km/h.
  const grid = (
    speed: (number | null)[],
    from: (number | null)[],
  ): WeatherWindFile => ({
    west: 149,
    north: -33,
    step: 0.5,
    columns: 3,
    rows: 3,
    steps: [{ speed, from }],
  });
  const uniform = grid(Array(9).fill(18), Array(9).fill(270));
  const all = { west: 148, south: -35, east: 151, north: -32 };
  const at = (f: { geometry: { coordinates: number[] } }) =>
    f.geometry.coordinates;

  // Mutation: count rows from the south, or turn the arrow to `from`
  // instead of downwind, and every arrow points the wrong way.
  it("places each point from the north-west and turns it downwind", () => {
    const { features } = windArrowsIn(wind, 0, all, 7);
    expect(features[0]!.geometry.coordinates).toEqual([wind.west, wind.north]);
    expect(features[wind.columns]!.geometry.coordinates).toEqual([
      wind.west,
      wind.north - wind.step,
    ]);
    // The fixture's wind is from the west (270°): the arrowhead, drawn
    // pointing east, keeps pointing east.
    expect(features[0]!.properties).toEqual({ speed: 18, rotate: 0 });
    // From the north blows south: the arrowhead turns a quarter clockwise.
    const north = grid(Array(9).fill(5), Array(9).fill(0));
    expect(windArrowsIn(north, 0, all, 7).features[0]!.properties.rotate).toBe(
      90,
    );
  });

  // Mutation: draw each grid cell once whatever the zoom (the old thinning),
  // and a close view is as sparse as z7's grid, or a wide one a mat of arrows.
  it("keeps about 90 px between arrows at any zoom", () => {
    const gap = (zoom: number, bounds = all) => {
      const xs = windArrowsIn(uniform, 0, bounds, zoom).features.map(
        (f) => at(f)[0]!,
      );
      return Math.min(...xs.filter((x) => x > xs[0]!).map((x) => x - xs[0]!));
    };
    // 512 px tiles: a degree is 512 · 2^z / 360 px.
    for (const zoom of [7, 8, 9, 10]) {
      const px = (gap(zoom) * 512 * 2 ** zoom) / 360;
      expect(px).toBeGreaterThan(60);
      expect(px).toBeLessThan(130);
    }
    // Zoomed out it is the grid thinned, every second then every fourth point.
    expect(gap(6, { ...all, east: 152 })).toBe(1);
    expect(windArrowsIn(wind, 0, all, 5).features.map(at)).toEqual([
      [149, -33],
      [151, -33],
      [149, -35],
      [151, -35],
    ]);
  });

  // Mutation: anchor the lattice at the viewport's edge, and a pan of less
  // than a spacing moves every arrow.
  it("keeps the same points when the map pans by less than a spacing", () => {
    const view = { west: 149.1, south: -33.9, east: 149.9, north: -33.1 };
    const pan = (d: number) => ({
      west: view.west + d,
      east: view.east + d,
      south: view.south - d / 2,
      north: view.north - d / 2,
    });
    const points = (b: typeof view) =>
      windArrowsIn(uniform, 0, b, 11).features.map(at);
    const a = points(view);
    const b = points(pan(0.0011));
    expect(a.length).toBeGreaterThan(10);
    // The pan brings arrows in at the margin, so the ones that were there stay.
    for (const p of a.filter(
      ([x, y]) => x! > 149.2 && x! < 149.8 && y! < -33.2,
    ))
      expect(b).toContainEqual(p);
    for (const [x] of a) {
      const n = (x! - 149) / 0.5 ** 5;
      expect(Math.abs(n - Math.round(n))).toBeLessThan(1e-6);
    }
  });

  // Mutation: blend speed or direction instead of u and v, or weigh a corner
  // by the wrong side, and midway is not the mean wind.
  it("blends the four cells around a point by their u and v", () => {
    // West 10 km/h at 149°E, south 10 km/h at 149.5°E (a 90° turn).
    const g = grid(
      [10, 10, 10, 10, 10, 10, 10, 10, 10],
      [270, 180, 180, 270, 180, 180, 270, 180, 180],
    );
    const mid = windArrowsIn(g, 0, all, 9).features.find(
      (f) => Math.abs(at(f)[0]! - 149.25) < 1e-9 && at(f)[1] === -33,
    )!;
    // u = +5 (east), v = +5 (north): the wind blows north-east, 45° from north.
    expect(mid.properties.speed).toBe(7.1);
    expect(mid.properties.rotate).toBe(315);
    expect(
      windArrowsIn(g, 0, all, 9).features.find((f) => at(f)[0] === 149.5)!
        .properties,
    ).toEqual({ speed: 10, rotate: 270 });
  });

  // Mutation: average the angles 350° and 10° (180°), and the arrow between
  // two northerlies points the other way.
  it("goes round the 0°/360° wrap through the short way", () => {
    const g = grid(Array(9).fill(10), [350, 10, 10, 350, 10, 10, 350, 10, 10]);
    const mid = windArrowsIn(g, 0, all, 9).features.find(
      (f) => Math.abs(at(f)[0]! - 149.25) < 1e-9 && at(f)[1] === -33,
    )!;
    // Blowing from the north, south-bound: a quarter turn clockwise of east.
    expect(mid.properties.rotate).toBe(90);
    expect(mid.properties.speed).toBeCloseTo(9.8, 1);
  });

  // Mutation: lift the cap, and a state-wide view at a close zoom draws
  // thousands of arrows.
  it("never draws more than 600 arrows, and none outside the grid", () => {
    const big: WeatherWindFile = {
      west: 140,
      north: -28,
      step: 0.5,
      columns: 40,
      rows: 40,
      steps: [{ speed: Array(1600).fill(9), from: Array(1600).fill(200) }],
    };
    const world = { west: -180, south: -85, east: 180, north: 85 };
    for (const zoom of [4, 7, 9, 12]) {
      const { features } = windArrowsIn(big, 0, world, zoom);
      expect(features.length).toBeGreaterThan(0);
      expect(features.length).toBeLessThanOrEqual(600);
      for (const f of features) {
        const [x, y] = at(f);
        expect(x).toBeGreaterThanOrEqual(140);
        expect(x).toBeLessThanOrEqual(159.5 + 1e-9);
        expect(y).toBeLessThanOrEqual(-28);
        expect(y).toBeGreaterThanOrEqual(-47.5 - 1e-9);
      }
    }
    expect(
      windArrowsIn(big, 0, { west: 10, south: 10, east: 12, north: 12 }, 9)
        .features,
    ).toEqual([]);
  });

  // Mutation: draw a null as 0, and a point with no forecast shows calm.
  it("leaves out a point with no value, and a step that isn't there", () => {
    const gappy = grid(
      Array(9)
        .fill(18)
        .map((s, i) => (i === 0 ? null : s)),
      Array(9).fill(270),
    );
    // Close in, every point touching the missing corner goes; the far ones stay.
    const some = windArrowsIn(gappy, 0, all, 7).features;
    expect(some).toHaveLength(8);
    expect(some.map(at)).not.toContainEqual([149, -33]);
    expect(windArrowsIn(wind, 99, all, 7).features).toEqual([]);
  });
});

describe("the Weather legend", () => {
  const legend = OVERLAY_LEGENDS.weather;

  // Mutation: key the legend by `rows` alone, and picking Temperature still
  // shows the rain key.
  it("keys the layer picked, and rain for one it doesn't know", () => {
    expect(overlayLegendRows(legend, "temperature")).toEqual(
      weatherLegendRows("temperature"),
    );
    expect(overlayLegendRows(legend, "snow")).toEqual(
      weatherLegendRows("rain"),
    );
    expect(overlayLegendRows(OVERLAY_LEGENDS.land, "temperature")).toBe(
      OVERLAY_LEGENDS.land.rows,
    );
  });

  // Mutation: list a total as its own option again, and the picker is nine
  // chips; drop the totals chip, and no total can be picked.
  it("offers the stepped layers and one chip for the totals", () => {
    expect(legend.choice?.options.map((o) => o.value)).toEqual([
      "rain",
      "temperature",
      "wind",
      "gusts",
      WEATHER_TOTALS_CHIP,
    ]);
    expect(legend.choice?.options.at(-1)?.label).toBe("Rain accumulation");
  });

  // Mutation: reorder WEATHER_PERIODS, or add a total to WEATHER_LAYERS
  // without a period, and a card's rail lists them out of time order or
  // misses one.
  it("holds every total as a period, past to future", () => {
    expect(WEATHER_PERIODS.map((p) => p.value)).toEqual(
      WEATHER_LAYERS.filter(isWeatherTotal).map((l) => l.key),
    );
    expect(WEATHER_PERIODS.map((p) => p.label)).toEqual([
      "Past 7 days",
      "Past 72 h",
      "Past 24 h",
      "Next 24 h",
      "Next 72 h",
    ]);
  });

  // Mutation: give a total no `period` (or a field one), and the card's rail
  // misses a period or lists a stepped layer.
  it("gives every total a period and no field one", () => {
    for (const l of WEATHER_LAYERS)
      expect(l.period !== undefined, l.key).toBe(isWeatherTotal(l));
  });

  // Mutation: build the options without `disabled`, and a run that dropped a
  // total still offers it, to a bar that says "couldn't get the weather map".
  it("disables the periods a run's manifest lacks", () => {
    const only = ["rainPast168", "rainNext72"];
    expect(
      weatherPeriodOptions(only)
        .filter((o) => !o.disabled)
        .map((o) => o.value),
    ).toEqual(only);
    expect(weatherPeriodOptions(null).some((o) => o.disabled)).toBe(false);
  });

  // Mutation: return the hint always, and a full run's card says a chip is
  // greyed when none is; return it never, and a disabled chip gives no reason.
  it("explains greyed periods only while one is greyed", () => {
    expect(weatherPeriodHint(["rainPast24"])).toBe(
      "A greyed period isn't in this run or has run out.",
    );
    expect(weatherPeriodHint(WEATHER_PERIODS.map((p) => p.value))).toBe(
      undefined,
    );
    expect(weatherPeriodHint(null)).toBe(undefined);
  });

  // Mutation: return "rainPast24" whatever the run has, and the totals chip
  // picks a total the run lacks, leaving no way to a total that exists.
  it("picks 24 h past when the run has it, else the first it has", () => {
    expect(weatherPeriodDefault(null)).toBe("rainPast24");
    expect(weatherPeriodDefault(["rainPast24", "rainNext24"])).toBe(
      "rainPast24",
    );
    expect(weatherPeriodDefault(["rainNext72", "rainNext24"])).toBe(
      "rainNext24",
    );
    expect(weatherChipLayer(WEATHER_TOTALS_CHIP, "wind", ["rainPast72"])).toBe(
      "rainPast72",
    );
    expect(
      overlayChoicePick(legend, WEATHER_TOTALS_CHIP, "rain", ["rainNext72"]),
    ).toBe("rainNext72");
    // A period already picked is kept, even one the run lacks: the card
    // shows it missing and offers the others.
    expect(weatherChipLayer(WEATHER_TOTALS_CHIP, "rainPast168", [])).toBe(
      "rainPast168",
    );
  });

  // Mutation: make `weatherChip` return the key as given, and a stored total
  // shows no chip selected; make the totals chip pick `rain`, and pressing it
  // leaves the totals.
  it("shows every total as the totals chip, and picks 24 h from a stepped layer", () => {
    for (const { value } of WEATHER_PERIODS) {
      expect(weatherChip(value)).toBe(WEATHER_TOTALS_CHIP);
      expect(weatherChipLayer(WEATHER_TOTALS_CHIP, value)).toBe(value);
      expect(overlayChoiceOption(legend, value)).toBe(WEATHER_TOTALS_CHIP);
    }
    for (const key of ["rain", "temperature", "wind", "gusts"]) {
      expect(weatherChip(key)).toBe(key);
      expect(weatherChipLayer(key, "rainNext72")).toBe(key);
      expect(weatherChipLayer(WEATHER_TOTALS_CHIP, key)).toBe("rainPast24");
    }
    expect(weatherChip(null)).toBe("rain");
    expect(overlayChoicePick(legend, WEATHER_TOTALS_CHIP, "wind")).toBe(
      "rainPast24",
    );
    // A choice without a grouping stores what is pressed.
    expect(overlayChoicePick(OVERLAY_LEGENDS.coverage, "tpg", null)).toBe(
      "tpg",
    );
  });

  it("names the layer picked, a total by its own title", () => {
    expect(overlayChoiceLabel(legend, "rainPast168")).toBe("Rain, past 7 days");
    expect(overlayChoiceLabel(legend, "wind")).toBe("Wind");
    expect(legend.credit).toBe(WEATHER_MAP.credit);
  });
});

describe("what the overlay shows", () => {
  const anchor = Date.parse(file.anchor);

  // Mutation: start at step 0 instead of the one now falls in, and the bar
  // opens on an hour already past.
  it("starts at the step now falls in and spans the rest", () => {
    const shown = weatherShown({
      file,
      layer: "rain",
      picked: null,
      now: anchor + 30 * 60_000,
    });
    expect(shown).toMatchObject({
      kind: "ready",
      step: 1,
      first: 1,
      last: file.steps.length - 1,
      shown: weatherTimeLabel(file.steps[1]!.time, anchor + 30 * 60_000),
    });
  });

  // Mutation: drop the clamp, and a pick from an older run indexes past this
  // one's steps or back into the past.
  it("holds a pick inside the steps still to come", () => {
    const at = (picked: number) =>
      weatherShown({
        file,
        layer: "wind",
        picked: { path: file.path, step: picked },
        now: anchor,
      });
    expect(at(-5)).toMatchObject({ step: 0 });
    expect(at(999)).toMatchObject({ step: file.steps.length - 1 });
    expect(at(2.6)).toMatchObject({ step: 3 });
  });

  // Mutation: use a pick whatever run it was made in, and the first look at
  // a new run opens on a time nobody chose there.
  it("counts a pick only in the run it was made in", () => {
    const at = (path: string) =>
      weatherShown({
        file,
        layer: "rain",
        picked: { path, step: 3 },
        now: anchor,
      });
    expect(at(file.path)).toMatchObject({ step: 3 });
    expect(at("runs/20261106T1800Z-20261107T0300Z/")).toMatchObject({
      step: 0,
    });
  });

  // Mutation: let a stepped layer through when every step is past, and a
  // week-old run draws as now.
  it("is out of date once every step is past", () => {
    const last = Date.parse(file.steps.at(-1)!.time);
    expect(
      weatherShown({ file, layer: "rain", picked: null, now: last + 1 }).kind,
    ).toBe("outOfDate");
  });

  // Mutation: treat a total the run left out as ready, and the map asks for
  // an archive the job never wrote.
  it("draws a total with no step, and misses one the run left out", () => {
    expect(
      weatherShown({
        file,
        layer: "rainPast24",
        picked: { path: file.path, step: 7 },
        now: anchor,
      }),
    ).toMatchObject({ kind: "ready", step: null, first: 0, last: 0 });
    expect(
      weatherShown({
        file: { ...file, totals: [] },
        layer: "rainPast24",
        picked: null,
        now: anchor,
      }).kind,
    ).toBe("missing");
  });

  // Mutation: drop the `outOfDate` return for a run-out total (or the
  // `forecastTotalHours` test in `weatherTotalsNow`), and Next 24 h is drawn
  // days after, as a forecast of rain that has fallen; make a past total run
  // out too, and a kept run's Past 24 h goes blank.
  it("runs a forecast total out after the anchor, and never a past one", () => {
    const at = (layer: "rainNext24" | "rainPast24", hours: number) =>
      weatherShown({
        file,
        layer,
        picked: null,
        now: anchor + hours * 3_600_000,
      }).kind;
    expect(at("rainNext24", 5)).toBe("ready");
    expect(at("rainNext24", 7)).toBe("outOfDate");
    expect(at("rainPast24", 7 * 24)).toBe("ready");
    // A total the run never had stays missing, however late.
    expect(
      weatherShown({
        file: { ...file, totals: [] },
        layer: "rainNext24",
        picked: null,
        now: anchor + 7 * 3_600_000,
      }).kind,
    ).toBe("missing");
  });

  // Mutation: filter on the wrong sign (drop the past totals, keep the
  // forecast ones), or drop nothing, and the rail greys the wrong periods.
  it("drops only the forecast totals that have run out", () => {
    const all = file.totals;
    expect(all).toEqual(
      expect.arrayContaining(["rainPast24", "rainNext24", "rainNext72"]),
    );
    expect(weatherTotalsNow(file, anchor + 6 * 3_600_000)).toEqual(all);
    const late = weatherTotalsNow(file, anchor + 7 * 3_600_000);
    expect(late).toEqual(all.filter((k) => (weatherLayer(k).hours ?? 0) < 0));
    expect(late).toContain("rainPast24");
  });

  // Mutation: return true for every total, or only for the 24 h one, and a
  // stepped layer or a forecast says "estimated", or a past total does not.
  it("calls a past total, and only that, an estimate", () => {
    expect(
      Object.fromEntries(
        WEATHER_LAYERS.map((l) => [l.key, isWeatherEstimate(l)]),
      ),
    ).toEqual({
      rain: false,
      temperature: false,
      wind: false,
      gusts: false,
      rainPast168: true,
      rainPast72: true,
      rainPast24: true,
      rainNext24: false,
      rainNext72: false,
    });
  });

  it("ages the run from when it was built", () => {
    const now = Date.parse(file.built) + 2 * 3_600_000;
    expect(
      weatherShown({ file, layer: "rain", picked: null, now }),
    ).toMatchObject({ age: "Updated 2 h ago" });
  });
});

describe("the wind file", () => {
  // Mutation: return the parsed JSON unchecked, and a bad file throws inside
  // `windArrowsIn` instead of drawing no arrows.
  it("reads the builder's file and refuses a broken one", () => {
    expect(parseWeatherWind(wind)).toBe(wind);
    expect(parseWeatherWind({ ...wind, columns: "35" })).toBeNull();
    expect(parseWeatherWind({ ...wind, steps: [{ speed: [] }] })).toBeNull();
    expect(parseWeatherWind(null)).toBeNull();
  });
});
