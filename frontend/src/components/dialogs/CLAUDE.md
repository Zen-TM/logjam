# Dialogs — Logjam

MUI dialogs. Unlike sidebar panels, MUI `<Button>` and `<Typography>` are correct here — dialogs are MUI-native surfaces.

## Shell

```tsx
<Dialog
  maxWidth="sm"
  fullWidth
  onClose={saving ? undefined : onClose}
  PaperProps={{ sx: { backgroundColor: "var(--theme-primary)", color: "var(--theme-text-primary)" } }}
>
```

- Always `maxWidth="sm"` + `fullWidth`.
- Guard `onClose` during async operations: `saving ? undefined : onClose`.

## DialogTitle

```tsx
<DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pb: 1 }}>
  Title text
  <IconButton aria-label="Close dialog" size="small" onClick={onClose} sx={{ color: "var(--theme-text-primary)" }}>
    <CloseIcon fontSize="small" />
  </IconButton>
</DialogTitle>
```

- Always include close `IconButton` (top-right). Use `@mui/icons-material` `CloseIcon` — this is the one place it's correct.
- Always give the icon-only `IconButton` an `aria-label` (e.g. `"Close dialog"`) — MUI does not derive an accessible name from the icon child (WCAG 1.1.1).
- Use `alignItems: "flex-start"` only when title has a multi-line subtitle block.

## DialogContent

```tsx
<DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
```

Always `dividers` prop with that border color.

## Buttons (DialogActions)

| Purpose | Props |
|---|---|
| Primary action (Save, Import…) | `variant="contained"` `color="secondary"` |
| Cancel / Close | text variant + `sx={{ color: "var(--theme-text-primary)" }}` |
| Outlined action (Draw, Download…) | `variant="outlined"`, accent border/text |
| Destructive trigger | `color="error"` text variant |
| Destructive confirmation | `color="error"` `variant="contained"` |

## Form inputs (TextField / Select)

```tsx
sx={{
  "& .MuiInputBase-input": { color: "var(--theme-text-primary)" },
  "& .MuiInputLabel-root": { color: "var(--theme-text-muted)" },
  "& .MuiInputLabel-root.Mui-focused": { color: "var(--theme-accent)" },
  "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--theme-accent)" },
}}
```

Select paper: `backgroundColor: "var(--theme-primary)"`, `color: "var(--theme-text-primary)"`.
Can be set once at `Dialog PaperProps` level (cascades) or per-field.

## Touch targets

Compact controls (icon buttons, the delete bins, small text buttons, checkboxes) spread `touchTargetSx` from `csvImport/dialogStyles.tsx`. It grows the **hit area** to 44×44 via a centred pseudo-element while leaving the rendered box alone, so the target meets HIG/Material/WCAG without changing the form's vertical rhythm.

Don't "fix" this by forcing a visual 44px onto every control instead: measured on the Log Trip form at 390×844, that adds **77px** of scroll and pushes the whole custom-field stack under the soft keyboard, for controls whose mis-tap cost is zero (a 342px-wide text field). The pseudo-element expands into the row's dead gap only — it never overlaps the neighbouring input's target.

Real `minHeight: 44` (via `dialogActionButtonSx`) is right for `DialogActions` buttons: they're the primary actions and sit outside the scrolling body, so the pixels are free.

## Multiline notes

Notes fields are `multiline` + `minRows` + `maxRows={NOTES_MAX_ROWS}` — never `rows` (fixed height nests a scrollbar inside an already-scrolling dialog). `minRows` is a per-dialog choice; the cap is shared and lives in `dialogStyles.tsx`.

## Conventions log (additive)

- **Attaching media before an entity exists (TripLogDialog):** lazy-draft pattern — first upload creates a draft row to link files to; Save PATCHes it; Cancel/close DELETEs it (cascade removes media). Avoids orphan rows when user cancels without uploading.
