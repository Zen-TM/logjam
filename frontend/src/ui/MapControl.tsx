import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { Icon, type Glyph } from "./Icon";
import classes from "./MapControl.module.css";

/**
 * A button floating over the map. `pressed` makes it a toggle (3D on);
 * `expanded` makes it a disclosure for the panel it opens (Layers, Tools).
 * Either fills it with the accent while on. Floating over the map is the ONLY
 * place the kit casts a shadow.
 */
export function MapButton({
  icon,
  label,
  pressed,
  expanded,
  className,
  ref,
  type = "button",
  ...rest
}: Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "aria-label" | "aria-pressed" | "aria-expanded"
> & {
  icon: Glyph;
  label: string;
  pressed?: boolean;
  expanded?: boolean;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      className={[classes.mapButton, className].filter(Boolean).join(" ")}
      {...rest}
    >
      <Icon idea={icon} size={20} />
    </button>
  );
}

/** Buttons that belong together (zoom in / out), one shadowed block. */
export function MapButtonGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className={classes.group}>
      {children}
    </div>
  );
}

/**
 * A notice pinned over the map: something true about what the map is showing
 * right now (filtered, generating, selected). An optional trailing action.
 * The same component as Logjam GPS's `Notice`: its words are `text`, centred IN
 * the notice; the intent is the glyph, and `tone="warning"` adds the edge.
 */
export function Notice({
  icon,
  children,
  action,
  tone = "info",
  controls,
  twoLines = false,
}: {
  icon?: Glyph;
  children: ReactNode;
  action?: ReactNode;
  tone?: "info" | "warning";
  /** Controls in a row under the words, for a notice that is a mode with
   *  ways out (a plan on the map), as Logjam GPS's `Notice` has. */
  controls?: ReactNode;
  /** Words with a user's own title in them stop at two lines
   *  (shared/DESIGN.md §9). */
  twoLines?: boolean;
}) {
  const line = (
    <>
      {icon && <Icon idea={icon} size={16} className={classes.noticeGlyph} />}
      <span
        className={[classes.noticeText, twoLines ? classes.twoLines : ""].join(
          " ",
        )}
      >
        {children}
      </span>
      {action}
    </>
  );
  return (
    <div
      className={[
        classes.notice,
        action ? classes.withAction : "",
        controls ? classes.stacked : "",
      ].join(" ")}
      data-tone={tone}
      role={tone === "warning" ? "alert" : undefined}
    >
      {controls ? (
        <>
          <span className={classes.noticeLine}>{line}</span>
          <span className={classes.noticeControls}>{controls}</span>
        </>
      ) : (
        line
      )}
    </div>
  );
}

/**
 * The dot a press on the map leaves at the point it asked about ("What is
 * here?"), so the question has an answer's place to point at. A drawn dot and
 * not an arrow: the popover anchors to it and the pointer passes through it.
 */
export function MapPointDot() {
  return <span className={classes.pointDot} aria-hidden />;
}
