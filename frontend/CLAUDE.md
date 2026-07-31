# Frontend — Logjam

React 19 + TypeScript + Vite SPA. MapLibre GL JS = core UI surface; most features = map interactions, sidebar panels, dialogs on top.

## React / TypeScript rules

- **Hooks pattern for API data:** `useState + useEffect + fetchCount + refetch`. Bump `fetchCount` to retrigger. Return `{ data, loading, error, refetch }`. Match `canyonUtils.ts`.
- **API calls:** always via `apiFetch` / `apiFetchBlob` from `canyonUtils.ts`. Never raw `fetch` — helper injects auth + base URL.
- **Strict TS:** no `any` (use `unknown` + narrow), explicit return types on exported functions/hooks. Don't widen types to silence compiler — fix source.
- **No new React contexts** without justification. Codebase has one (`themePreferences`); local state + prop-passing = default.
- **Component file layout:** co-locate `Component.tsx` + `Component.module.css`. Component-specific hooks/utils sit next to component, not global `hooks/` dir.

## Styling

> **Self-updating:** when user establishes new design conventions, ask before appending here.

- **CSS Modules** (`.module.css` co-located) for layout + color.
- **All colors via CSS custom properties** (`var(--theme-*)`) — never hardcode hex in CSS.
- **MUI `sx` prop** only for one-off layout tweaks on MUI components.
- **`composes`** from `src/styles/shared.module.css` for reusable button/input patterns.
- No styled-components. Emotion only present as MUI internal engine.

### Buttons and tokens

All colors, radii, transitions and text sizes are CSS custom properties defined in `src/index.css` — never hardcode a hex or a px literal for these. Reusable button/label/divider classes live in `src/styles/shared.module.css`; compose base `.btn` + one color variant + one size modifier.

**Never use MUI `<Button>` in sidebar panels** — compose the CSS module classes instead.

### Icons

- **lucide-react** — all sidebar/panel icons.
- **@mui/icons-material** — only inside MUI dialogs (e.g. `CloseIcon`).

## Error display

Three surfaces. One rule each. **Never render raw `err.message` from `apiFetch` or Amplify.**

| Surface | When | Import |
|---|---|---|
| `<ErrorBanner message={msg} onRetry? onDismiss?>` | Submission failure inside a dialog or panel form. One banner, above `DialogActions`. | `from "../feedback/ErrorBanner"` |
| `<FieldError message={msg \| null}>` | Per-field validation, directly under the input. Renders nothing when `null`. | `from "../feedback/FieldError"` |
| `useToast().error(msg)` | Background failures with no form to attach to (refetch, async panel actions). Auto-dismisses after 6 s. | `from "../feedback/ToastProvider"` |

**Message rules:**
1. Pass every caught error through `messageFromError(err, "Couldn't do X.")` from `../../errors/messageFromError`.
2. Server-supplied `{ error }` text wins automatically (parsed by `apiFetch`). Good for 409 domain messages like "Already friends or request pending."
3. Always `console.error(err)` before calling `messageFromError` — never lose raw detail.
4. Hand-crafted context beats generic: `"Couldn't save canyon."` not `"An error occurred."`.
5. No HTTP status codes, path strings, or stack traces in user-facing text.
6. **Best-effort background operations** (prefetch, hydration, poll-resume) that intentionally don't surface a toast on failure: `.catch(console.error)` is acceptable, but add a one-line `// Best-effort: <why>` comment so the silence reads as intentional, not an oversight.

**Hook contract:** every data hook returns `error: string | null` (already user-friendly via `messageFromError`). Callers surface via `<ErrorBanner>` or toast.

## Pointers

- **CSP / security headers:** adding a tile provider, API, or image CDN needs `CSP_PROD` in `vite.config.ts` updated — see the **csp-hosts** skill.
- **E2E (Playwright):** `frontend/e2e/CLAUDE.md`.

## Conventions log (additive)

### Dialog inputs/selects use shared sx — never inline

Every MUI `TextField`/`Select` in a dialog applies `fieldSx`/`selectSx`/`menuPaperProps` from `csvImport/dialogStyles.ts` — never inline an `sx` that re-implements input/select colors, border, or menu paper. Spread extras on top (`sx={{ ...fieldSx, mb: 0.5 }}`). For a `<TextField select>`, the menu props nest one level deeper: `SelectProps={{ MenuProps: menuPaperProps }}` (a bare `<Select>` takes `MenuProps={menuPaperProps}`). Inline variants drifted (focused-label color, icon color, font size) across dialogs — UX-002/003 (2026-06-22), continuation of the 2026-06-10 UX-003.

