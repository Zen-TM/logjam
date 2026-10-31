// A RIVER GAUGE: what Logjam Web's panel says when a gauge on the map is
// pressed. Readings, never advice: no word here calls a river safe, high or
// runnable, and nothing is coloured by value. Guard: gauges.test.ts.
//
// Online only, and Logjam Web only for now: the file is public and the same
// for everyone (ADR 0044), so there is nothing to keep per user.
import { gaugeSeries, type Gauge } from "../gauges.js";
import type { ProfileSeries } from "../profileSeries.js";
import { PAIRED_STAT_LABELS, pairedStatLayout } from "../statPairs.js";
import type { ScreenContract } from "./types.js";

export const GAUGES = {
  id: "gauges",
  question: "What did the river gauge last read?",
  title: "River gauge",
  sections: [
    { key: "reading" },
    { key: "age" },
    { key: "graph" },
    { key: "credit" },
  ],
  copy: {
    overlay: "River gauges",
    level: PAIRED_STAT_LABELS.level,
    flow: PAIRED_STAT_LABELS.flow,
    age: "Latest reading",
    graph: "Last 7 days",
    noLevel: "No level reading",
    noRecent: "This gauge has had no reading in the last 7 days.",
    failed: "River gauges couldn\u2019t be loaded.",
    staleFile: "Readings last refreshed",
    // Only if the file's own attribution is blank: the credit is never dropped.
    credit: "© State of New South Wales through WaterNSW",
  },
} as const satisfies ScreenContract;

const DAY_MS = 86_400_000;
/** A gauge older than this has "no recent reading" (the file holds 7 days). */
export const GAUGE_RECENT_MS = 7 * DAY_MS;
/** A file older than this shows its age beside the readings. */
export const GAUGE_STALE_FILE_MS = DAY_MS;

// BoM's long names are mostly upper case, some abbreviated: "COLO RIVER AT
// UPPER COLO", "RICHMOND RV @ OAKLAND ROAD".
const NAME_WORDS: Record<string, string> = {
  "@": "at",
  AT: "at",
  NEAR: "near",
  OF: "of",
  R: "River",
  RV: "River",
  RIV: "River",
  CK: "Creek",
  RD: "Road",
  "D/S": "downstream of",
  "U/S": "upstream of",
  DOWNSTREAM: "downstream",
  UPSTREAM: "upstream",
};

/** A gauge's name for reading: "Colo River at Upper Colo". A word the table
 *  doesn't know is only re-cased, never guessed at. */
