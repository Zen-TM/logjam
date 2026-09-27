# Shared — `@logjam/shared`

Pure TypeScript that `api`, `frontend` and `mobile` all import.

- **No React, Prisma, or Node- or DOM-only APIs:** it runs in all three.
- **A declaration here is the only copy.** A client builds from it and never
  re-lists its values; a client that needs something shaped differently
  derives it here, with a test.
- **Consumers import `shared/dist/`, not `src/`:** after editing, `make shared`
  (or `npm run build` here) before `api`, `frontend` or Metro see the change.
- **Tests:** `npm test` (vitest), colocated `*.test.ts`; canned inputs in
  `src/__fixtures__/`.
