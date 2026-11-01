// River gauges: readings published every two hours by topo/build_gauges.py at
// GAUGE_PREFIX on the topo CDN, and each gauge's daily history beside them.
// Why the files are public and where each number comes from: ADR 0044.
//
// These are readings, never advice: no copy built on them says a river is
// safe, high or runnable. Guard: gauges.test.ts, against the fixtures the
// builder writes (topo/tests/test_gauges.py).
import { haversineMeters } from "./placeGeo.js";
import type { ProfileSeries } from "./profileSeries.js";

/** Bumped when either file's shape changes; each format has its own prefix. */
export const GAUGE_FORMAT = 1;

/** Path under the topo CDN base URL (TOPO_CDN_BASE_URL). */
export const GAUGE_PREFIX = `master/gauges/v${GAUGE_FORMAT}/`;
export const GAUGE_LATEST_PATH = `${GAUGE_PREFIX}latest.json`;

/** Gauge ids are WaterNSW station numbers. Anything else in a URL is refused. */
const GAUGE_ID = /^\d{1,10}$/;

/** `[epoch seconds, level in metres, flow in ML/d]`, either value may be null. */
export type GaugeReading = [number, number | null, number | null];

export interface Gauge {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Refreshed every two hours; the rest once a day. */
  hot: boolean;
  hasFlow: boolean;
  /** The last seven days, oldest first. */
  readings: GaugeReading[];
}

export interface GaugeLatestFile {
  version: number;
  generatedAt: string;
  coldSweptAt: string;
  /** Drawn wherever a reading is. */
  attribution: string;
  gauges: Gauge[];
}

/** One slot per day from `start`; null where the gauge has no value. */
export interface GaugeHistoryFile {
  version: number;
  id: string;
  /** `YYYY-MM-DD`. */
  start: string;
  level: (number | null)[];
  flow: (number | null)[];
}

const isNum = (v: unknown): v is number => typeof v === "number";
const isNumOrNull = (v: unknown): v is number | null => v === null || isNum(v);

function isGauge(value: unknown): value is Gauge {
  if (typeof value !== "object" || value === null) return false;
  const g = value as Record<string, unknown>;
  return (
    typeof g.id === "string" &&
    GAUGE_ID.test(g.id) &&
    typeof g.name === "string" &&
    isNum(g.lat) &&
    isNum(g.lon) &&
    typeof g.hot === "boolean" &&
    typeof g.hasFlow === "boolean" &&
    Array.isArray(g.readings) &&
    g.readings.every(
      (r) =>
        Array.isArray(r) &&
        r.length === 3 &&
        isNum(r[0]) &&
        isNumOrNull(r[1]) &&
        isNumOrNull(r[2]),
    )
  );
}

/** The latest file, or null when it is not this format or is malformed. */
export function parseGaugeLatest(value: unknown): GaugeLatestFile | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (
    v.version !== GAUGE_FORMAT ||
    typeof v.generatedAt !== "string" ||
    typeof v.coldSweptAt !== "string" ||
    typeof v.attribution !== "string" ||
    !Array.isArray(v.gauges) ||
    !v.gauges.every(isGauge)
  ) {
    return null;
  }
  return v as unknown as GaugeLatestFile;
}

/** A gauge's history file, or null when malformed. The slots must match: a
 *  short `flow` would read as a day with no value. */
export function parseGaugeHistory(value: unknown): GaugeHistoryFile | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (
    v.version !== GAUGE_FORMAT ||
    typeof v.id !== "string" ||
    !GAUGE_ID.test(v.id) ||
    typeof v.start !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v.start) ||
    !Array.isArray(v.level) ||
    !Array.isArray(v.flow) ||
    v.level.length !== v.flow.length ||
    !v.level.every(isNumOrNull) ||
    !v.flow.every(isNumOrNull)
  ) {
    return null;
  }
  return v as unknown as GaugeHistoryFile;
}

/** A gauge's history file URL, or null for an id that is not a station number. */
export function gaugeHistoryUrl(baseUrl: string, id: string): string | null {
  return GAUGE_ID.test(id)
    ? `${baseUrl}/${GAUGE_PREFIX}history/${id}.json`
    : null;
}

