// A RIVER GAUGE: what Logjam Web's panel says when a gauge on the map is
// pressed. Readings, never advice: no word here calls a river safe, high or
// runnable, and nothing is coloured by value. Guard: gauges.test.ts.
//
// The file is public and the same for everyone (ADR 0044), so it holds
// nothing per user; Logjam GPS keeps its last copy for use offline.
import {
  aestDay,
  gaugeReadingOnDay,
  gaugeSeries,
  tripGaugeDay,
  type Gauge,
  type GaugeDayReading,
  type GaugeHistoryFile,
} from "../gauges.js";
import type { ProfileSeries } from "../profileSeries.js";
import { PAIRED_STAT_LABELS, pairedStatLayout } from "../statPairs.js";
import type { ScreenContract } from "./types.js";
import { plural, t } from "../i18n.js";

export const GAUGES = {
  id: "gauges",
  question: t`What did the river gauge last read?`,
  title: t`River gauge`,
  sections: [
    { key: "reading" },
    { key: "age" },
    { key: "graph" },
    { key: "credit" },
  ],
  copy: {
    overlay: t`River gauges`,
    level: PAIRED_STAT_LABELS.level,
    flow: PAIRED_STAT_LABELS.flow,
    graph: t`Last 7 days`,
    noLevel: t`No level reading`,
    noRecent: t`This gauge has had no reading in the last 7 days.`,
    failed: t`River gauges couldn't be loaded.`,
    // Only if the file's own attribution is blank: the credit is never dropped.
    credit: t`© State of New South Wales through WaterNSW`,
  },
} as const satisfies ScreenContract;

const DAY_MS = 86_400_000;
/** A gauge older than this has "no recent reading" (the file holds 7 days). */
export const GAUGE_RECENT_MS = 7 * DAY_MS;
/** A file older than this shows its age beside the readings. */
export const GAUGE_STALE_FILE_MS = DAY_MS;

// BoM's long names are mostly upper case, some abbreviated: "COLO RIVER AT
// UPPER COLO", "RICHMOND RV @ OAKLAND ROAD". A function, so each word is
// written in the language in force when a name is read.
const nameWords = (): Record<string, string> => ({
  "@": t`at`,
  AT: t`at`,
  NEAR: t`near`,
  OF: t`of`,
  R: t`River`,
  RV: t`River`,
  RIV: t`River`,
  CK: t`Creek`,
  RD: t`Road`,
  "D/S": t`downstream of`,
  "U/S": t`upstream of`,
  DOWNSTREAM: t`downstream`,
  UPSTREAM: t`upstream`,
});

/** A gauge's name for reading: "Colo River at Upper Colo". A word the table
 *  doesn't know is only re-cased, never guessed at. */
export function gaugeDisplayName(raw: string): string {
  const key = (word: string | undefined) =>
    (word ?? "").replace(/\.$/, "").toUpperCase();
  // The clean-up reads BoM's tokens, never the catalogue's words, so it holds
  // in every language. "OF" is the `nameWords` key a stream phrase ends in.
  const words = raw
    .replace(/@/g, " @ ")
    .replace(/\b(up|down) ?(stream)( of)?\b/gi, "$1$2 OF")
    .replace(/(\S)\(/g, "$1 (")
    .split(/\s+/)
    .filter(Boolean);
  const table = nameWords();
  return words
    .filter((word, i) => {
      if (key(word) !== "AT" && key(word) !== "@") return true;
      // "at" before a stream phrase and a place: "at downstream of X" is
      // "downstream of X". A phrase is one token (D/S) or two (DOWNSTREAM OF).
      const next = key(words[i + 1]);
      const length =
        next === "D/S" || next === "U/S"
          ? 2
          : next === "DOWNSTREAM" || next === "UPSTREAM"
            ? 3
            : 0;
      return length === 0 || words.length <= i + length;
    })
    .map((word) => {
      const known = table[key(word)];
      if (known) return known;
      // Mixed case ("McKIMMS", "Beechwod") was typed by a person: leave it.
      if (word !== word.toUpperCase()) return word;
      // A code, not a word: "9J", "W4I".
      if (/\d[A-Z]/.test(word)) return word;
      return word
        .toLowerCase()
        .replace(/(^|[-'(])([a-z])/g, (_, a, b) => a + b.toUpperCase());
    })
    .join(" ");
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
      line: t`Latest reading ${gaugeAgo(newest, now)}`,
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
  if (minutes < 1) return t`just now`;
  if (minutes < 60) return t`${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t`${hours} h ago`;
  const days = Math.floor(hours / 24);
  return plural(days, "# day ago", "# days ago");
}

/** What to say about an old file: when it was written, or null while it is
 *  fresh. It never guesses at readings the file doesn't hold. */
export function gaugeFileNote(generatedAt: string, now: number): string | null {
  const at = Date.parse(generatedAt);
  return Number.isNaN(at) || now - at <= GAUGE_STALE_FILE_MS
    ? null
    : t`Readings last refreshed ${gaugeAgo(at, now)}`;
}

const values = (gauge: Gauge, r: GaugeDayReading | null): string =>
  [
    r?.level != null ? formatGaugeLevel(r.level) : null,
    gauge.hasFlow && r?.flow != null ? formatGaugeFlow(r.flow) : null,
  ]
    .filter(Boolean)
    .join(" and ");

/** The reading on a trip's date beside the current one, a line per gauge:
 *  "Colo River at Upper Colo: 0.91 m on this trip, 1.40 m now." With several
 *  dates (the trips at a place) "lastTrip" reads only the newest past one,
 *  so the label is true; a trip date in the future is skipped. A date with no
 *  value shows nothing; if a history file was had and no gauge has a value,
 *  one plain line says so. Two numbers, no verdict. */
export function tripGaugeLines(
  inputs: { gauge: Gauge; history: GaugeHistoryFile | null }[],
  dates: string[],
  when: "trip" | "lastTrip",
  now: number,
): string[] {
  const today = aestDay(now);
  const past = dates
    .flatMap((d) => tripGaugeDay(d) ?? [])
    .filter((day) => when === "trip" || day <= today)
    .sort()
    .reverse();
  const days = when === "lastTrip" ? past.slice(0, 1) : past;
  const lines = inputs.flatMap(({ gauge, history }) => {
    for (const day of days) {
      const then = gaugeReadingOnDay(gauge, history, day, now);
      if (!then) continue;
      const current = values(gauge, latestGaugeReading(gauge, now));
      const name = gaugeDisplayName(gauge.name);
      const earlier = values(gauge, then);
      return [
        when === "trip"
          ? current
            ? t`${name}: ${earlier} on this trip, ${current} now.`
            : t`${name}: ${earlier} on this trip, no recent reading now.`
          : current
            ? t`${name}: ${earlier} on your last trip here, ${current} now.`
            : t`${name}: ${earlier} on your last trip here, no recent reading now.`,
      ];
    }
    return [];
  });
  return lines.length > 0 || days.length === 0 || !inputs.some((i) => i.history)
    ? lines
    : inputs.map(
        ({ gauge }) =>
          t`${gaugeDisplayName(gauge.name)} has no reading for that date.`,
      );
}
