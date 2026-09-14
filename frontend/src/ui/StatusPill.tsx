import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import classes from "./StatusPill.module.css";

export type PillTone = "accent" | "outline" | "warning" | "muted";

/**
 * Small status pill. `accent` = filled (active / unread / affirmative),
 * `outline` = neutral bordered, `warning` = attention / failed,
 * `muted` = de-emphasised state.
 *
 * Fully rounded (`--radius-pill`) and never wider than its text; an optional
 * `icon` carries state for glance-reading.
 */
export function StatusPill({
  label,
  tone = "outline",
  icon: Icon,
  hue,
  className,
}: {
  label: string;
  tone?: PillTone;
  icon?: LucideIcon;
  hue?: string;
  className?: string;
}) {
  return (
    <span
      className={[classes.pill, classes[tone], className].filter(Boolean).join(" ")}
      style={hue ? ({ "--pill-hue": hue } as CSSProperties) : undefined}
      data-has-hue={hue != null}
    >
      {Icon && <Icon size={12} aria-hidden className={classes.icon} />}
      <span className={classes.label}>{label}</span>
    </span>
  );
}
