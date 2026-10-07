// Which stats are one fact said twice, and so sit on one line: what a line
// climbs and what it drops, its highest and lowest point (docs/ux-principles.md
// §2). A stat with no partner on the surface (a distance) takes the full width,
// so a pair is never split across two rows and a lone figure never hangs off
// the end of one.

/** The words both clients put on these stats. */
export const PAIRED_STAT_LABELS = {
  ascent: "Ascent",
  descent: "Descent",
  highPoint: "High point",
  lowPoint: "Low point",
  moving: "Moving",
  stopped: "Stopped",
  avgSpeed: "Avg speed",
  avgMovingSpeed: "Avg moving speed",
} as const;

const L = PAIRED_STAT_LABELS;

/** Each pair in the order it reads: the first is the left cell. */
export const STAT_PAIRS: readonly (readonly [string, string])[] = [
  [L.ascent, L.descent],
  [L.highPoint, L.lowPoint],
  [L.moving, L.stopped],
  [L.avgSpeed, L.avgMovingSpeed],
];

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
