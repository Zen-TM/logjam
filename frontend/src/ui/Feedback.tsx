import type { CSSProperties, ReactNode } from "react";
import { CircleAlert, CircleCheck, X, type LucideIcon } from "lucide-react";
import { IconButton } from "./Button";
import classes from "./Feedback.module.css";

/**
 * A state, as a word: "Queued", "Failed", "Shared". Not a control, so never
 * pressable, and never a `Chip`, which is one. Logjam GPS's four tones:
 * `accent` done or ready (the accent fill, the ink label), `outline` a neutral
 * state, `warning` needs the user, `muted` quiet and not a problem (paused).
 * An `icon` makes the state readable at a glance.
 */
export function StatusPill({
  label,
  tone = "outline",
  icon: Icon,
}: {
  label: string;
  tone?: "accent" | "outline" | "warning" | "muted";
  icon?: LucideIcon;
}) {
  return (
    <span className={classes.pill} data-tone={tone}>
      {Icon && <Icon size={12} aria-hidden />}
      {label}
    </span>
  );
}

/**
 * How far something has got. `value` (0–100) when it is known, as for an
 * upload; omitted while it is not, as for a job the server is running, which
 * then moves. `tone="warning"` is a run that failed. `label` names it.
 */
export function ProgressBar({
  label,
  value,
  tone = "accent",
}: {
  label: string;
  value?: number;
  tone?: "accent" | "warning";
}) {
  const known = value == null ? undefined : Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={known == null ? undefined : Math.round(known)}
      className={classes.progress}
      data-tone={tone}
      data-indeterminate={known == null}
      style={known == null ? undefined : ({ "--progress": `${known}%` } as CSSProperties)}
    >
      <span className={classes.progressFill} />
    </div>
  );
}

/**
 * What an empty list says. Sits directly on the page — no card — centred in the
 * space the list would fill, nudged a little above the middle. Says what would
 * be here and offers the way to get it.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  actions?: ReactNode;
}) {
  return (
    <div className={classes.empty}>
      <Icon size={24} aria-hidden className={classes.emptyGlyph} />
      <p className={classes.emptyTitle}>{title}</p>
      {body && <p className={classes.emptyBody}>{body}</p>}
      {actions && <div className={classes.emptyActions}>{actions}</div>}
    </div>
  );
}

/**
 * The bar a multi-select swaps into a rail's slot: clear, the count, then the
 * group verbs the caller passes (Buttons and IconButtons). Same height as a
 * chip rail, so the list below does not jump when selection starts.
 */
export function SelectionBar({
  countLabel,
  onClear,
  children,
}: {
  countLabel: string;
  onClear: () => void;
  children: ReactNode;
}) {
  return (
    <div role="group" aria-label="Selection" className={classes.selectionBar}>
      <IconButton icon={X} label="Clear selection (Esc)" onClick={onClear} />
      <span className={classes.selectionCount} aria-live="polite">
        {countLabel}
      </span>
      {children}
    </div>
  );
}

export type ToastSeverity = "success" | "error" | "info";

/** One transient message. The dismiss button sits at the far right edge. */
export function Toast({
  message,
  severity,
  onDismiss,
}: {
  message: string;
  severity: ToastSeverity;
  onDismiss: () => void;
}) {
  const Icon = severity === "error" ? CircleAlert : CircleCheck;
  return (
    <div className={classes.toast} role={severity === "error" ? "alert" : "status"}>
      <Icon size={16} aria-hidden className={classes.toastGlyph} />
      <span className={classes.toastText}>{message}</span>
      <IconButton icon={X} label="Dismiss" tone="onFill" size={14} round onClick={onDismiss} />
    </div>
  );
}
