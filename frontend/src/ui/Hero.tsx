import type { CSSProperties, ReactNode } from "react";
import { IconButton } from "./Button";
import classes from "./Hero.module.css";

/**
 * A page's opening line: a title that ANSWERS the page's one question
 * ("298 places") with the page's actions beside it. No eyebrow naming the page:
 * the rail's lit pill already says where you are, and a title that answers the
 * question names the page as well.
 *
 * `children`, when given, takes the title's place on the same line (a search
 * box), so opening it moves nothing. The title stays in the document as the
 * page's heading for assistive tech.
 *
 * No fill: a filled hero failed AA under its own text in two schemes, so it
 * separates with a hairline instead (Logjam GPS's hero does the same).
 */
export function Hero({
  title,
  actions,
  onBack,
  backLabel = "Back",
  children,
}: {
  title: string;
  actions?: ReactNode;
  /** A view one step inside the page (one activity's stats): an arrow before
   *  the title goes back out. */
  onBack?: () => void;
  backLabel?: string;
  children?: ReactNode;
}) {
  return (
    <header className={classes.hero} data-back={onBack ? true : undefined}>
      {onBack && <IconButton icon="back" label={backLabel} onClick={onBack} />}
      <h2 className={children ? "visually-hidden" : classes.title}>{title}</h2>
      {children}
      {actions}
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
              style={
                {
                  flexGrow: segment.value,
                  "--segment-hue": segment.hue,
                } as CSSProperties
              }
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
