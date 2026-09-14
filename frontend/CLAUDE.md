# Frontend — Logjam

React 19 + TypeScript + Vite SPA. MapLibre GL JS = core UI surface; most features = map interactions, sidebar panels, dialogs on top.

## React / TypeScript rules

- **Hooks pattern for API data:** `useState + useEffect + fetchCount + refetch`. Bump `fetchCount` to retrigger. Return `{ data, loading, error, refetch }`. Match `placeUtils.ts`.
- **API calls:** always via `apiFetch` / `apiFetchBlob` from `placeUtils.ts`. Never raw `fetch` — helper injects auth + base URL.
- **Strict TS:** no `any` (use `unknown` + narrow), explicit return types on exported functions/hooks. Don't widen types to silence compiler — fix source.
- **No new React contexts** without justification. Codebase has one (`themePreferences`); local state + prop-passing = default.
- **Component file layout:** co-locate `Component.tsx` + `Component.module.css`. Component-specific hooks/utils sit next to component, not global `hooks/` dir.

## Styling

> **Self-updating:** when user establishes new design conventions, ask before appending here.

- **`frontend/DESIGN.md` and the `src/ui` kit govern all UI.** Compose the kit; a screen needing something it lacks adds it to the kit. MUI is an ESLint error outside `MUI_LEGACY_FILES` (`eslint.config.js`), a list that may only shrink. `PlacesPanel.tsx` is the reference page.

- **A control's size is a token, never px** (2026-09-14). Heights and hit targets read `--control-lg` / `--control-md` / `--control-sm` (36/32/24 under a mouse), margins `--gutter`, type `--font-*` with 12px as the floor; `@media (pointer: coarse)` in `index.css` gives a touch screen Logjam GPS's 44/40/32. The phone's sizes made the 380px panel feel cramped because the content was too big, and a hard-coded height silently opts out of both the density and the touch step. Map chrome keeps its own larger step (42). Guard: `src/ui/controlSizes.test.ts`, scoped to the kit (screens compose it); see `DESIGN.md` §4.

- **CSS Modules** (`.module.css` co-located): screen modules do layout, the kit does look.
- **Every colour, radius, transition and text size is a custom property in `src/index.css`** (`var(--theme-*)`, `--ink`, `--hue-*`, `--font-*`, `--radius-*`) — never hardcode a hex or a px literal for these. No styled-components, no Emotion.
- **Icons are lucide-react**, everywhere.
- **Files still on `MUI_LEGACY_FILES`** use MUI, `sx`, `@mui/icons-material` and the `.btn` compositions in `src/styles/shared.module.css`. Those are the patterns being removed: don't extend them or copy them into new code; rebuild the file onto the kit when you touch it.

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
4. Hand-crafted context beats generic: `"Couldn't save place."` not `"An error occurred."`.
5. No HTTP status codes, path strings, or stack traces in user-facing text.
6. **Best-effort background operations** (prefetch, hydration, poll-resume) that intentionally don't surface a toast on failure: `.catch(console.error)` is acceptable, but add a one-line `// Best-effort: <why>` comment so the silence reads as intentional, not an oversight.

**Hook contract:** every data hook returns `error: string | null` (already user-friendly via `messageFromError`). Callers surface via `<ErrorBanner>` or toast.

## Pointers

- **CSP / security headers:** adding a tile provider, API, or image CDN needs `CSP_PROD` in `vite.config.ts` updated — see the **csp-hosts** skill.
- **E2E (Playwright):** `frontend/e2e/CLAUDE.md`.

## Conventions log (additive)

### Dialog inputs/selects use shared sx — never inline

_Applies to MUI dialogs still on `MUI_LEGACY_FILES`; a rebuilt dialog uses the kit's `TextField` instead._ Every MUI `TextField`/`Select` in a dialog applies `fieldSx`/`selectSx`/`menuPaperProps` from `csvImport/dialogStyles.ts` — never inline an `sx` that re-implements input/select colors, border, or menu paper. Spread extras on top (`sx={{ ...fieldSx, mb: 0.5 }}`). For a `<TextField select>`, the menu props nest one level deeper: `SelectProps={{ MenuProps: menuPaperProps }}` (a bare `<Select>` takes `MenuProps={menuPaperProps}`). Inline variants drifted (focused-label color, icon color, font size) across dialogs — UX-002/003 (2026-06-22), continuation of the 2026-06-10 UX-003.

### Custom-field forms in dialogs

Never re-implement the add-custom-field sub-form or per-field inputs inline — use `dialogs/AddCustomFieldForm.tsx` + `dialogs/CustomFieldInput.tsx` (rebuild those two onto the kit rather than forking them when their dialogs move off MUI). Today they source `fieldSx`/`selectSx`/`menuPaperProps` from `csvImport/dialogStyles.ts`. The two dialogs drifted visually when this was duplicated (UX-002/003). Unset boolean custom fields default to `false` via `dialogs/customFieldValues.ts` so the unchecked checkbox and the persisted value agree — don't reintroduce a `null` state in edit forms.

