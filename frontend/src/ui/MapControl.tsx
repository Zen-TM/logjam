import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { MAP_INK } from "@logjam/shared";
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
  announce = false,
}: {
  icon?: Glyph;
  children: ReactNode;
  action?: ReactNode;
  tone?: "info" | "warning";
  /**
   * Read out as it changes: for a notice that is the only answer to
   * something the user just did, after focus has gone back to the map.
   */
  announce?: boolean;
}) {
  return (
    <div
      className={[classes.notice, action ? classes.withAction : ""].join(" ")}
      data-tone={tone}
      role={tone === "warning" ? "alert" : announce ? "status" : undefined}
    >
      {icon && <Icon idea={icon} size={16} className={classes.noticeGlyph} />}
      <span className={classes.noticeText}>{children}</span>
      {action}
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

/**
 * The creek point a catchment was measured at: a drop of water, so it never
 * reads as the press's own dot beside it. Drawn in `MAP_INK` because it sits on
 * the map, not on the scheme. The pointer passes through it.
 */
export function MapCreekPoint() {
  return (
    <svg className={classes.creekPoint} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 2.5C11.6 3 5.5 10.2 5.5 14.7a6.5 6.5 0 0 0 13 0C18.5 10.2 12.4 3 12 2.5Z"
        fill={MAP_INK.waterLarge}
        stroke={MAP_INK.ring}
        strokeWidth={2}
        strokeLinejoin="round"
        paintOrder="stroke"
      />
      <path
        d="M9.2 15.2a3 3 0 0 0 2.3 2.6"
        fill="none"
        stroke={MAP_INK.ring}
        strokeWidth={1.4}
        strokeLinecap="round"
        opacity={0.8}
      />
    </svg>
  );
}

/**
 * Which way the water runs at a creek point: an arrowhead at the top of a box
 * centred on the point, so a marker rotated to the water's bearing swings it
 * round the drop to the downstream side.
 */
export function MapFlowArrow() {
  return (
    <svg className={classes.flowArrow} viewBox="0 0 48 48" aria-hidden>
      <path
        d="M24 0.5 33 13.5 24 10 15 13.5Z"
        fill={MAP_INK.waterLarge}
        stroke={MAP_INK.ring}
        strokeWidth={1.5}
        strokeLinejoin="round"
        paintOrder="stroke"
      />
    </svg>
  );
}

/**
 * A figure that follows the mouse over something drawn on the map (a creek's
 * own catchment). Hover only, so it repeats what a press can find out, and the
 * pointer passes through it.
 */
export function MapTip({ children }: { children: ReactNode }) {
  return <span className={classes.tip}>{children}</span>;
}
