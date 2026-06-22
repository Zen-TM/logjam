# Frontend — Logjam

React 19 + TypeScript + Vite SPA. MapLibre GL JS = core UI surface; most features = map interactions, sidebar panels, dialogs on top.

## Codebase nav

```
src/
  components/
    App.tsx               root layout + routing-like state; blocks behind ConsentGate when needsReconsent()
    SignIn.tsx
    ConsentGate.tsx       blocking re-consent screen (Agree / Sign out only)
    dialogs/              modal dialogs (GeoPDF, templates, etc.)
                          AddCustomFieldForm/CustomFieldInput = shared custom-field sub-forms used by CanyonDialog + TripLogDialog
    map/                  MapLibre layers, sources, overlays
    sidebar/              panels, nav rail
  consent.ts              CURRENT_CONSENT_VERSION + pure needsReconsent()
  csvImport/              trip-log CSV ingest (dialogStyles.tsx = source of truth for dialog select/field sx)
  styles/shared.module.css  reusable button/label/divider classes
  canyonUtils.ts          apiFetch, apiFetchBlob, hooks for canyons/trips
  useAuth.ts              Amplify Cognito auth hook
  themePreferences.tsx    sole React context (theme)
  theme.ts                MUI theme
  index.css               design tokens (CSS custom props)
```

**Canonical examples:**
- API hook pattern: `canyonUtils.ts` (search `useCanyons`, `useTripLogs`).
- Sidebar panel + button composition: any file under `components/sidebar/`.
- Map layer registration: `components/map/`.

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

### Design tokens (`src/index.css`)

| Token | Role |
|---|---|
| `--theme-primary` | Page, panel, dialog background |
| `--theme-secondary` | Cards, dropdown menus, NavRail active |
| `--theme-accent` | Primary actions, links, input borders |
| `--theme-warning` | Destructive actions |
| `--theme-text-primary` | Body text, inputs |
| `--theme-text-muted` | Labels, captions, secondary text |
| `--radius-sm/md/lg` | 4 / 8 / 12 px — use tokens, not px literals |
| `--transition-fast/med` | 0.15s / 0.2s |
| `--text-xs/sm/base` | 0.75em / 0.85em / 1em |

### Button system (`src/styles/shared.module.css`)

Compose: base `.btn` + one color variant + one size modifier.

**Color variants:** `.btnFilledAccent` · `.btnFilledNeutral` · `.btnOutlineAccent` · `.btnOutlineWarning` · `.btnOutlineBonus1` · `.btnGhost`
**Sizes:** `.btnSm` · `.btnMd` · `.btnFull`

**Never use MUI `<Button>` in sidebar panels** — compose CSS module classes instead.

### Other shared bits

- **`.sectionLabel`:** `0.7em · weight 600 · uppercase · letter-spacing 0.08em · opacity 0.45 · var(--theme-text-primary)`
- **`.divider`:** `border-top: 1px solid color-mix(in srgb, var(--theme-text-primary) 14%, transparent)`
- **Card/tile surfaces:** `bg rgba(255,255,255,0.04)` · `border rgba(255,255,255,0.08)` · hover `rgba(255,255,255,0.08)`

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

**Worked examples:**

```tsx
// Submission failure → ErrorBanner
} catch (err) {
  console.error(err);
  setError(messageFromError(err, "Couldn't save canyon. Please try again."));
}
// ...
{error && <ErrorBanner message={error} onRetry={handleSave} />}

// Per-field validation → FieldError
<input ... />
<FieldError message={nameError} />

// Background failure → toast
.catch((err) => { console.error(err); toast.error(messageFromError(err, "Couldn't load shares.")); })
```

## Security headers (CSP)

**Hybrid delivery** — custom CloudFront response headers policies are gated behind the AWS Business plan, so:

