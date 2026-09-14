import classes from "./Stats.module.css";

export type SparkBucket = {
  /** The axis label under the bar: a month's initial, a year's last digits. */
  label: string;
  /** What the bar is, spoken in full ("March", "2024"): an initial read aloud
   *  says nothing. */
  name: string;
  count: number;
  /** "You are here": its axis label is emphasised. */
  current?: boolean;
};

/**
 * A small bar chart of how often something happened — Logjam GPS's
 * `ActivitySpark`. Not interactive: it offers no filter, and a chart that looks
 * pressable and is not is a broken promise. Bars are proportional to the
 * busiest bucket; an empty bucket is only its track, since a floor height would
 * make "none" read as "one".
 *
 * The bars are for sighted readers. Assistive tech reads a list of the same
 * numbers in words, named by `label`.
 */
export function ActivitySpark({
  label,
  buckets,
  caption,
}: {
  /** What the chart counts ("Trips per month"). */
  label: string;
  buckets: readonly SparkBucket[];
  caption?: string;
}) {
  const peak = Math.max(1, ...buckets.map((bucket) => bucket.count));
  return (
    <figure className={classes.spark}>
      <div className={classes.bars} aria-hidden>
        {buckets.map((bucket, index) => (
          <div key={`${bucket.name}-${index}`} className={classes.column}>
            <div className={classes.track}>
              {bucket.count > 0 && (
                <div className={classes.fill} style={{ height: `${(bucket.count / peak) * 100}%` }} />
              )}
            </div>
            <span className={classes.axis} data-current={bucket.current || undefined}>
              {bucket.label}
            </span>
          </div>
        ))}
      </div>
      <ul className="visually-hidden" aria-label={label}>
        {buckets.map((bucket, index) => (
          <li key={`${bucket.name}-${index}`}>
            {bucket.name}: {bucket.count}
          </li>
        ))}
      </ul>
      {caption && <figcaption className={classes.caption}>{caption}</figcaption>}
    </figure>
  );
}

export type Stat = { label: string; value: string };

/** Headline numbers in a two-column grid, each a label over its value. A
 *  definition list, so each value is read with the words that name it. */
export function StatGrid({ stats }: { stats: readonly Stat[] }) {
  return (
    <dl className={classes.grid}>
      {stats.map((stat) => (
        <div key={stat.label} className={classes.cell}>
          <dt className={classes.statLabel}>{stat.label}</dt>
          <dd className={classes.statValue}>{stat.value}</dd>
        </div>
      ))}
    </dl>
  );
}
