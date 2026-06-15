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
  <IconButton size="small" onClick={onClose} sx={{ color: "var(--theme-text-primary)" }}>
    <CloseIcon fontSize="small" />
  </IconButton>
</DialogTitle>
```

- Always include close `IconButton` (top-right). Use `@mui/icons-material` `CloseIcon` — this is the one place it's correct.
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

## Conventions log (additive)

- **Attaching media before an entity exists (TripLogDialog):** lazy-draft pattern — first upload creates a draft row to link files to; Save PATCHes it; Cancel/close DELETEs it (cascade removes media). Avoids orphan rows when user cancels without uploading.
