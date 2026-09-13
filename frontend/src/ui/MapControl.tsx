import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import type { LucideIcon } from "lucide-react";
import classes from "./MapControl.module.css";

/**
 * A button floating over the map. `pressed` makes it a toggle (Layers open,
 * 3D on) and fills it with the accent. Floating over the map is the ONLY place
 * the kit casts a shadow.
 */
export function MapButton({
  icon: Icon,
  label,
  pressed,
  className,
  ref,
  type = "button",
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label" | "aria-pressed"> & {
  icon: LucideIcon;
  label: string;
  pressed?: boolean;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={[classes.mapButton, className].filter(Boolean).join(" ")}
      {...rest}
    >
      <Icon size={22} aria-hidden />
    </button>
  );
}

/** Buttons that belong together (zoom in / out), one shadowed block. */
export function MapButtonGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className={classes.group}>
      {children}
    </div>
  );
}

/**
 * A notice pinned over the map: something true about what the map is showing
 * right now (filtered, generating, selected). An optional trailing action.
 */
export function Notice({
  icon: Icon,
  children,
  action,
}: {
  icon: LucideIcon;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={[classes.notice, action ? classes.withAction : ""].join(" ")}>
      <Icon size={16} aria-hidden className={classes.noticeGlyph} />
      <span>{children}</span>
      {action}
    </div>
  );
}
