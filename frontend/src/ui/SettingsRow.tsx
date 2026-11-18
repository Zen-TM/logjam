import type { ReactNode } from "react";
import { Tooltip } from "./Tooltip";
import classes from "./SettingsRow.module.css";
import { Icon } from "./Icon";
import type { Disablable } from "./Button";

/**
 * One setting as a LINE: what it is at the left, the control that sets it at
 * the right — the same anatomy as `ColourField` and the style sheet's widths
 * (DESIGN.md). The visible words are the row's; the control carries the same
 * words as its own accessible name (`hideLabel`, or `Toggle label`), so a
 * reader hears the setting and a pointer sees it once.
 *
 * `tooltip` is for what the label cannot say — the units, the scale, what turning
 * it on costs. It hangs off a focusable glyph rather than the row, so it is
 * reachable from the keyboard and dismissable with Escape (WCAG 1.4.13), and
 * the settings stay a list of lines instead of a wall of paragraphs.
 *
 * `infoLabel` is the glyph's accessible name, a whole message from the caller
 * ("About orientation"): the label is not lower-cased here, since a translated
 * word cannot be reshaped by code. A row with a note and no `infoLabel` falls
 * back to its visible label.
 */
export function SettingsRow({
  label,
  infoLabel,
  tooltip,
  disabled,
  disabledReason,
  children,
}: {
  label: string;
  infoLabel?: string;
  tooltip?: string;
  children: ReactNode;
} & Disablable) {
  // Another setting here has taken this one over: its control is dimmed and
  // `inert`, but the label stays readable and its glyph says why (§5), so a
  // reader who cannot see the dimming still finds the setting and the reason.
  const note = disabled && disabledReason ? disabledReason : tooltip;
  return (
    <div className={classes.row} data-disabled={disabled || undefined}>
      <span className={classes.rowLabel}>
        {label}
        {note && <InfoTip label={infoLabel ?? label} content={note} />}
      </span>
      <div className={classes.control} inert={disabled}>
        {children}
      </div>
    </div>
  );
}

/** The glyph a tooltip hangs from. A button, because it is the thing you move
 *  to and press Escape out of; `label` is its whole accessible name ("About
 *  orientation"), saying which setting it explains. */
export function InfoTip({
  label,
  content,
}: {
  label: string;
  content: string;
}) {
  return (
    <Tooltip content={content} placement="top-start">
      {(describedById) => (
        <button
          type="button"
          className={classes.info}
          aria-label={label}
          aria-describedby={describedById}
        >
          <Icon idea="info" size={14} aria-hidden />
        </button>
      )}
    </Tooltip>
  );
}
