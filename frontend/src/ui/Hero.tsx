import type { CSSProperties, ReactNode } from "react";
import classes from "./Hero.module.css";

/**
 * A page's opening: an eyebrow naming the page, a title that ANSWERS the page's
 * one question ("298 places"), its actions on the same line, and a slot below
 * (a meter, a search row).
 *
 * No fill, unlike Logjam GPS's hero: that fill (`bonus2`) fails AA under two
 * schemes, so the web hero separates with an accent hairline instead.
 */
export function Hero({
  eyebrow,
  title,
  actions,
  children,
}: {
  eyebrow: string;
  title: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className={classes.hero}>
      <div className={classes.eyebrow}>{eyebrow}</div>
      <div className={classes.titleRow}>
        <h2 className={classes.title}>{title}</h2>
        {actions}
      </div>
      {children}
    </header>
  );
}

export type MeterSegment = { label: string; value: number; hue: string };

/**
 * One total, broken down: a proportional bar and a legend that states every
 * number in words. The bar is decoration for sighted readers; the legend is the
 * content, so assistive tech reads the legend and skips the bar.
 */
export function Meter({ segments }: { segments: readonly MeterSegment[] }) {
  return (
    <div className={classes.meter}>
      <div className={classes.track} aria-hidden>
        {segments
          .filter((segment) => segment.value > 0)
          .map((segment) => (
            <span
              key={segment.label}
              className={classes.segment}
              style={{ flexGrow: segment.value, "--segment-hue": segment.hue } as CSSProperties}
            />
          ))}
      </div>
      <ul className={classes.legend}>
        {segments.map((segment) => (
          <li
            key={segment.label}
            className={classes.legendItem}
            style={{ "--segment-hue": segment.hue } as CSSProperties}
          >
            <span className={classes.dot} aria-hidden />
            {segment.label} <b>{segment.value}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
