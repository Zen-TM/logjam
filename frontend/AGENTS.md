# Frontend — Logjam Web

## UI

- **Read `DESIGN.md` before building or reshaping a screen,** and compose the
  `src/ui` kit; a screen that needs something the kit lacks adds it to the kit.
  `components/sidebar/panels/PlacesPanel.tsx` is the reference page.
- **Every colour, size, radius, transition and text size is a custom property
  in `src/index.css`,** never a hex or px literal. CSS Modules only; no inline
  `style` except to set a custom property the kit reads (`--tile-hue`).
- **A new foreground/background colour pair joins `scripts/wcag-contrast.mjs`**
  in the same change, measured on the surface it renders on; `KNOWN_FAILURES`
  only shrinks. Text on a colour fill uses `INK`. [0021](../docs/decisions/0021-design-system-and-contrast-gate.md)
- **A page owns its layout:** hero and rails pinned, only its list scrolls;
  never nest a second scroll container.
- **A `useIsMobile()` branch changes the furniture, never what the thing is:**
  the bottom sheet is the same named landmark as the desktop panel
  (`e2e/a11y.spec.ts`).
- **No router:** navigation is `activePanel: PanelId | null` (`components/sidebar/panels.ts`);
  a panel never imports from `Map.tsx`, it gets callbacks from `App.tsx`.
- **Custom-field inputs** are `components/dialogs/AddCustomFieldForm.tsx` and
  `CustomFieldInput.tsx`, never a re-implementation.
- **A tooltip** only when the label cannot convey units, scale or consequence.

## Errors

Never render a raw `err.message`. Pass a caught error through
`messageFromError(err, "Couldn't save place.")` (`src/errors/messageFromError.ts`)
and show it in one place: `ErrorBanner` for a failed dialog or form submit,
`FieldError` under a field, `useToast().error` for a background failure.

## Behaviour

- **Consent:** `consentGate()` (`src/consent.ts`) is the one decision. Every
  user-data hook and boot effect takes `settled` as its `enabled` argument,
  never `authenticated`, or data loads behind the gate; only `useAuth` and
  `useCurrentUser` stay on `authenticated`.
- **Date-only values** (stored UTC midnight) format with `timeZone: "UTC"`.
- **Reset a file input's `.value` after calling its handler:** `input.files` is live.
- **One breakpoint, `max-width: 768px`:** `useIsMobile()` (`MOBILE_MAX_WIDTH_PX`)
  and every `@media` agree; CSS for layout, the hook only for behaviour; `100dvh`.
- **Narrow-web z-index:** bottom sheet 4, backdrop 3, mobile NavRail 5. The
  sheet's drag sweeps over the nav, so a lower nav traps the user in the panel.
- **Dialogs** are the kit `Dialog` (`DESIGN.md` §6); never pass it `isMobile`.

## Testing

- `npm test` (vitest, jsdom) and `npm run lint`.
- E2E: `npm run e2e` (Playwright, system Chrome). It starts Vite with fake auth
  but not the API; bring that up first. The sign-in screen renders only on
  the second, non-fake server (`SIGN_IN_URL`).
- `e2e/a11y.spec.ts` is the per-surface a11y gate. A case never writes to the
  account: reach a state with a `page.route` stub that calls `route.fetch()`
  and rewrites only the field the decision reads. Fixtures are synthetic.
- **Against prod, only unauthenticated runs:** assert the sign-in screen and
  nothing more, unless the maintainer signs off.
