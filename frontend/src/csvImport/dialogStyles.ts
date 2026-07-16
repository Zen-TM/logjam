export const fieldSx = {
  "& .MuiInputBase-input": { color: "var(--theme-text-primary)", fontSize: "0.9em" },
  "& .MuiInputLabel-root": { color: "var(--theme-text-muted)" },
  "& .MuiInputLabel-root.Mui-focused": { color: "var(--theme-accent)" },
  "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--theme-accent)" },
};

export const selectSx = {
  color: "var(--theme-text-primary)",
  fontSize: "0.85em",
  "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--theme-accent)" },
  "& .MuiSvgIcon-root": { color: "var(--theme-text-muted)" },
};

export const menuPaperProps = {
  PaperProps: {
    sx: { backgroundColor: "var(--theme-primary)", color: "var(--theme-text-primary)" },
  },
};

// Minimum touch target: Apple HIG 44pt, Material 48dp, WCAG 2.5.5. The mobile
// NavRail already ships 48×48; the dialog forms never inherited it.
export const MIN_TOUCH_TARGET_PX = 44;

// Grows a compact icon/text button's HIT area to 44×44 while leaving its
// rendered box alone. A transparent, centred pseudo-element is part of the
// button's hit region, so the thumb target grows and the form's vertical
// rhythm does not (measured at 390×844: +0px of scroll height).
//
// Hit-area-only is deliberate here, not a shortcut. Measured on the Log Trip
// form, forcing a visual 44px onto every control adds 77px of scroll and pushes
// the whole custom-field stack under the soft keyboard — it makes the form
// harder to use in exchange for a number. These buttons instead expand into the
// dead space of the surrounding gap: the delete bin sits 8px from the input it
// deletes and expands 7px toward it, so it consumes the gap without ever
// overlapping the input's own target. The input stays exactly as easy to hit.
//
// Requires a positioned ancestor — MUI ButtonBase is `position: relative`, so
// every IconButton/Button/Checkbox already qualifies.
export const touchTargetSx = {
  "&::after": {
    content: '""',
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: MIN_TOUCH_TARGET_PX,
    height: MIN_TOUCH_TARGET_PX,
  },
} as const;

// Primary/secondary dialog actions get a real 44px box rather than a hidden hit
// area: they are the widest, most-aimed-at controls in the form, so the height
// is worth the pixels (they sit in DialogActions, outside the scrolling body).
export const dialogActionButtonSx = {
  minHeight: MIN_TOUCH_TARGET_PX,
} as const;

// Notes auto-grow cap. Notes are the field the mobile user opens the app to
// write, so the box follows the text instead of nesting a scrollbar inside an
// already-scrolling dialog — but it stops at 12 rows (~265px at 390px wide, a
// third of the dialog body) so a long note grows *into* the dialog's scroll
// rather than becoming the dialog. Past the cap the inner scrollbar returns,
// which is the correct behaviour at that length.
//
// The resting height (`minRows`) stays a per-dialog choice — trip notes are the
// headline field, canyon notes are one of twelve — but the cap is a single
// shared decision and lives here.
export const NOTES_MAX_ROWS = 12;

// High-contrast filled chip for trip-type tags — same accent-fill/dark-label
// system as .btnFilledAccent in styles/shared.module.css (accent is tuned
// light enough that the dark primary is the AA-readable label on it, in every
// theme scheme). Visually distinct from default-grey canyon chips. Used by
// TripLogDialog (selected-type chips) and TripLogViewDialog; the trip cards
// in TripLogsPanel mirror it in CSS (.typeChip).
export const typeChipSx = {
  backgroundColor: "var(--theme-accent)",
  color: "var(--theme-primary)",
  fontWeight: 600,
  "& .MuiChip-deleteIcon": { color: "var(--theme-primary)", opacity: 0.6 },
  "& .MuiChip-deleteIcon:hover": { color: "var(--theme-primary)", opacity: 1 },
} as const;
