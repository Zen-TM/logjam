// Which stats sit on one line: what a line climbs and what it drops, its
// highest and lowest point, a river's level and flow, a track's time and the
// distance it covered (shared/DESIGN.md §2). A stat with no partner on the
// surface takes the full width, so a pair is never split across two rows and a
// lone figure never hangs off the end of one.

import { t } from "./i18n.js";

/** The words both clients put on these stats. */
export const PAIRED_STAT_LABELS = {
  time: t`Time`,
  distance: t`Distance`,
  ascent: t`Ascent`,
  descent: t`Descent`,
  highPoint: t`High point`,
  lowPoint: t`Low point`,
  moving: t`Moving`,
  stopped: t`Stopped`,
  avgSpeed: t`Avg speed`,
  avgMovingSpeed: t`Avg moving speed`,
  level: t`Level`,
  flow: t`Flow`,
} as const;

const L = PAIRED_STAT_LABELS;

/** Each pair in the order it reads: the first is the left cell. */
export const STAT_PAIRS: readonly (readonly [string, string])[] = [
  [L.time, L.distance],
  [L.ascent, L.descent],
  [L.highPoint, L.lowPoint],
  [L.moving, L.stopped],
  [L.avgSpeed, L.avgMovingSpeed],
  [L.level, L.flow],
];

/** Time and distance are the two a live recording reads off the wall clock and the walk, not off the points. */
export function isLiveReadStat(label: string): boolean {
  return label === L.time || label === L.distance;
}

/**
 * A grid's stats laid out by the pairs: a stat whose partner is on the grid
 * follows it directly, one without a partner spans the row.
 */
export function pairedStatLayout<T extends { label: string; span?: boolean }>(
  stats: readonly T[],
): T[] {
  const byLabel = new Map(stats.map((stat) => [stat.label, stat]));
  const partnerOf = (label: string) => {
    for (const [first, second] of STAT_PAIRS) {
      if (label === first) return byLabel.get(second);
    }
    return undefined;
  };
  const isSecond = (label: string) =>
    STAT_PAIRS.some(
      ([first, second]) => second === label && byLabel.has(first),
    );
  const out: T[] = [];
  for (const stat of stats) {
    if (isSecond(stat.label)) continue; // it follows its first
    const partner = partnerOf(stat.label);
    if (partner) {
      out.push({ ...stat, span: false }, { ...partner, span: false });
    } else {
      out.push({ ...stat, span: true });
    }
  }
  return out;
}
