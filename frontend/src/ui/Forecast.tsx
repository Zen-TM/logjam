import { Icon, type Glyph } from "./Icon";
import classes from "./Forecast.module.css";

export type ForecastRow = {
  key: string;
  /** "Today", "Mon 20". */
  day: string;
  glyph: Glyph;
  /** What the glyph says, spoken ("Rain"). */
  glyphLabel: string;
  temperature: string;
  rain: string;
  wind: string;
  /** Today's row: the one the eye starts on. */
  current?: boolean;
};

/**
 * A run of days, one compact row each: day, condition glyph, temperature, rain,
 * wind, in columns that line up down the list (tabular figures). Read-only, so
 * no card and no hover. Two lines: the rain sits under the temperature.
 */
export function ForecastList({
  rows,
  label,
}: {
  rows: readonly ForecastRow[];
  label: string;
}) {
  return (
    <ul className={classes.list} aria-label={label}>
      {rows.map((row) => (
        <li key={row.key} className={classes.row} data-current={row.current}>
          <span className={classes.day}>{row.day}</span>
          <Icon
            idea={row.glyph}
            size={18}
            label={row.glyphLabel}
            className={classes.glyph}
          />
          <span className={classes.temperature}>{row.temperature}</span>
          <span className={classes.rain}>{row.rain}</span>
          <span className={classes.wind}>{row.wind}</span>
        </li>
      ))}
    </ul>
  );
}
