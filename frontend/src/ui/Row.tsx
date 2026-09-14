import { useId, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import classes from "./Row.module.css";

/**
 * The identity tile: a square filled with the hue, the glyph in ink. Colour and glyph
 * say WHAT a row is before its text is read. `label` names it for assistive
 * tech and as a mouse tooltip when the glyph carries meaning of its own (a
 * status); omit it when the row's text already says the same thing.
 */
export function IconTile({ icon: Icon, hue, label }: { icon: LucideIcon; hue: string; label?: string }) {
  return (
    <span
      className={classes.tile}
      style={{ "--tile-hue": hue } as CSSProperties}
      role={label ? "img" : undefined}
      aria-label={label}
      title={label}
    >
      <Icon size={16} aria-hidden />
    </span>
  );
}

/**
 * The canonical list row: a card with a leading node, a title and subtitle,
 * and trailing accessories.
 *
 * `onOpen` makes the TITLE a real button whose hit area is stretched over the
 * whole card, so the row opens from anywhere on it while `leading` and
 * `trailing` stay their own controls — a button inside a button is invalid
 * HTML and unreachable by keyboard, which is what a clickable card with a menu
 * in it otherwise becomes.
 *
 * `selected` is a STATE of the row (accent edge), never a fill: a tinted fill
 * dropped the subtitle below 4.5:1.
 */
export function Row({
  leading,
  title,
  subtitle,
  description,
  trailing,
  onOpen,
  selected = false,
  highlighted = false,
  disabled = false,
  className,
  ...rest
}: Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  /** Read after the title by assistive tech but not shown — what the leading
   *  glyph says to a sighted reader (a status). */
  description?: string;
  trailing?: ReactNode;
  onOpen?: () => void;
  selected?: boolean;
  /** Lit from outside — its pin is hovered on the map. */
  highlighted?: boolean;
  disabled?: boolean;
}) {
  const subtitleId = useId();
  const descriptionId = useId();
  const describedBy = [description && descriptionId, subtitle && subtitleId].filter(Boolean).join(" ") || undefined;
  return (
    <div
      className={[classes.row, className].filter(Boolean).join(" ")}
      data-selected={selected}
      data-highlighted={highlighted}
      data-disabled={disabled}
      {...rest}
    >
      {leading != null && <div className={classes.leading}>{leading}</div>}
      <div className={classes.main}>
        {onOpen ? (
          <button
            type="button"
            className={classes.open}
            onClick={onOpen}
            disabled={disabled}
            aria-describedby={describedBy}
          >
            <span className={classes.title}>{title}</span>
          </button>
        ) : (
          <span className={classes.title}>{title}</span>
        )}
        {description && (
          <span id={descriptionId} className="visually-hidden">
            {description}
          </span>
        )}
        {subtitle && (
          <span id={subtitleId} className={classes.subtitle}>
            {subtitle}
          </span>
        )}
      </div>
      {trailing != null && <div className={classes.trailing}>{trailing}</div>}
    </div>
  );
}