### Custom-field forms in dialogs

Never re-implement the add-custom-field sub-form or per-field inputs inline — use `dialogs/AddCustomFieldForm.tsx` + `dialogs/CustomFieldInput.tsx`, which source `fieldSx`/`selectSx`/`menuPaperProps` from `csvImport/dialogStyles.ts`. The two dialogs drifted visually when this was duplicated (UX-002/003). Unset boolean custom fields default to `false` via `dialogs/customFieldValues.ts` so the unchecked checkbox and the persisted value agree — don't reintroduce a `null` state in edit forms.

### Consent versioning

Bumping `CURRENT_CONSENT_VERSION` (only with materially changed ToS/privacy wording) is all that's needed client-side: `App.tsx` blocks existing users behind `ConsentGate` when `needsReconsent()` is true; the server rejects any other version on record. Don't add per-feature consent prompts.

### File inputs

- Reset `<input type=file>` `.value` **after** invoking the handler, never before — `input.files` is a live `FileList`; clearing first empties the selection (drop path is unaffected, so click-select silently breaks).

### Tooltips

Add when a label alone doesn't convey units, scale, or consequence. Content: what it means + a real-world example if helpful. Skip if self-explanatory.

Patterns: topo settings use `SettingsRow tooltip="..."`. MUI dialog text fields use `InputProps.endAdornment` with an `InfoOutlinedIcon`. Select fields (dropdown arrow conflicts) wrap the whole `TextField` in `<Tooltip><Box sx={{ flex: 1, minWidth: 0 }}>`. Sidebar panels use native HTML `title` attribute. Links in tooltips: pass `ReactNode` to `title` (MUI Tooltip is interactive by default). Disabled buttons need a `<span>` wrapper.

### Mobile / responsive

Single breakpoint: **`max-width: 768px`**, the canonical source being `useIsMobile()` (`src/useIsMobile.ts`, `MOBILE_MAX_WIDTH_PX`). Every mobile CSS `@media (max-width: 768px)` block and the hook must agree on this value.

- **Two mechanisms, kept in sync:** CSS media queries in the co-located `.module.css` for layout; `useIsMobile()` in JS for behaviour CSS can't express (rendering `BottomSheet` vs the desktop flyout, `fullScreen` dialogs, collapsing the sheet during map-pick).
- **Layout model on mobile:** map is full-bleed (`--nav-rail-width` overridden to `0` in `index.css`); NavRail becomes a fixed horizontal-scroll **bottom strip**; the active panel renders in a draggable **bottom sheet** (`sidebar/BottomSheet.tsx`, snap points peek/half/full).
- **z-index contract (don't break):** bottom sheet `z-index: 4`, backdrop `3`, and the mobile NavRail **must be above the sheet (`z-index: 5`)**. The sheet is bottom-anchored above the nav (`bottom: var(--bottom-nav-height)`); its drag translate sweeps its bottom edge *over* the nav region, so the nav only stays visible/tappable because it paints on top. Lowering the nav's z-index silently traps the user in whatever panel is open.
- **New dialogs:** add `fullScreen={isMobile}` on the `<Dialog>`. Collapse any multi-column `sx` flex/grid rows to one column on mobile (`flexDirection: isMobile ? "column" : "row"`, or a CSS media query). Small confirm sub-dialogs stay centered (don't fullScreen them).
- **Map-pick flows** (coord pick, area/bbox/extent select): App passes `collapseToPeek` to SidebarPanel so the sheet drops to peek and the map is reachable; dialog-initiated picks already hide their own dialog.
- **Heavy authoring tools** (GeoPDF, topo settings, CSV import) are desktop-first: `fullScreen` + `overflow-x` on dense grids + a "best on a larger screen" note, **not** full reflow.
- Use `100dvh` (not `100vh`) for full-height containers — mobile address-bar resize.

### Date-only values format with `timeZone: "UTC"`

Trip-log dates and date-typed custom fields are stored as UTC-midnight (the API does `new Date("YYYY-MM-DD")`, date-only). Any `new Date(iso).toLocaleDateString(...)` displaying one of these MUST pass `timeZone: "UTC"`, or AEST (UTC+10/+11) renders the previous calendar day (CH-001, 2026-06-22). This applies only to date-only values; true timestamps (`createdAt`, `*ResetAt`) display in local TZ correctly without it. Filter comparisons stay consistent because both sides parse as UTC midnight.