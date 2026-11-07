// Measured rain: each WaterNSW rain gauge's 9am-to-9am totals for the last
// ten days, published once every two hours by topo/build_gauges.py beside the
// river gauges' files. Why a public file, which stations, and the distance
// past which the model is shown instead: ADR 0047.
//
// PRIVACY: the file is the same for everyone, so fetching it says nothing
// about a spot; the nearest gauges are picked here, on the device.
// Guard: rainGauges.test.ts, against the fixture the builder writes
// (topo/tests/test_gauges.py).
import { GAUGE_FORMAT, GAUGE_PREFIX } from "./gauges.js";
import { haversineMeters } from "./placeGeo.js";

/** Path under the topo CDN base URL (TOPO_CDN_BASE_URL). */
export const RAIN_PATH = `${GAUGE_PREFIX}rain.json`;

/** Past this, a gauge misses a canyon's week by more than the model does. */
export const RAIN_GAUGE_MAX_M = 15_000;
export const RAIN_GAUGES_SHOWN = 3;

export interface RainGauge {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Millimetres for each 9am-to-9am period from the file's `start`, null
   *  where the gauge has no whole, valid total: never a dry day. */
  mm: (number | null)[];
}

export interface RainFile {
  version: number;
  generatedAt: string;
  /** Drawn wherever a gauge's figures are. */
  attribution: string;
  /** `YYYY-MM-DD`: the morning the first period began, at 9 am AEST. */
  start: string;
  gauges: RainGauge[];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

function isRainGauge(value: unknown, days: number): value is RainGauge {
  if (typeof value !== "object" || value === null) return false;
  const g = value as Record<string, unknown>;
  return (
    typeof g.id === "string" &&
    typeof g.name === "string" &&
    isNum(g.lat) &&
    isNum(g.lon) &&
    Array.isArray(g.mm) &&
    g.mm.length === days &&
    g.mm.every((v) => v === null || (isNum(v) && v >= 0))
  );
}

/** The rain file, or null when it is not this format or is malformed. */
export function parseRainFile(value: unknown): RainFile | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (
    v.version !== GAUGE_FORMAT ||
    typeof v.generatedAt !== "string" ||
    typeof v.attribution !== "string" ||
    typeof v.start !== "string" ||
    !DAY.test(v.start) ||
    !Array.isArray(v.gauges)
  )
    return null;
  // Every gauge holds the same days: a short one would shift its dates.
  const days = (v.gauges[0] as { mm?: unknown[] } | undefined)?.mm?.length;
  if (days === undefined || !v.gauges.every((g) => isRainGauge(g, days)))
    return null;
  return v as unknown as RainFile;
}

/** The gauge's total for the period that began at 9 am on `date`, or null. */
export function rainOnDate(
  file: RainFile,
  gauge: RainGauge,
  date: string,
): number | null {
  const i = Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${file.start}T00:00:00Z`)) /
      86_400_000,
  );
  return i >= 0 && i < gauge.mm.length ? gauge.mm[i] : null;
}

export type NearbyRainGauge = {
  gauge: RainGauge;
  distanceM: number;
  /** Per date asked for: the measured total, or null where there is none. */
  mm: (number | null)[];
};

export type PastRain = {
  attribution: string;
  /** Nearest first; empty when none within `RAIN_GAUGE_MAX_M` measured any
   *  of the dates. */
  gauges: NearbyRainGauge[];
};

/** The gauges to draw for a spot's past days: the nearest few within
 *  `RAIN_GAUGE_MAX_M` that measured at least one of them. Each is drawn on
 *  its own, named: the nearest is not always the one on the catchment. */
export function nearbyRain(
  file: RainFile,
  point: { latitude: number; longitude: number },
  dates: string[],
): PastRain {
  const gauges = file.gauges
    .map((gauge) => ({
      gauge,
      distanceM: haversineMeters(
        point.latitude,
        point.longitude,
        gauge.lat,
        gauge.lon,
      ),
      mm: dates.map((date) => rainOnDate(file, gauge, date)),
    }))
    .filter((g) => g.distanceM <= RAIN_GAUGE_MAX_M && g.mm.some(isNum))
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, RAIN_GAUGES_SHOWN);
  return { attribution: file.attribution, gauges };
}

/** The gauges' credit, where any of their figures are drawn. */
export function rainCredit(rain: PastRain | null | undefined): string | null {
  return rain?.gauges.length ? rain.attribution : null;
}
