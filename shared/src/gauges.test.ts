import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { GAUGES, MAP_OVERLAYS } from "./contracts/index.js";
import {
  formatGaugeFlow,
  formatGaugeLevel,
  gaugeAgo,
  gaugeDisplayName,
  gaugeFileNote,
  latestGaugeReading,
} from "./contracts/gauges.js";
import {
  type Gauge,
  flowOnDate,
  gaugeHistoryUrl,
  gaugeSeries,
  GAUGE_LATEST_PATH,
  GAUGE_PREFIX,
  levelOnDate,
  nearbyGauges,
  parseGaugeHistory,
  parseGaugeLatest,
} from "./gauges.js";

// Both written by topo/build_gauges.py: topo/tests/test_gauges.py fails when
// the builder stops writing exactly these, so the reader is tested against the
// builder's real output.
const readFixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, "__fixtures__", name), "utf8"),
  );
const latest = parseGaugeLatest(readFixture("gauges-latest.json"))!;
const history = parseGaugeHistory(readFixture("gauge-history.json"))!;

describe("gauge files", () => {
  it("reads what the builder writes", () => {
    // Mutation: rename a field on either side → red.
    expect(latest.gauges.map((g) => g.id)).toEqual([
      "900001",
      "900002",
      "900003",
    ]);
    expect(history.id).toBe("900001");
  });

  it("refuses another format, a bad id and a short column", () => {
    // Mutation: drop the version, id or length check in the parsers → red.
    const raw = readFixture("gauges-latest.json") as Record<string, unknown>;
    expect(parseGaugeLatest({ ...raw, version: 2 })).toBeNull();
    const gauges = raw.gauges as Record<string, unknown>[];
    expect(
      parseGaugeLatest({ ...raw, gauges: [{ ...gauges[0], id: "../x" }] }),
    ).toBeNull();
    const h = readFixture("gauge-history.json") as Record<string, unknown>;
    expect(parseGaugeHistory({ ...h, flow: [1] })).toBeNull();
  });

  it("builds URLs only for station numbers", () => {
    // Mutation: build the URL without the id check → red.
    expect(gaugeHistoryUrl("https://cdn", "900001")).toBe(
      `https://cdn/${GAUGE_PREFIX}history/900001.json`,
    );
    expect(gaugeHistoryUrl("https://cdn", "../latest")).toBeNull();
    expect(GAUGE_LATEST_PATH).toBe("master/gauges/v1/latest.json");
  });
});

describe("history", () => {
  it("reads a day, and null outside the series or where it has no value", () => {
    // Mutation: an off-by-one in the day index → red.
    expect(levelOnDate(history, "2026-10-01")).toBe(0.91);
    expect(flowOnDate(history, "2026-10-01")).toBe(120.5);
    expect(levelOnDate(history, "2026-10-02")).toBeNull();
    expect(levelOnDate(history, "2026-09-30")).toBeNull();
    expect(levelOnDate(history, "2030-01-01")).toBeNull();
  });
});

describe("nearbyGauges", () => {
  it("lists the nearest first and stops at the limit", () => {
    // Mutation: sort farthest first, or ignore the limit → red.
    const near = nearbyGauges(latest.gauges, -33.4, 150.7, 2);
    expect(near.map((n) => n.gauge.id)).toEqual(["900001", "900002"]);
    expect(near[0]!.distanceM).toBeLessThan(near[1]!.distanceM);
  });
});

describe("gaugeSeries", () => {
  it("charts one variable, keeps gaps as null and scales to its own ends", () => {
    // Mutation: read the flow column for level → red.
    const series = gaugeSeries(latest.gauges[0]!.readings, "level");
    expect(series.points.map((p) => p.value)).toEqual([0.9, 0.95, null]);
    expect(series.min).toBe(0.9);
    expect(series.max).toBe(0.95);
    expect(series.points[0]!.x).toBe(latest.gauges[0]!.readings[0]![0] * 1000);
  });

  it("has no scale for a gauge with no values", () => {
    expect(gaugeSeries([], "flow")).toEqual({
      points: [],
      min: null,
      max: null,
    });
  });
});

describe("the gauge panel's words", () => {
  const now = Date.parse("2026-10-30T12:00:00Z");
  const gauge = latest.gauges[0];

  it("tidies BoM's names for reading", () => {
    // Mutation: drop an entry from NAME_WORDS or the "@" padding → red.
    expect(gaugeDisplayName("COLO R @ UPPER COLO")).toBe(
      "Colo River at Upper Colo",
    );
    expect(gaugeDisplayName("COOPERS CK @ F'MEDOW")).toBe(
      "Coopers Creek at F'Medow",
    );
    expect(gaugeDisplayName("CK@AVONDALE")).toBe("Creek at Avondale");
    expect(gaugeDisplayName("HUNTER D/S GLENBAWN")).toBe(
      "Hunter downstream of Glenbawn",
    );
    expect(gaugeDisplayName("McKIMMS CORNER")).toBe("McKIMMS Corner");
  });

  it("reads the newest level and the newest flow each on their own, within 7 days", () => {
    // Mutation: take both from the same (last) row → red.
    const g = (readings: Gauge["readings"]): Gauge => ({ ...gauge, readings });
    const sec = now / 1000;
    expect(latestGaugeReading(g([]), now)).toBeNull();
    expect(latestGaugeReading(g([[sec - 60, null, null]]), now)).toBeNull();
    expect(
      latestGaugeReading(
        g([
          [sec - 7200, 1.2, 9],
          [sec - 3600, 1.3, null],
          [sec - 60, null, 4],
        ]),
        now,
      ),
    ).toEqual({ at: (sec - 60) * 1000, level: 1.3, flow: 4 });
    // A newest row with no level keeps the level from an hour earlier.
    expect(
      latestGaugeReading(
        g([
          [sec - 3600, 1.3, 4],
          [sec - 60, null, 5],
        ]),
        now,
      )?.level,
    ).toBe(1.3);
    expect(latestGaugeReading(g([[sec - 8 * 86400, 1, 1]]), now)).toBeNull();
    // Level missing everywhere, flow present.
    expect(latestGaugeReading(g([[sec - 60, null, 4]]), now)).toEqual({
      at: (sec - 60) * 1000,
      level: null,
      flow: 4,
    });
  });

  it("formats and ages", () => {
    expect(formatGaugeLevel(1.234)).toBe("1.23 m");
    expect(formatGaugeFlow(4.26)).toBe("4.3 ML/d");
    expect(formatGaugeFlow(1234.6)).toBe("1235 ML/d");
    expect(gaugeAgo(now - 45 * 60_000, now)).toBe("45 min ago");
    expect(gaugeAgo(now - 3 * 3_600_000, now)).toBe("3 h ago");
    expect(gaugeAgo(now - 2 * 86_400_000, now)).toBe("2 days ago");
    expect(gaugeFileNote("2026-10-30T06:00:00Z", now)).toBeNull();
    expect(gaugeFileNote("2026-10-28T12:00:00Z", now)).toBe(
      "Readings last refreshed 2 days ago",
    );
  });

  // Readings, never advice (#682). Mutation: put "safe" in the copy → red.
  it("has no word of advice and no colour scale", () => {
    const words = JSON.stringify([
      GAUGES.copy,
      MAP_OVERLAYS.copy,
      GAUGES.title,
    ]);
    expect(words).not.toMatch(
      /\b(safe\w*|runnable|high\w*|low\w*|danger\w*|flood\w*|rising|falling|normal|good|bad|dry)\b/i,
    );
  });
});
