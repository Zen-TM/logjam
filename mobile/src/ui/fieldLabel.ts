import { fontSize, theme } from "../theme";

/**
 * The label of a field or a control inside a form or a filter sheet: sentence
 * case, small, muted, as on Logjam Web (`TextField.module.css`).
 *
 * Uppercase is for a SECTION HEADING (`SectionHeader`) only. A label that
 * copies it under a heading reads as a second heading, and the two stop saying
 * which is which. Guard: `fieldLabel.test.ts`.
 */
export const fieldLabel = {
  color: theme.textMuted,
  fontSize: fontSize.sm,
} as const;
