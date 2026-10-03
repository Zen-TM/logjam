# Frontend — Logjam Web

## UI

- **Read `DESIGN.md` before building or reshaping a screen,** and compose the
  `src/ui` kit; a screen that needs something the kit lacks adds it to the kit.
  `components/sidebar/panels/PlacesPanel.tsx` is the reference page.
- **Every colour, space, size, radius, transition and text size is a custom
  property,** never a hex or px literal. The tokens are generated from
  `@logjam/shared` into `src/tokens.generated.css` (`npm run tokens`; never
  edit it); Logjam Web's own layout values are in `src/index.css`. A px literal
  is allowed only for a 1–2px border or offset, the 768px breakpoint, and an
  intrinsic size marked `/* intrinsic … */` (a 36×4 grab handle).
  `src/pxBudget.test.ts` holds the screens to a budget that only shrinks.
  CSS Modules only; no inline `style` except to set a custom property the kit
  reads.
- **A new foreground/background colour pair joins `scripts/wcag-contrast.mjs`**
  in the same change, measured on the surface it renders on; `KNOWN_FAILURES`
  only shrinks.
- **A page owns its layout:** hero and rails pinned, only its list scrolls;
  never nest a second scroll container.
- **One breakpoint, `max-width: 768px`:** `useIsMobile()` and every `@media`
  agree; CSS for layout, the hook only for behaviour. A narrow-screen branch
  changes the furniture, never what the thing is (`e2e/a11y.spec.ts`).
- **No router:** navigation is `activePanel` (`components/sidebar/panels.ts`);
  a panel never imports from `Map.tsx`, it gets callbacks from `App.tsx`.

## Errors

Never render a raw `err.message`. Pass a caught error through
`messageFromError(err, "Couldn't save place.")` (`src/errors/messageFromError.ts`)
and show it in one place: `ErrorBanner` for a failed dialog or form submit,
`FieldError` under a field, `useToast().error` for a background failure.

## Data

- **Every user-data hook and boot effect takes the consent gate's `settled`**
  (`src/consent.ts`) as its `enabled` argument, never `authenticated`, or data
  loads behind the gate.
- **A date-only value** (stored UTC midnight) formats with `timeZone: "UTC"`.

## Testing

- `npm test` (vitest, jsdom) and `npm run lint`.
- E2E: `npm run e2e` (Playwright, system Chrome). It starts Vite with fake auth
  but not the API; bring that up first.
- `e2e/a11y.spec.ts` is the per-surface a11y gate. A case never writes to the
  account: reach a state with a `page.route` stub that calls `route.fetch()`
  and rewrites only the field the decision reads. Fixtures are synthetic.
- **Against prod, only unauthenticated runs:** assert the sign-in screen and
  nothing more, unless the maintainer signs off.
