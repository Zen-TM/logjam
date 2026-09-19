import { useId, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { Circle, CircleCheck, type LucideIcon } from "lucide-react";
import { avatarInitials, friendAvatarHue } from "@logjam/shared";
import classes from "./Row.module.css";

/**
 * A row's tile that is also its checkbox (DESIGN.md §7): the tile at rest, a
 * circle to tick under the pointer, on focus and throughout a selection. The
 * circle takes the tile's own box, so ticking moves nothing. `onToggle` is told
 * whether Shift was held, for a range.
 */
export function TileCheckbox({
  tile,
  label,
  checked,
  selecting,
  onToggle,
}: {
  tile: ReactNode;
  label: string;
  checked: boolean;
  /** A selection is running somewhere in the list: every tile shows its circle. */
  selecting: boolean;
  onToggle: (extendRange: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title="Select (shift-click for a range)"
      className={classes.pick}
      data-selecting={selecting}
      onClick={(event) => onToggle(event.shiftKey)}
    >
      <span className={classes.pickTile}>{tile}</span>
      <span className={classes.pickMark} aria-hidden>
        {checked ? <CircleCheck size={20} /> : <Circle size={20} />}
      </span>
    </button>
  );
}

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
 * A PERSON's tile: the same box as `IconTile`, filled with the hue their name
 * hashes to and marked with their initials. Both come from `@logjam/shared`, so
 * a friend is the same two letters in the same colour here and on Logjam GPS
 * (DESIGN.md §3). There is no avatar image anywhere in Logjam and this is not
 * the place to introduce one.
 *
 * Hidden from assistive tech: every row that carries one has the username as
 * its title, and "BM" read aloud before it says nothing.
 */
export function Avatar({ username }: { username: string }) {
  return (
    <span
      className={classes.avatar}
      style={{ "--tile-hue": friendAvatarHue(username) } as CSSProperties}
      aria-hidden
    >
      {avatarInitials(username)}
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
 * `selected` is a STATE of the row (accent outline), never a fill: a tinted
 * fill dropped the subtitle below 4.5:1.
 */
export function Row({
  leading,
  title,
  subtitle,
  description,
  trailing,
  footer,
  onOpen,
  href,
  download,
  external = false,
  selected = false,
  accentEdge = false,
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
  /** Controls that answer the row (Accept, Decline), on a line of their own
   *  INSIDE the card, under the text. Below the card they read as a caption
   *  for the next row down (Logjam GPS learned that from a mis-pressed
   *  "Download again"). */
  footer?: ReactNode;
  onOpen?: () => void;
  /**
   * The row IS a link: a file to download, a page to open. Same anatomy and
   * the same stretched hit area as `onOpen`, but an anchor — so middle-click,
   * "save as" and "open in a new tab" all work, which a button that
   * fabricates a navigation throws away. Mutually exclusive with `onOpen`;
   * `download` names the saved file, and `external` opens a new tab safely.
   */
  href?: string;
  download?: string;
  external?: boolean;
  selected?: boolean;
  /** An accent edge down the left side: a property of the row, such as unread,
   *  that must still show while the row is also selected. Drawn as an inset
   *  shadow, so the row's box does not change size when it comes and goes. */
  accentEdge?: boolean;
  disabled?: boolean;
}) {
  const subtitleId = useId();
  const descriptionId = useId();
  const describedBy = [description && descriptionId, subtitle && subtitleId].filter(Boolean).join(" ") || undefined;
  return (
    <div
      className={[classes.row, className].filter(Boolean).join(" ")}
      data-selected={selected}
      data-accent-edge={accentEdge}
      data-disabled={disabled}
      {...rest}
    >
      {leading != null && <div className={classes.leading}>{leading}</div>}
      <div className={classes.main}>
        {href ? (
          <a
            className={classes.open}
            href={href}
            download={download}
            {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            aria-describedby={describedBy}
          >
            <span className={classes.title}>{title}</span>
          </a>
        ) : onOpen ? (
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
      {footer != null && <div className={classes.footer}>{footer}</div>}
    </div>
  );
}
