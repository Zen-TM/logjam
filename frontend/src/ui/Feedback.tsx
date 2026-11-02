import {
  runToastAction,
  type LoadState,
  type ToastAction,
  type ToastTone,
} from "@logjam/shared";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { Button, IconButton } from "./Button";
import classes from "./Feedback.module.css";
import { Icon, type Glyph } from "./Icon";

/**
 * A state, as a word: "Queued", "Failed", "Shared". Not a control, so never
 * pressable, and never a `Chip`, which is one: it has NO fill and no edge
 * (filled is interactive, UX §4). Four tones: `accent` done or ready (a dot
 * in the accent), `outline` a neutral state, `warning` needs the user (a dot
 * in the warning), `muted` quiet and not a problem (paused). An `icon` makes
 * the state readable at a glance and stands in for the dot.
 */
export function StatusPill({
  label,
  tone = "outline",
  icon,
}: {
  label: string;
  tone?: "accent" | "outline" | "warning" | "muted";
  icon?: Glyph;
}) {
  return (
    <span
      className={classes.pill}
      data-tone={tone}
      data-glyph={icon ? "" : undefined}
    >
      {icon && <Icon idea={icon} size={12} />}
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
      style={
        known == null
          ? undefined
          : ({ "--progress": `${known}%` } as CSSProperties)
      }
    >
      <span className={classes.progressFill} data-own-motion />
    </div>
  );
}

/**
 * What an empty list says. Sits directly on the page — no card — centred in the
 * space the list would fill, nudged a little above the middle. Says what would
 * be here and offers the way to get it.
 */
export function EmptyState({
  icon,
  title,
  body,
  actions,
}: {
  icon: Glyph;
  title: string;
  body?: string;
  actions?: ReactNode;
}) {
  return (
    <div className={classes.empty}>
      <Icon idea={icon} size={24} className={classes.emptyGlyph} />
      <p className={classes.emptyTitle}>{title}</p>
      {body && <p className={classes.emptyBody}>{body}</p>}
      {actions && <div className={classes.emptyActions}>{actions}</div>}
    </div>
  );
}

/**
 * A load in flight (UX §11: loading is not empty). A spinner and a line saying
 * what is loading ("Loading your places…"), centred and muted; Logjam GPS's
 * `LoadingState` is the same. It is a status, so a screen reader hears it.
 */
export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <p className={classes.state} role="status">
      <Icon idea="loading" size={16} className={classes.spinner} />
      {label}
    </p>
  );
}

/**
 * A load that failed (UX §11: neither empty nor loading). Says it failed, in
 * our words, with Try again where trying again can help.
 */
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className={classes.errorState} role="alert">
      <p className={classes.state}>
        <Icon idea="warning" size={16} className={classes.errorGlyph} />
        {message}
      </p>
      {onRetry && (
        <Button variant="outline" compact onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/**
 * What a list's body is while its data is `state`: the loading line, the
 * failure with Try again, the `empty` state when there is one, or `children`.
 * A failed load never reaches `empty` (shared/DESIGN.md §11), so the one place
 * that chooses is here, not in each panel.
 */
export function ListBody({
  state,
  loadingLabel,
  error,
  onRetry,
  empty,
  children,
}: {
  state: LoadState;
  loadingLabel?: string;
  /** Our sentence for a load that failed ("Couldn't load places."). */
  error: string | null;
  onRetry?: () => void;
  /** Drawn instead of `children` when the data is in hand and there is nothing to list. */
  empty?: ReactNode;
  children: ReactNode;
}) {
  if (state === "loading")
    return (
      <div className={classes.listArea}>
        <LoadingState label={loadingLabel} />
      </div>
    );
  if (state === "failed")
    return (
      <div className={classes.listArea}>
        <ErrorState
          message={error ?? "Couldn't load this."}
          onRetry={onRetry}
        />
      </div>
    );
  if (empty) return <div className={classes.listArea}>{empty}</div>;
  return <>{children}</>;
}

/**
 * One verb in a selection bar, named in words: four look-alike icons in 348px
 * were a row of guesses. Keep the label to one short word so the bar stays on
 * one line at 380px; `danger` puts the warning edge on a Delete.
 */
export function SelectionVerb({
  danger = false,
  ...props
}: ComponentProps<typeof Button> & { danger?: boolean }) {
  return <Button {...props} compact variant={danger ? "danger" : "plain"} />;
}

/**
 * The bar a multi-select swaps into a rail's slot: clear, the count, then the
 * group verbs the caller passes (`SelectionVerb`s). Same height as a chip
 * rail, so the list below does not jump when selection starts.
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
      <IconButton
        icon="close"
        label="Clear selection (Esc)"
        onClick={onClear}
      />
      <span className={classes.selectionCount} aria-live="polite">
        {countLabel}
      </span>
      {children}
    </div>
  );
}

/** One transient message. The dismiss button sits at the far right edge. */
export function Toast({
  message,
  tone,
  action,
  onDismiss,
}: {
  message: string;
  tone: ToastTone;
  /** The one thing the outcome offers ("Undo", "Open"); pressing it dismisses. */
  action?: ToastAction;
  onDismiss: () => void;
}) {
  const icon = tone === "error" ? "warning" : "success";
  return (
    <div className={classes.toast} role={tone === "error" ? "alert" : "status"}>
      <Icon idea={icon} size={16} className={classes.toastGlyph} />
      <span className={classes.toastText}>{message}</span>
      {action && (
        <button
          type="button"
          className={classes.toastAction}
          onClick={() => runToastAction(action, onDismiss)}
        >
          {action.label}
        </button>
      )}
      <IconButton
        icon="close"
        label="Dismiss"
        tone="onInverse"
        size={14}
        round
        onClick={onDismiss}
      />
    </div>
  );
}
