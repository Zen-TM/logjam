import { useRef } from "react";
import { Icon, type Glyph } from "./Icon";
import { IconButton } from "./Button";
import classes from "./ForecastRail.module.css";

export type ForecastCard = {
  key: string;
  /** "Now", "3 pm", "Today", "Mon 20". */
  label: string;
  /** The card the eye starts on. */
  current?: boolean;
  /** Null where the card is a rain total (a past day). */
  glyph: Glyph | null;
  /** What the glyph says, spoken ("Rain"). */
  glyphLabel: string;
  temperature: string | null;
  rain: string;
  /** 0 to 1; zero leaves the bar empty rather than a floor-high sliver. */
  rainLevel: number;
  chance: string | null;
  wind: string | null;
  /** Everything on the card, in words. */
  spoken: string;
};

/**
 * A titled row of cards that scrolls sideways: one per hour, day or past day,
 * each a label, condition glyph, temperature, rain bar and amount, chance and
 * wind. Read-only, so no fill and no hover. The next card peeks at the edge to
 * say there is more; a mouse also gets ‹ › buttons (a touch scrolls itself).
 * Nothing here takes a mouse roller: it scrolls the panel.
 */
export function ForecastRail({
  title,
  summary,
  cards,
  labels,
}: {
  title: string;
  /** A total for the row ("34 mm"), at its right. */
  summary?: string | null;
  cards: readonly ForecastCard[];
  /** The two buttons' names. */
  labels: { back: string; on: string };
}) {
  const track = useRef<HTMLUListElement>(null);
  const page = (direction: -1 | 1) => {
    const el = track.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    el.scrollBy({
      left: direction * el.clientWidth * 0.8,
      behavior: reduce.matches ? "auto" : "smooth",
    });
  };

  return (
    <section className={classes.rail}>
      <div className={classes.heading}>
        <h4 className={classes.title}>{title}</h4>
        {summary && <span className={classes.summary}>{summary}</span>}
        <div className={classes.buttons}>
          <IconButton
            icon="scrollBack"
            label={labels.back}
            onClick={() => page(-1)}
          />
          <IconButton
            icon="scrollOn"
            label={labels.on}
            onClick={() => page(1)}
          />
        </div>
      </div>
      {/* Focusable so a keyboard can scroll it; the cards are not controls. */}
      <ul ref={track} className={classes.track} aria-label={title} tabIndex={0}>
        {cards.map((card) => (
          <li
            key={card.key}
            className={classes.card}
            data-current={card.current}
            aria-label={card.spoken}
          >
            <span className={classes.label}>{card.label}</span>
            {card.glyph && (
              <Icon idea={card.glyph} size={22} className={classes.glyph} />
            )}
            {card.temperature && (
              <span className={classes.temperature}>{card.temperature}</span>
            )}
            <span className={classes.bar} aria-hidden>
              <span
                className={classes.fill}
                style={{ width: `${card.rainLevel * 100}%` }}
              />
            </span>
            <span className={classes.rain}>{card.rain}</span>
            {card.chance && <span className={classes.meta}>{card.chance}</span>}
            {card.wind && <span className={classes.meta}>{card.wind}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
