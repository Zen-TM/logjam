// What an import did, once it has done it: "what changed, and can I take it
// back?"
//
// The tallies are a StatGrid — a label over its value is how every other
// figure in this app is read, and the comma sentence it replaces ("3 created,
// 26 merged, 2 skipped.") made the reader parse prose to find one number.
// Nothing is behind a disclosure: the merge list used to sit in a closed
// accordion, which is the shape DESIGN.md §6 rules out twice over — the answer
// the reader came for cannot be a click away.
import { Undo2 } from "lucide-react";
import { Button, SectionHeader, StatGrid, type Stat } from "../../ui";
import classes from "./ImportResultSummary.module.css";

// ── Types ──────────────────────────────────────────────────────────────────────

/** A single tally shown in the headline (e.g. "271 merged"). */
export type HeadlineCount = {
  count: number;
  label: string;
};

/**
 * A section of detail lines. `title` is optional: a single section under a
 * self-describing `detailsLabel` needs no heading repeating it.
 */
export type DetailSection = {
  title?: string;
  items: string[];
};

export type ImportResultSummaryProps = {
  /** The tallies (imported, linked, created, skipped). A zero is left out. */
  headline: HeadlineCount[];

  /** Detail lines under their own heading — which rows merged into what. */
  details?: DetailSection[];

  /**
   * The heading over `details`. Defaults to "Details". Set it to say what is
   * listed (e.g. "26 places merged into existing entries").
   */
  detailsLabel?: string;

  /** Errors that occurred during import. */
  errors?: string[];

  /**
   * Non-fatal per-row/per-field coercion notices (e.g. a non-numeric value that
   * was left empty). Shown, but styled as advisories rather than errors — the
   * rows they refer to were still imported (IMPORT-5).
   */
  warnings?: string[];

  /** When provided, renders an "Undo this import" button and calls back on click. */
  onUndo?: () => void;

  /** Whether the undo action is currently in progress. */
  undoing?: boolean;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

// A tally of zero is not a fact worth a cell: "0 skipped" is noise beside the
// two numbers that did move.
function headlineStats(headline: HeadlineCount[]): Stat[] {
  return headline
    .filter((tally) => tally.count > 0)
    .map((tally) => ({
      // The label carries the verb, the value the number — the same way a
      // route's figures read.
      label: tally.label.charAt(0).toUpperCase() + tally.label.slice(1),
      value: String(tally.count),
    }));
}

// ── Component ──────────────────────────────────────────────────────────────────

function ImportResultSummary({
  headline,
  details,
  detailsLabel = "Details",
  errors,
  warnings,
  onUndo,
  undoing,
}: ImportResultSummaryProps): React.JSX.Element {
  const stats = headlineStats(headline);
  const detailSections = (details ?? []).filter((section) => section.items.length > 0);
  const hasErrors = errors !== undefined && errors.length > 0;
  const hasWarnings = warnings !== undefined && warnings.length > 0;

  return (
    <div className={classes.container}>
      {stats.length > 0 ? (
        <StatGrid stats={stats} />
      ) : (
        <p className={classes.nothing}>No changes made.</p>
      )}

      {hasWarnings && (
        <section className={classes.section}>
          <SectionHeader title="Left empty" count={warnings!.length} />
          <ul className={`${classes.detailList} ${classes.warningList}`}>
            {warnings!.map((warningMessage, i) => (
              <li key={i} className={classes.detailItem}>
                <span className={classes.detailBullet} />
                <span>{warningMessage}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {hasErrors && (
        <section className={classes.section}>
          <SectionHeader title="Problems" count={errors!.length} />
          <ul className={`${classes.detailList} ${classes.errorList}`}>
            {errors!.map((errMsg, i) => (
              <li key={i} className={classes.detailItem}>
                <span className={classes.detailBullet} />
                <span>{errMsg}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {detailSections.length > 0 && (
        <section className={classes.section}>
          <SectionHeader title={detailsLabel} />
          {detailSections.map((section, sectionIndex) => (
            <div key={sectionIndex} className={classes.detailGroup}>
              {section.title !== undefined && (
                <p className={classes.groupTitle}>{section.title}</p>
              )}
              <ul className={classes.detailList}>
                {section.items.map((item, i) => (
                  <li key={i} className={classes.detailItem}>
                    <span className={classes.detailBullet} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {/* Absent when nothing was created or merged — there is no import to take
          back, and a button that would do nothing invites the press (§7). */}
      {onUndo && stats.length > 0 && (
        <Button
          variant="danger"
          compact
          icon={Undo2}
          className={classes.undo}
          onClick={onUndo}
          busy={undoing}
        >
          {undoing ? "Undoing…" : "Undo this import"}
        </Button>
      )}
    </div>
  );
}

export default ImportResultSummary;