function onDate(
  history: GaugeHistoryFile,
  date: string,
  column: (number | null)[],
): number | null {
  const day = Math.round(
    (Date.parse(`${date}T00:00:00Z`) -
      Date.parse(`${history.start}T00:00:00Z`)) /
      86_400_000,
  );
  return day >= 0 && day < column.length ? (column[day] ?? null) : null;
}

/** The daily mean level in metres on `YYYY-MM-DD`, or null. */
export function levelOnDate(
  history: GaugeHistoryFile,
  date: string,
): number | null {
  return onDate(history, date, history.level);
}

/** The daily mean flow in ML/d on `YYYY-MM-DD`, or null. */
export function flowOnDate(
  history: GaugeHistoryFile,
  date: string,
): number | null {
  return onDate(history, date, history.flow);
}

const DAY_MS = 86_400_000;
/** History days are Australian Eastern Standard days, with no daylight saving. */
const AEST_MS = 10 * 3_600_000;

/** The `YYYY-MM-DD` of the AEST day a moment falls in. */
export function aestDay(ms: number): string {
  return new Date(ms + AEST_MS).toISOString().slice(0, 10);
}

/** A trip's calendar day. A trip's date is a day held as UTC midnight, so its
 *  first ten characters are the day as the person entered it: no time zone
 *  can move it. Null for anything else. */
export function tripGaugeDay(date: string): string | null {
  return /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : null;
}

export interface GaugeDayReading {
  level: number | null;
  flow: number | null;
}

/** The gauge's reading for a trip's day, or null for none, never a guess.
 *  History holds the daily mean about two days late, so a day within the
 *  latest file's week that history lacks is the mean of that file's readings
 *  on the day. */
export function gaugeReadingOnDay(
  gauge: Gauge,
  history: GaugeHistoryFile | null,
  day: string,
  now: number,
): GaugeDayReading | null {
  let level = history ? levelOnDate(history, day) : null;
  let flow = history ? flowOnDate(history, day) : null;
  if (
    level === null &&
    flow === null &&
    aestDay(now - 7 * DAY_MS) <= day &&
    day <= aestDay(now)
  ) {
    const mean = (at: 1 | 2): number | null => {
      const v = gauge.readings.flatMap((r) =>
        r[at] !== null && aestDay(r[0] * 1000) === day ? [r[at] as number] : [],
      );
      return v.length ? v.reduce((a, b) => a + b) / v.length : null;
    };
    level = mean(1);
    flow = mean(2);
  }
  if (!gauge.hasFlow) flow = null;
  return level === null && flow === null ? null : { level, flow };
}

/** Trip readings are shown for at most this many gauges. */
export const TRIP_GAUGE_MAX = 3;

/** The distinct gauges of some places, a few at most, in order. */
export function distinctGaugeIds(ids: (string | null | undefined)[]): string[] {
  return [...new Set(ids.flatMap((id) => (id ? [id] : [])))].slice(
    0,
    TRIP_GAUGE_MAX,
  );
}

/** The trip dates a viewer's reading may use: a sharee's are none, because
 *  trips are the owner's alone (ADR 0002). */
export function tripDatesFor(owned: boolean, dates: string[]): string[] {
  return owned ? dates : [];
}

export interface NearbyGauge {
  gauge: Gauge;
  distanceM: number;
}

/** The `limit` gauges nearest a point, nearest first: a list to choose from.
 *  The nearest is often on the wrong river, so nothing here picks one. */
export function nearbyGauges(
  gauges: Gauge[],
  lat: number,
  lon: number,
  limit: number,
): NearbyGauge[] {
  return gauges
    .map((gauge) => ({
      gauge,
      distanceM: haversineMeters(lat, lon, gauge.lat, gauge.lon),
    }))
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit);
}

/** A gauge's readings over time (x is epoch milliseconds) for the profile
 *  chart, scaled between its own ends. */
export function gaugeSeries(
  readings: GaugeReading[],
  variable: "level" | "flow",
): ProfileSeries {
  const at = variable === "level" ? 1 : 2;
  const points = readings.map((r) => ({ x: r[0] * 1000, value: r[at] }));
  const values = points.flatMap((p) => (p.value === null ? [] : [p.value]));
  return {
    points,
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
  };
}