export function gaugeDisplayName(raw: string): string {
  return raw
    .replace(/@/g, " @ ")
    .replace(/\b(up|down) ?stream( of)?\b/gi, "$1stream of")
    .replace(/(\S)\(/g, "$1 (")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const known = NAME_WORDS[word.replace(/\.$/, "").toUpperCase()];
      if (known) return known;
      // Mixed case ("McKIMMS", "Beechwod") was typed by a person: leave it.
      if (word !== word.toUpperCase()) return word;
      // A code, not a word: "9J", "W4I".
      if (/\d[A-Z]/.test(word)) return word;
      return word
        .toLowerCase()
        .replace(/(^|[-'(])([a-z])/g, (_, a, b) => a + b.toUpperCase());
    })
    .join(" ")
    .replace(/ at (up|down)stream of /, " $1stream of ");
}

export type GaugeLatest = {
  level: number | null;
  /** Epoch milliseconds of the level, null when there is none. */
  levelAt: number | null;
  flow: number | null;
  flowAt: number | null;
};

/** The newest level and the newest flow, each on its own, with its own time,
 *  and each within the 7 days before `now` (the file can be older than its
 *  own week). Null when the gauge has neither. A row with no level does not
 *  hide an earlier one. */
export function latestGaugeReading(
  gauge: Gauge,
  now: number,
): GaugeLatest | null {
  const newest = (column: 1 | 2) => {
    for (let i = gauge.readings.length - 1; i >= 0; i--) {
      const row = gauge.readings[i];
      if (row[column] === null) continue;
      return now - row[0] * 1000 > GAUGE_RECENT_MS
        ? null
        : { at: row[0] * 1000, value: row[column] as number };
    }
    return null;
  };
  const level = newest(1);
  const flow = newest(2);
  if (!level && !flow) return null;
  return {
    level: level?.value ?? null,
    levelAt: level?.at ?? null,
    flow: flow?.value ?? null,
    flowAt: flow?.at ?? null,
  };
}

/** Values this far apart in time share one "Latest reading" line. */
export const GAUGE_SAME_READING_MS = 3_600_000;

export type GaugeAges = {
  /** One line for both values, or null when their ages differ. */
  line: string | null;
  /** Each value's own age, set only when `line` is null. */
  level: string | null;
  flow: string | null;
};

/** How to say how old the values are: one line when level and flow came
 *  within an hour of each other (or only one exists), else each its own age,
 *  so a stale level never sits under a fresh flow's time. */
export function gaugeAges(latest: GaugeLatest, now: number): GaugeAges {
  const { levelAt, flowAt } = latest;
  const newest = Math.max(levelAt ?? 0, flowAt ?? 0);
  if (
    levelAt === null ||
    flowAt === null ||
    Math.abs(levelAt - flowAt) <= GAUGE_SAME_READING_MS
  )
    return {
      line: `${GAUGES.copy.age} ${gaugeAgo(newest, now)}`,
      level: null,
      flow: null,
    };
  return {
    line: null,
    level: gaugeAgo(levelAt, now),
    flow: gaugeAgo(flowAt, now),
  };
}

/** A gauge's figures: its level beside its flow (`STAT_PAIRS`), or the level
 *  alone on a gauge with no flow, each saying its own age when the two differ. */
export function gaugeStats(gauge: Gauge, latest: GaugeLatest, now: number) {
  const ages = gaugeAges(latest, now);
  const level = {
    label: GAUGES.copy.level,
    value:
      latest.level === null
        ? GAUGES.copy.noLevel
        : formatGaugeLevel(latest.level),
    age: ages.level,
  };
  const flow = {
    label: GAUGES.copy.flow,
    value: latest.flow === null ? "-" : formatGaugeFlow(latest.flow),
    age: ages.flow,
  };
  return pairedStatLayout(gauge.hasFlow ? [level, flow] : [level]).map(
    ({ age, ...stat }) =>
      age ? { ...stat, label: `${stat.label}, ${age}` } : stat,
  );
}

/** The week's charts, level above flow. A value under two readings has none,
 *  since one point draws no line; with neither, the heading goes too. */
export function gaugeWeekCharts(
  gauge: Gauge,
  latest: GaugeLatest | null,
): { charted: "level" | "flow"; series: ProfileSeries }[] {
  if (!latest) return [];
  return (["level", "flow"] as const).flatMap((charted) => {
    const series = gaugeSeries(gauge.readings, charted);
    const readings = series.points.filter((p) => p.value !== null).length;
    return readings < 2 ? [] : [{ charted, series }];
  });
}

export function formatGaugeLevel(metres: number): string {
  return `${metres.toFixed(2)} m`;
}

export function formatGaugeFlow(megalitresPerDay: number): string {
  const v = megalitresPerDay;
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ML/d`;
}

/** "45 min ago": how long before `now` a moment was. */
export function gaugeAgo(at: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/** What to say about an old file: when it was written, or null while it is
 *  fresh. It never guesses at readings the file doesn't hold. */
export function gaugeFileNote(generatedAt: string, now: number): string | null {
  const at = Date.parse(generatedAt);
  return Number.isNaN(at) || now - at <= GAUGE_STALE_FILE_MS
    ? null
    : `${GAUGES.copy.staleFile} ${gaugeAgo(at, now)}`;
}
