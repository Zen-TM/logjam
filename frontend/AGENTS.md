# Frontend — Logjam Web

## UI

- **Before UI work, read `shared/DESIGN.md` then `DESIGN.md` here**: a page,
  panel, sheet, dialog, kit component, icon, colour or user-facing string.
- **No router:** navigation is `activePanel` (`components/sidebar/panels.ts`);
  a panel never imports from `Map.tsx`, it gets callbacks from `App.tsx`.

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
  and rewrites only the field the decision reads.
- `e2e/csv-import.spec.ts` is the one spec that writes to the account, and
  every case ends in Undo and touches no seeded place. Undo leaves sync
  tombstones, so re-seed before the next local integration run (it refuses to
  start on a DB that differs from the seed); CI runs this spec after it.
- **Against prod, only unauthenticated runs:** assert the sign-in screen and
  nothing more, unless the maintainer signs off.
