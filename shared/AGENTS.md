# Shared — `@logjam/shared`

Pure TypeScript used by `api`, `frontend` and `mobile`: types, validation, the
declarations both clients build from (place types, field scoping, topo layers,
design tokens), and the logic they must agree on.

- **What belongs here:** logic or a declaration that more than one package
  needs, or that two clients must compute identically. No React, no Prisma,
  no Node- or DOM-only APIs: it runs in all three.
- **Rebuild after editing:** consumers import `shared/dist/`, not `src/`.
  `make shared` (or `npm run build` here) before `api`/`frontend`/Metro see a
  change; `make dev`/`make reset` do it for you.
- **Tests:** `npm test` (vitest), colocated `*.test.ts`; small canned inputs go
  in `src/__fixtures__/`.