### Consent versioning

Bumping `CURRENT_CONSENT_VERSION` (only with materially changed ToS/privacy wording) is all that's needed client-side: `App.tsx` blocks existing users behind `ConsentGate`; the server rejects any other version on record. Don't add per-feature consent prompts.

The block is one decision, `consentGate()` in `src/consent.ts` (tested in `consent.test.ts`), used twice: `blocked` renders the gate, and `settled` is the `enabled` argument every user-data hook and boot effect takes instead of `authenticated` (`loadsUserData` in App.tsx). Gate on `authenticated` alone and you get FECO-005 back — the gate stops the UI while the app fetches the user's places, trips, friends and notifications behind it. `useAuth` and `useCurrentUser` are the only two that stay on `authenticated`: they are how the answer arrives.

### File inputs

- Reset `<input type=file>` `.value` **after** invoking the handler, never before — `input.files` is a live `FileList`; clearing first empties the selection (drop path is unaffected, so click-select silently breaks).

### Tooltips

Add when a label alone doesn't convey units, scale, or consequence. Content: what it means + a real-world example if helpful. Skip if self-explanatory.

Patterns: kit surfaces use `src/ui` `Tooltip` (hover AND focus, Escape-dismissable, DESIGN.md §10), and an `IconButton`'s required `label` is already its tooltip. In files still on `MUI_LEGACY_FILES`: topo settings use `SettingsRow tooltip="..."`; MUI dialog text fields use `InputProps.endAdornment` with an `InfoOutlinedIcon`; select fields (dropdown arrow conflicts) wrap the whole `TextField` in `<Tooltip><Box sx={{ flex: 1, minWidth: 0 }}>`; links in tooltips pass `ReactNode` to `title` (MUI Tooltip is interactive by default); disabled buttons need a `<span>` wrapper.

### Mobile / responsive

Single breakpoint: **`max-width: 768px`**, the canonical source being `useIsMobile()` (`src/useIsMobile.ts`, `MOBILE_MAX_WIDTH_PX`). Every mobile CSS `@media (max-width: 768px)` block and the hook must agree on this value.

- **Two mechanisms, kept in sync:** CSS media queries in the co-located `.module.css` for layout; `useIsMobile()` in JS for behaviour CSS can't express (rendering `BottomSheet` vs the desktop flyout, `fullScreen` dialogs, collapsing the sheet during map-pick).
- **Layout model on mobile:** map is full-bleed (`--nav-rail-width` overridden to `0` in `index.css`); NavRail becomes Logjam GPS's 68px **tab bar** (Map · Places · Logs · Ways · More; Map closes the panel); the active panel renders in a draggable **bottom sheet** (`sidebar/BottomSheet.tsx`, snap points peek/half/full).
- **z-index contract (don't break):** bottom sheet `z-index: 4`, backdrop `3`, and the mobile NavRail **must be above the sheet (`z-index: 5`)**. The sheet is bottom-anchored above the nav (`bottom: var(--bottom-nav-height)`); its drag translate sweeps its bottom edge *over* the nav region, so the nav only stays visible/tappable because it paints on top. Lowering the nav's z-index silently traps the user in whatever panel is open.
- **New dialogs** use the kit `Dialog` (`DESIGN.md` §6): `size="large"` fills a narrow screen from its own CSS and `size="small"` stays centred, so no `isMobile` is passed. **MUI dialogs still on `MUI_LEGACY_FILES`:** add `fullScreen={isMobile}` on the `<Dialog>`. Collapse any multi-column `sx` flex/grid rows to one column on mobile (`flexDirection: isMobile ? "column" : "row"`, or a CSS media query). Small confirm sub-dialogs stay centered (don't fullScreen them).
- **Map-pick flows** (coord pick, area/bbox/extent select): App passes `collapseToPeek` to SidebarPanel so the sheet drops to peek and the map is reachable; dialog-initiated picks already hide their own dialog.
- **Heavy authoring tools** (GeoPDF, topo settings, CSV import) are desktop-first: `fullScreen` + `overflow-x` on dense grids + a "best on a larger screen" note, **not** full reflow.
- Use `100dvh` (not `100vh`) for full-height containers — mobile address-bar resize.

### Date-only values format with `timeZone: "UTC"`

Trip-log dates and date-typed custom fields are stored as UTC-midnight (the API does `new Date("YYYY-MM-DD")`, date-only). Any `new Date(iso).toLocaleDateString(...)` displaying one of these MUST pass `timeZone: "UTC"`, or AEST (UTC+10/+11) renders the previous calendar day (CH-001, 2026-06-22). This applies only to date-only values; true timestamps (`createdAt`, `*ResetAt`) display in local TZ correctly without it. Filter comparisons stay consistent because both sides parse as UTC midnight.