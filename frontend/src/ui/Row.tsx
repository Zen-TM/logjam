import {
  createContext,
  useContext,
  useId,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { avatarInitials, friendAvatarHue } from "@logjam/shared";
import classes from "./Row.module.css";
import { Icon, type Glyph } from "./Icon";
import { Tooltip } from "./Tooltip";
import { pressOutsideControls } from "./cardPress";

/**
 * A row's tile that is also its checkbox (DESIGN.md): the tile at rest, a
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
        {checked ? (
          <Icon idea="success" size={20} />
        ) : (
          <Icon idea="unselected" size={20} />
        )}
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
export function IconTile({
  icon,
  pattern,
  hue,
  label,
}: {
  hue: string;
  label?: string;
} & (
  | { icon: Glyph; pattern?: never }
  /** A map pattern's image, drawn over the hue at the map's own scale, in
   *  place of a glyph: a legend's swatch of a hatched layer. */
  | { pattern: string; icon?: never }
)) {
  return (
    <span
      className={
        pattern ? `${classes.tile} ${classes.patterned}` : classes.tile
      }
      style={
        {
          "--tile-hue": hue,
          ...(pattern ? { "--tile-pattern": `url(${pattern})` } : {}),
        } as CSSProperties
      }
      role={label ? "img" : undefined}
      aria-label={label}
      title={label}
    >
      {icon && <Icon idea={icon} size={16} />}
    </span>
  );
}

/**
 * A PERSON's tile: the same box as `IconTile`, filled with the hue their name
 * hashes to and marked with their initials. Both come from `@logjam/shared`, so
 * a friend is the same two letters in the same colour here and on Logjam GPS
 * (shared/DESIGN.md §8). There is no avatar image anywhere in Logjam and this is not
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

const InRowList = createContext(false);

/**
 * A list of rows, as one tab stop with arrow keys (`useListKeys`) and as a
 * `list` to assistive tech, so a screen reader says "3 of 35". The page opts in
 * by drawing its rows in one: nothing is inferred from the markup, so a page
 * that forgets does not quietly lose its arrow keys without a test noticing
 * (`e2e/a11y.spec.ts`). Only rows and `ListEnd` may sit directly inside.
 */
export function RowList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const hintId = useId();
  return (
    <>
      <span id={hintId} className="visually-hidden">
        Arrow keys move between rows, Space selects, Shift+F10 opens actions.
      </span>
      <div
        role="list"
        data-list=""
        aria-describedby={hintId}
        className={[classes.rowList, className].filter(Boolean).join(" ")}
      >
        <InRowList.Provider value>{children}</InRowList.Provider>
      </div>
    </>
  );
}

/**
 * The last thing in a list: the same button its empty state offers ("Add a
 * place type", "Make a GeoPDF"), so adding is where the eye ends up after
 * scrolling to the bottom, not only when there is nothing to scroll.
 */
export function ListEnd({ children }: { children: ReactNode }) {
  const inList = useContext(InRowList);
  return (
    <div className={classes.listEnd} role={inList ? "listitem" : undefined}>
      {children}
    </div>
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
  badge,
  footer,
  onOpen,
  onPress,
  onClick,
  href,
  download,
  external = false,
  selected = false,
  accentEdge = false,
  disabled = false,
  disabledReason,
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
  /** How many are waiting on this row, drawn before `trailing`. A count is a
   *  badge, never the subtitle; zero is absent. Word it for assistive tech in
   *  `aria-label` ("Inbox, 3 unread"). */
  badge?: number;
  /** Controls that answer the row (Accept, Decline), on a line of their own
   *  INSIDE the card, under the text. Below the card they read as a caption
   *  for the next row down. */
  footer?: ReactNode;
  onOpen?: () => void;
  /**
   * A press on the card, anywhere but a control inside it (a ?, a >, the
   * switch itself), runs this: the whole card is the target of the switch in
   * `trailing`, which stays the one control in the accessibility tree and the
   * keyboard path, as `SwitchRow` does.
   */
  onPress?: () => void;
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
  /** An accent edge down the left side: a property of the row, such as
   *  unread. Its inset shadow is composed with the selected outline rather
   *  than replaced by it, so a selected row keeps it, and the row's box does
   *  not change size when it comes and goes. "warning" wears the warning
   *  tone instead (a form owed within the week). */
  accentEdge?: boolean | "warning";
  disabled?: boolean;
  /** Why a disabled row is, as `Button`'s: the row stays focusable and says it
   *  on hover and focus instead of going silently grey. */
  disabledReason?: string;
}) {
  const inList = useContext(InRowList);
  const subtitleId = useId();
  const descriptionId = useId();
  const describedBy =
    [description && descriptionId, subtitle && subtitleId]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    // The click is a convenience over the switch's own button (see `onPress`).
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      className={[classes.row, className].filter(Boolean).join(" ")}
      data-pressable={(onPress != null && !disabled) || undefined}
      onClick={(event) => {
        onClick?.(event);
        if (onPress && !disabled) pressOutsideControls(event, onPress);
      }}
      data-selected={selected}
      data-accent-edge={String(accentEdge)}
      data-disabled={disabled}
      data-row=""
      role={inList ? "listitem" : undefined}
      {...rest}
    >
      {leading != null && <div className={classes.leading}>{leading}</div>}
      <div className={classes.main}>
        {href ? (
          <a
            className={classes.open}
            data-row-open=""
            href={href}
            download={download}
            {...(external
              ? { target: "_blank", rel: "noopener noreferrer" }
              : {})}
            aria-describedby={describedBy}
          >
            <span className={classes.title}>{title}</span>
          </a>
        ) : onOpen && disabled && disabledReason ? (
          <Tooltip content={disabledReason}>
            {(tipId) => (
              <button
                type="button"
                className={classes.open}
                aria-disabled
                aria-describedby={[tipId, describedBy]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span className={classes.title}>{title}</span>
              </button>
            )}
          </Tooltip>
        ) : onOpen ? (
          <button
            type="button"
            className={classes.open}
            data-row-open=""
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
      {(trailing != null || !!badge) && (
        <div className={classes.trailing}>
          {!!badge && (
            <span className={classes.badge} aria-hidden>
              {badge}
            </span>
          )}
          {trailing}
        </div>
      )}
      {footer != null && <div className={classes.footer}>{footer}</div>}
    </div>
  );
}
