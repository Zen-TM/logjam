import type { ReactElement, ReactNode } from "react";
import { LinearProgress } from "@mui/material";
import { X } from "lucide-react";
import classes from "./JobRibbon.module.css";

/**
 * Wraps one or more JobRibbon rows flush with the panel header, plus an
 * optional "Show all (N)" disclosure below them. Both LidarPanel (topo jobs +
 * exports) and GeoPdfsPanel (GeoPDF jobs) cap the visible list and disclose
 * the rest via `showAllCount`.
 */
export function JobRibbonStack({
  children,
  showAllCount,
  onShowAll,
}: {
  children: ReactNode;
  showAllCount?: number;
  onShowAll?: () => void;
}): ReactElement {
  return (
    <div className={classes.ribbonStack}>
      {children}
      {showAllCount !== undefined && (
        <button className={classes.showAllButton} onClick={onShowAll}>
          Show all ({showAllCount})
        </button>
      )}
    </div>
  );
}

/**
 * One in-progress or failed async-job row: a type chip, name, optional
 * dismiss button, and an eta/status label above a progress bar. Callers
 * pre-compute `etaLabel` since topo/export/GeoPDF status vocabularies differ.
 */
export function JobRibbon({
  name,
  chip,
  etaLabel,
  failed,
  errorMessage,
  onDismiss,
}: {
  name: string;
  chip: string;
  etaLabel: string;
  failed: boolean;
  errorMessage?: string | null;
  onDismiss?: () => void;
}): ReactElement {
  return (
    <div className={classes.ribbon}>
      <div className={classes.ribbonHead}>
        <span className={classes.chip}>{chip}</span>
        <span className={classes.ribbonName}>{name}</span>
        {onDismiss && (
          <button className={classes.ribbonDismiss} onClick={onDismiss} title="Dismiss">
            <X size={12} />
          </button>
        )}
        <span
          className={failed ? classes.ribbonEtaFailed : classes.ribbonEta}
          title={failed && errorMessage ? errorMessage : undefined}
        >
          {etaLabel}
        </span>
      </div>
      {failed ? (
        <LinearProgress
          variant="determinate"
          value={100}
          sx={{ "& .MuiLinearProgress-bar": { backgroundColor: "var(--theme-warning)" } }}
        />
      ) : (
        <LinearProgress />
      )}
    </div>
  );
}

/**
 * Pre-computed eta label for an in-progress job: "~N min" when a positive
 * estimate is available, otherwise the caller-supplied fallback (e.g.
 * "Processing…"). Null-safe for pre-migration rows with no estimate.
 */
export function minutesEta(estimatedSeconds: number | null, fallback: string): string {
  if (estimatedSeconds != null && estimatedSeconds > 0) {
    return `~${Math.ceil(estimatedSeconds / 60)} min`;
  }
  return fallback;
}
