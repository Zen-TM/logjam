# Dialogs — Logjam

MUI dialogs. Unlike sidebar panels, MUI `<Button>` and `<Typography>` are correct here — dialogs are MUI-native surfaces.

## Shell

Always `maxWidth="sm"` + `fullWidth`. `PaperProps.sx` sets `backgroundColor: var(--theme-primary)` / `color: var(--theme-text-primary)`. Guard `onClose` during async operations: `saving ? undefined : onClose`.

## DialogTitle

Flex row, `justifyContent: "space-between"`, `pb: 1`. Always include a close `IconButton` (top-right) using `@mui/icons-material` `CloseIcon` — this is the one place that import is correct. Always give the icon-only `IconButton` an `aria-label` (e.g. `"Close dialog"`) — MUI does not derive an accessible name from the icon child (WCAG 1.1.1). Use `alignItems: "flex-start"` only when the title has a multi-line subtitle block.

## DialogContent

Always the `dividers` prop, with `sx={{ borderColor: "rgba(255,255,255,0.1)" }}`.

## Buttons (DialogActions)

| Purpose | Props |
|---|---|
| Primary action (Save, Import…) | `variant="contained"` `color="secondary"` |
| Cancel / Close | text variant + `sx={{ color: "var(--theme-text-primary)" }}` |
| Outlined action (Draw, Download…) | `variant="outlined"`, accent border/text |
| Destructive trigger | `color="error"` text variant |
| Destructive confirmation | `color="error"` `variant="contained"` |

## Form inputs (TextField / Select)

**Never inline an `sx` that re-implements input/select colors, border, or menu paper.** Spread `fieldSx` / `selectSx` / `menuPaperProps` from `csvImport/dialogStyles.ts`, extras on top (`sx={{ ...fieldSx, mb: 0.5 }}`). For a `<TextField select>` the menu props nest one level deeper: `SelectProps={{ MenuProps: menuPaperProps }}` (a bare `<Select>` takes `MenuProps={menuPaperProps}`). Inline variants are what drifted across dialogs in UX-002/003.

## Touch targets

Compact controls (icon buttons, the delete bins, small text buttons, checkboxes) spread `touchTargetSx` from `csvImport/dialogStyles.ts`. It grows the **hit area** to 44×44 via a centred pseudo-element while leaving the rendered box alone, so the target meets HIG/Material/WCAG without changing the form's vertical rhythm.

Don't "fix" this by forcing a visual 44px onto every control instead: measured on the Log Trip form at 390×844, that adds **77px** of scroll and pushes the whole custom-field stack under the soft keyboard, for controls whose mis-tap cost is zero (a 342px-wide text field). The pseudo-element expands into the row's dead gap only — it never overlaps the neighbouring input's target.

Real `minHeight: 44` (via `dialogActionButtonSx`) is right for `DialogActions` buttons: they're the primary actions and sit outside the scrolling body, so the pixels are free.

## Multiline notes

Notes fields are `multiline` + `minRows` + `maxRows={NOTES_MAX_ROWS}` — never `rows` (fixed height nests a scrollbar inside an already-scrolling dialog). `minRows` is a per-dialog choice; the cap is shared and lives in `dialogStyles.ts`.

## Conventions log (additive)

- **Attaching media before an entity exists (TripLogDialog):** lazy-draft pattern — first upload creates a draft row to link files to; Save PATCHes it; Cancel/close DELETEs it (cascade removes media). Avoids orphan rows when user cancels without uploading.
