// A RIVER GAUGE: what Logjam Web's panel says when a gauge on the map is
// pressed. Readings, never advice: no word here calls a river safe, high or
// runnable, and nothing is coloured by value. Guard: gauges.test.ts.
//
// Online only, and Logjam Web only for now: the file is public and the same
// for everyone (ADR 0044), so there is nothing to keep per user.
import type { Gauge } from "../gauges.js";
import type { ScreenContract } from "./types.js";

export const GAUGES = {
  id: "gauges",
  question: "What did the river gauge last read?",
  title: "River gauge",
  sections: [
    { key: "level" },
    { key: "flow" },
    { key: "age" },
    { key: "graph" },
    { key: "credit" },
  ],
  copy: {
    overlay: "River gauges",
    overlayHint: "Water level and flow, as each gauge last read.",
    level: "Level",
    flow: "Flow",
    age: "Latest reading",
    graph: "Last 7 days",
    noLevel: "No level reading",
    noRecent: "This gauge has had no reading in the last 7 days.",
    staleFile: "Readings last refreshed",
    // Only if the file's own attribution is blank: the credit is never dropped.
    credit: "© WaterNSW",
  },
} as const satisfies ScreenContract;

const DAY_MS = 86_400_000;
/** A gauge older than this has "no recent reading" (the file holds 7 days). */
export const GAUGE_RECENT_MS = 7 * DAY_MS;
/** A file older than this shows its age beside the readings. */
export const GAUGE_STALE_FILE_MS = DAY_MS;

// BoM's raw names are upper-case abbreviations: "COLO R @ UPPER COLO".
const NAME_WORDS: Record<string, string> = {
  "@": "at",
  R: "River",
  RV: "River",
  RIV: "River",
  CK: "Creek",
  "D/S": "downstream of",
  "U/S": "upstream of",
};

/** A gauge's name for reading: "Colo River at Upper Colo". A word the table
 *  doesn't know is only re-cased, never guessed at. */
export function gaugeDisplayName(raw: string): string {
  return raw
    .replace(/@/g, " @ ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const known = NAME_WORDS[word.replace(/\.$/, "").toUpperCase()];
      if (known) return known;
      // Mixed case ("McKIMMS", "Beechwod") was typed by a person: leave it.
      if (word !== word.toUpperCase()) return word;
      return word
        .toLowerCase()
        .replace(/(^|[-'])([a-z])/g, (_, a, b) => a + b.toUpperCase());
    })
    .join(" ");
}

export type GaugeLatest = {
  /** Epoch milliseconds. */
  at: number;
  level: number | null;
  flow: number | null;
};

/** The newest reading with a value, or null when the gauge has none in the 7
 *  days before `now`: the file can be older than its own week. */
export function latestGaugeReading(
  gauge: Gauge,
  now: number,
): GaugeLatest | null {
  for (let i = gauge.readings.length - 1; i >= 0; i--) {
    const [sec, level, flow] = gauge.readings[i];
    if (level === null && flow === null) continue;
    const at = sec * 1000;
    return now - at > GAUGE_RECENT_MS ? null : { at, level, flow };
  }
  return null;
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
