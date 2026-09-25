# Frontend — Logjam Web

React 19 + TypeScript + Vite SPA. MapLibre GL JS = core UI surface; most features = map interactions, sidebar panels, dialogs on top.

## React / TypeScript rules

- **Hooks pattern for API data:** `useState + useEffect + fetchCount + refetch`; return `{ data, loading, error, refetch }`. Match `placeUtils.ts`.
- **API calls:** always `apiFetch` / `apiFetchBlob` from `placeUtils.ts` (they inject auth + base URL). Never raw `fetch`.
- **Strict TS:** no `any` (use `unknown` + narrow), explicit return types on exported functions/hooks.
- **No new React contexts** without justification; local state + props is the default.
- **Co-locate** `Component.tsx` + `Component.module.css` and component-specific hooks/utils.
- **No router:** navigation is `activePanel: PanelId | null`; page ids and titles live in `components/sidebar/panels.ts`. Panels never import from `Map.tsx` — they get callbacks from `App.tsx`.

## UI

- **`frontend/DESIGN.md` and the `src/ui` kit govern all UI.** Compose the kit; a screen needing something it lacks adds it to the kit. MUI and Emotion are an ESLint error anywhere in `src` (`eslint.config.js`). `components/sidebar/panels/PlacesPanel.tsx` is the reference page.
- **A control's size is a token, never px:** `--control-lg` / `--control-md` / `--control-sm`, `--gutter`, `--font-*` (12px floor). Guard: `src/ui/controlSizes.test.ts`; see `DESIGN.md` §4.
- **A compact control grows its hit area, not its box** (the kit's `IconButton`, `Checkbox`, `Button compact`); only a dialog's footer buttons get a real 44px height. [0065](../docs/decisions/0065-compact-controls-grow-their-hit-area.md)
- **Every colour, radius, transition and text size is a custom property in `src/index.css`** — never a hex or px literal. CSS Modules only: screen modules do layout, the kit does look. **No inline `style` props**, except to set a custom property the kit reads (`--tile-hue`, `--chip-hue`).
- **Icons are lucide-react**, everywhere.
- **Every page owns its layout:** hero and rails pinned, only its list scrolls; never nest a second scroll container.
- **A `useIsMobile()` branch may change the furniture, never what the thing is:** the bottom sheet is the same named landmark as the desktop panel, and its grab bar is a keyboard `role="slider"` (`e2e/a11y.spec.ts`; `DESIGN.md`).
- **The Places type rail is the first chip rail and the attribute filters follow it** (`defsForType`). [0066](../docs/decisions/0066-place-type-rail-is-a-permanent-control.md)
- **Custom-field forms:** use `components/dialogs/AddCustomFieldForm.tsx` + `components/dialogs/CustomFieldInput.tsx`, never an inline re-implementation. A yes/no is a `ChipRail` of — / Yes / No; unset is `""` and saves nothing (`components/dialogs/CustomFieldInput.render.test.tsx`). A form writes only the fields it showed (root `AGENTS.md`, [0012](../docs/decisions/0012-custom-field-definitions.md)).
- **Media before the entity exists** (`TripLogDialog`): the first upload creates a draft row; Save PATCHes it, Cancel DELETEs it.
- **Tooltips** only when a label can't convey units, scale or consequence: the kit `Tooltip`; an `IconButton`'s `label` already is one.

## Error display

Three surfaces. One rule each. **Never render raw `err.message` from `apiFetch` or Amplify.**

| Surface | When | Import |
|---|---|---|
| `<ErrorBanner message={msg} onRetry? onDismiss?>` | Submission failure inside a dialog or panel form. One banner, above `DialogActions`. | `from "../feedback/ErrorBanner"` |
| `<FieldError message={msg \| null}>` | Per-field validation, directly under the input. Renders nothing when `null`. | `from "../feedback/FieldError"` |
| `useToast().error(msg)` | Background failures with no form to attach to (refetch, async panel actions). Auto-dismisses after 6 s. | `from "../feedback/ToastProvider"` |

- Pass every caught error through `messageFromError(err, "Couldn't do X.")` (`src/errors/messageFromError`); server `{ error }` text wins automatically. `console.error(err)` first.
- Specific beats generic ("Couldn't save place."); no status codes, paths or stacks in user text.
- A best-effort background op may `.catch(console.error)` with a `// Best-effort: <why>` comment.
- Every data hook returns `error: string | null`, already user-friendly.

## Behaviour rules

- **Consent:** `consentGate()` in `src/consent.ts` (`src/consent.test.ts`) is the one decision: `blocked` renders the gate, `settled` is the `enabled` argument every user-data hook and boot effect takes — never `authenticated`, or data loads behind the gate. Only `useAuth` and `useCurrentUser` stay on `authenticated`. Bumping `CURRENT_CONSENT_VERSION` is the whole client change; no per-feature consent prompts.
- **File inputs:** reset `<input type=file>` `.value` AFTER calling the handler — `input.files` is live.
- **Date-only values** (trip dates, date fields; stored UTC-midnight) format with `timeZone: "UTC"`; true timestamps use local time.
- **Responsive:** one breakpoint, `max-width: 768px`; `useIsMobile()` (`src/useIsMobile.ts`, `MOBILE_MAX_WIDTH_PX`) and every `@media (max-width: 768px)` must agree. CSS for layout, the hook only for behaviour CSS can't express. Use `100dvh`, not `100vh`.
- **Narrow-web z-index contract:** bottom sheet 4, backdrop 3, mobile NavRail 5 — the sheet's drag sweeps over the nav, so a lower nav traps the user in the panel.
- **Dialogs** use the kit `Dialog` (`DESIGN.md` §6): `size="large"` fills a narrow screen from its own CSS, `size="small"` stays centred — never pass `isMobile`. A multi-column grid inside collapses in that dialog's own `@media (max-width: 768px)` block.
- **Map-pick flows** pass `collapseToPeek` so the sheet drops to peek; dialog-initiated picks hide their own dialog.
- **Heavy authoring tools** (GeoPDF, topo settings, CSV import) are desktop-first, but a field whose `scrollWidth` exceeds its `clientWidth` gets a narrow-width rule (`GeoPdfDialog.module.css`; `DESIGN.md` §5).
- **CSP:** a new external host (tiles, API, image CDN) goes in `CSP_PROD` in `vite.config.ts` — use the **csp-hosts** skill.

## Testing

- Unit: `npm test` (vitest, jsdom); `npm run lint` gates too.
- E2E (Playwright, `playwright.config.ts`, specs in `e2e/`): `npm run e2e`, `npm run e2e:ui`. Uses system Chrome (`channel: "chrome"`); cross-browser needs the Playwright Docker image. Targets `E2E_BASE_URL` (default `http://localhost:5173`); the config starts Vite with `VITE_AUTH_MODE=fake` but not the API — bring that up first. The sign-in screen only renders on the second, non-fake server (`SIGN_IN_URL`, default `http://localhost:5199`).
- `e2e/a11y.spec.ts` is the per-surface a11y gate. A case never writes to the account; reach an unreachable state with a `page.route` stub that calls `route.fetch()` and rewrites only the field the decision reads. Fixtures in `e2e/__fixtures__/` are synthetic, never a real place.
- **Prod runs are unauth-only** (`E2E_BASE_URL=https://logjamnsw.com`): assert the sign-in screen, nothing more; a credentialed prod flow needs the maintainer's sign-off. The real-Cognito spec `e2e/auth-lifecycle.spec.ts` skips unless `E2E_AUTH_BASE_URL` + `E2E_TEST_EMAIL` + `E2E_TEST_PASSWORD` (a staging account) are set.
- `.mcp.json` registers `@playwright/mcp` so an agent can drive a live browser against local dev.
