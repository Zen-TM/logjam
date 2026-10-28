# Frontend — Logjam Web

## UI

- **Before UI work, read `shared/DESIGN.md` then `DESIGN.md` here**: a page,
  panel, sheet, dialog, kit component, icon, colour or user-facing string.
- **No router:** navigation is `activePanel` (`components/sidebar/panels.ts`);
  a panel never imports from `Map.tsx`, it gets callbacks from `App.tsx`.

- **Browser floor: Safari 17, Chrome 114, Firefox 125** (the Popover API).
  Use no newer platform feature without raising it; raising it takes the ADR,
  `build.target` in `vite.config.ts` and `browser-check.js` together.
  [0042](../docs/decisions/0042-logjam-web-needs-the-popover-api.md)

## Data

- **Every user-data hook and boot effect takes the consent gate's `settled`**
  (`src/consent.ts`) as its `enabled` argument, never `authenticated`, or data
  loads behind the gate.
- **A date-only value** (stored UTC midnight) formats with `timeZone: "UTC"`.
- **Every sign-out path clears what the browser kept of a user's work:** the
  trip draft and the GeoPDF tile cache (`geoPdf/cache.ts`). The paths are
  `endSession` and the session-expired handler in `useAuth.ts`, and
  `RootErrorBoundary`; a new store of the kind joins all three. Guards:
  `useAuth.test.tsx`, `RootErrorBoundary.test.tsx`.

## Testing

- `npm test` (vitest, jsdom) and `npm run lint`.
- E2E: `npm run e2e` (Playwright, system Chrome). It starts Vite with fake auth
  but not the API; bring that up first.
- `e2e/a11y.spec.ts` is the per-surface a11y gate. A case never writes to the
  account: reach a state with a `page.route` stub that calls `route.fetch()`
  and rewrites only the field the decision reads.
- **Against prod, only unauthenticated runs:** assert the sign-in screen and
  nothing more, unless the maintainer signs off.