- **CSP** ships via `<meta http-equiv="Content-Security-Policy">` injected by the `cspMetaPlugin` in `vite.config.ts` at production build time. Source of truth: the `CSP_PROD` constant in `vite.config.ts`. Mirror in `scripts/csp-policy.json`.
- **HSTS / X-Frame-Options / X-Content-Type-Options / Referrer-Policy** ship via the AWS-managed `SecurityHeadersPolicy` attached to the frontend CloudFront distribution. Free, no Business plan required.
- **Dev server has no CSP** — Vite HMR uses inline scripts/eval which would be blocked.

**Adding a new host (tile provider, API, image CDN):**
1. Update `CSP_PROD` in `vite.config.ts` (both `img-src` and `connect-src` if it's a fetched-data host).
2. Mirror in `scripts/csp-policy.json`.
3. Rebuild + redeploy frontend.
4. Confirm browser console clean.

**Verification after deploy:** open DevTools console on production site, exercise main features. Any `Refused to ...` CSP violations indicate missing allowlist entries.

## E2E testing (Playwright)

`@playwright/test` lives here in `frontend/`. Config `playwright.config.ts`, specs in `e2e/`. Run: `npm run e2e` (headless), `npm run e2e:ui` (interactive).

- **Real-Cognito auth-lifecycle spec** (`e2e/auth-lifecycle.spec.ts`) covers sign-in → consent gate → session persistence against a real pool. Env-gated — skips unless `E2E_AUTH_BASE_URL` + `E2E_TEST_EMAIL` + `E2E_TEST_PASSWORD` (a confirmed **staging** account) are set. No committed creds (privacy rule). Sign-up/confirm + token refresh are operator extensions documented in the spec header.

- **Browser = system Google Chrome** via `channel: "chrome"`. Playwright's bundled chromium/firefox/webkit binaries are unsupported on the ubuntu 26.04 dev host (`does not support chromium on ubuntu26.04-x64`), so `npx playwright install` fails — don't rely on it. Chrome-only on host; use the Playwright Docker image for cross-browser. Playwright cannot drive system Firefox regardless (its "firefox" engine is a patched build, not the system install).
- **Target via `E2E_BASE_URL`** (default `http://localhost:5173`). Config auto-starts the Vite dev server with `VITE_AUTH_MODE=fake` for local runs only; it does NOT start api/infra — bring those up first (`make dev` + `cd api && npm run dev`). Local fake-auth boots straight into the map (no login).
- **Prod runs are unauth-only** (`E2E_BASE_URL=https://logjamnsw.com`): assert the sign-in screen renders, nothing more. Privacy rule — no committed credentials, no private user data exercised against prod. Don't add a credentialed prod login flow without explicit sign-off.
- **MCP:** `@playwright/mcp` (also `--browser chrome`) is registered in root `.mcp.json` so Claude can drive a live browser in-session. Lets Claude verify UI changes interactively against local dev or prod.

## Conventions log (additive)

### Dialog inputs/selects use shared sx — never inline

Every MUI `TextField`/`Select` in a dialog applies `fieldSx`/`selectSx`/`menuPaperProps` from `csvImport/dialogStyles.tsx` — never inline an `sx` that re-implements input/select colors, border, or menu paper. Spread extras on top (`sx={{ ...fieldSx, mb: 0.5 }}`). For a `<TextField select>`, the menu props nest one level deeper: `SelectProps={{ MenuProps: menuPaperProps }}` (a bare `<Select>` takes `MenuProps={menuPaperProps}`). Inline variants drifted (focused-label color, icon color, font size) across dialogs — UX-002/003 (2026-06-22), continuation of the 2026-06-10 UX-003.

### Custom-field forms in dialogs

Never re-implement the add-custom-field sub-form or per-field inputs inline — use `dialogs/AddCustomFieldForm.tsx` + `dialogs/CustomFieldInput.tsx`, which source `fieldSx`/`selectSx`/`menuPaperProps` from `csvImport/dialogStyles.tsx`. The two dialogs drifted visually when this was duplicated (UX-002/003). Unset boolean custom fields default to `false` via `dialogs/customFieldValues.ts` so the unchecked checkbox and the persisted value agree — don't reintroduce a `null` state in edit forms.

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