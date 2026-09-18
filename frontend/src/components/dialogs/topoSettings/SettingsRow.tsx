import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Tooltip } from "../../../ui";
import classes from "./topoSettings.module.css";

/**
 * One setting as a LINE: what it is at the left, the control that sets it at
 * the right — the same anatomy as `SwatchPicker` and the style sheet's widths
 * (DESIGN.md §9). The visible words are the row's; the control carries the same
 * words as its own accessible name (`hideLabel`, or `Toggle label`), so a
 * reader hears the setting and a pointer sees it once.
 *
 * `tooltip` is for what the label cannot say — the units, the scale, what turning
 * it on costs. It hangs off a focusable glyph rather than the row, so it is
 * reachable from the keyboard and dismissable with Escape (WCAG 1.4.13), and
 * the settings stay a list of lines instead of a wall of paragraphs.
 */
export default function SettingsRow({
  label,
  tooltip,
  disabled,
  children,
}: {
  label: string;
  tooltip?: string;
  /** Dimmed and inert: another setting on this tab has taken this one over. */
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={classes.row} data-disabled={disabled || undefined}>
      <span className={classes.rowLabel}>
        {label}
        {tooltip && <InfoTip label={label} content={tooltip} />}
      </span>
      {children}
    </div>
  );
}

/** The glyph a tooltip hangs from. A button, because it is the thing you move
 *  to and press Escape out of; its own name says which setting it explains. */
export function InfoTip({ label, content }: { label: string; content: string }) {
  return (
    <Tooltip content={content} placement="top-start">
      {(describedById) => (
        <button
          type="button"
          className={classes.info}
          aria-label={`About ${label.toLowerCase()}`}
          aria-describedby={describedById}
        >
          <Info size={14} aria-hidden />
        </button>
      )}
    </Tooltip>
  );
}
