import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, X, type LucideIcon } from "lucide-react";
import { IconButton } from "./Button";
import classes from "./Feedback.module.css";

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
      <Icon size={28} aria-hidden className={classes.emptyGlyph} />
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
      <Icon size={18} aria-hidden className={classes.toastGlyph} />
      <span className={classes.toastText}>{message}</span>
      <IconButton icon={X} label="Dismiss" tone="onFill" size={16} onClick={onDismiss} />
    </div>
  );
}
