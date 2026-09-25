# Logjam — root agent guide

Rules for every change in this repo. Each package (`api/`, `frontend/`,
`mobile/`, `shared/`, `topo/`) has an `AGENTS.md` with its own mechanics; the
`CLAUDE.md` beside each file is only `@AGENTS.md`. The reasoning behind a rule
lives in an ADR in `docs/decisions/`, linked from the rule.

## Context

Logjam = **private** mapping/logbook app for canyoning NSW. **Not** a publication platform. Privacy = design constraint, not feature.

> "Be mindful not to publicise 'new' canyons or routes, particularly those in wilderness areas, to preserve opportunities for discovery and to minimise environmental impacts." — NSW NPWS

**Privacy rules (enforce every new feature):**
- No public/unauth endpoints on user data.
- No analytics/telemetry leaving user account.
- No share/export defaults broadening visibility — sharing explicit, per-place, between auth'd users.
- Logs/errors must not contain place coords, names, tags or field values in plain text. A user-authored field LABEL is as sensitive as a note (`fieldValues`, `foreignFields`); guards: `api/src/lib/logger.unit.test.ts`, `mobile/src/sentry/scrubEvent.test.ts`.

**Shared rebuild rule:** `api`, `frontend` and `mobile` import `shared/dist/`, so after editing `shared/` run `make shared` before they see it (`make dev`/`make reset` do it for you). See `shared/AGENTS.md`.

## Environments — never confuse

| Env | Trigger | Auth | DB | AWS |
|---|---|---|---|---|
| **Local dev** | `make dev` + `.env.local` | `AUTH_MODE=fake`, seeded user (alice) | Local Postgres in docker | MiniStack via `AWS_ENDPOINT_URL` (S3 + ECS RunTask: workers run as real local containers) |
| **Prod** | deployed to AWS (EB runs API, ECS runs workers) | Cognito JWT | RDS | Real AWS, region `ap-southeast-2` |

**Hard rules:**
- **Prod safety:** never run a prod-targeted command without explicit confirmation from the maintainer.
- `AUTH_MODE=fake` throws if `NODE_ENV=production` (see `api/src/middleware/auth.ts`) — don't weaken.
- `api/.env` prod-style and gitignored; `.env.local` at root = dev file.

Prod topology (EB, ECS Fargate, S3, CloudFront, Cognito; IaC in `infra/terraform/`): `docs/architecture.md`.

## How we work

- **Branch from `origin/main`, never from the current checkout.** Use a worktree.
- **Issue-first** for non-trivial features, schema migrations and convention shifts; trivial fixes (typos, a small bug fix with its failing test, lint, docs) land directly.
- **Share the decision, not the drawing.** Logjam Web and Logjam GPS share declarations and parity tests, never generated UI. [0022](docs/decisions/0022-share-the-decision-not-the-drawing.md)
- **Setup-neutral:** committed files never describe a personal machine, mirror, alias or path. That belongs in `CLAUDE.local.md`, a `*.local` skill, or `.git/info/exclude`.
- **Docs voice:** human-facing docs are written for a reader new to the repo; one idea per paragraph; mermaid for flows and state machines, not for layouts. ADRs follow the `writing-adrs` skill.
- **Product names:** the web app is **Logjam Web**, the mobile app is **Logjam GPS**. Never bare "the app"/"the web app"/"on the web" in user copy where either surface could be meant.
- **README:** touch `README.md` (or a per-package README) only when user-facing setup changes: commands, env vars, install steps.

## Comments

> A comment earns its place by saying something the code cannot: why this, why
> not the obvious alternative, what broke last time. If renaming a variable
> would make the comment redundant, rename instead. No comment restates its
> line.

- No internal audit codes (`SEC-001`, `ARCH-001`, …); stripped in Phase 6.
- A critical invariant gets a test, not an essay, and the comment cites the test.

## Testing

Rules here; each package's `AGENTS.md` says how its suites run. CI (`.github/workflows/ci.yml`) gates every PR on unit suites, lint, typecheck, the `api` integration suite and migration jobs.

- A behaviour-changing PR touches a test or says why not. A bug fix starts with the failing test.
- **Privacy/security boundary tests are mandatory:** share-visibility filters, email omission, log redaction (`api/src/lib/logger.ts`), the error-detail whitelist (`api/src/middleware/errorHandler.ts`), auth fail-closed guards. A new endpoint touching shared places or user data gets a test that the boundary holds.
- A new guard test ships with a must-fail check: name the mutation that turns it red.
- **An invariant in `AGENTS.md` needs an executable check, or it is a comment.** **Two lists that must agree = one declaration + a test** that fails when something joins one and not the other. [0060](docs/decisions/0060-parallel-lists-and-invariants-need-a-test.md)
- **Don't unit-test** thin Prisma/AWS pass-through handlers (integration covers them), MapLibre rendering, GDAL/PDAL subprocess orchestration: extract the pure part and test that.
- A new format assertion on a request path is run against the seed and the fixtures, with a test (`api/src/lib/seedIds.unit.test.ts`). [0061](docs/decisions/0061-format-assertions-run-against-the-seed.md)
- Parser fixtures are the source's real output, committed under `__fixtures__/` beside the test. [0063](docs/decisions/0063-external-corpora-snapshot-and-real-fixtures.md)

## Conventions (self-updating)

On a user correction or a confirmed non-obvious pattern, **immediately ask** "Save this to AGENTS.md?" before continuing. A new entry is one line and cites its guard test; if it has no guard, or needs a paragraph of why, the reasoning goes to an ADR (`docs/decisions/0000-template.md`) and the line links it. End of turn: list other patterns noticed for batch confirm.

Additive only. Never silently delete existing conventions — flag stale entries for user review.

### Places, sharing, sync

- **Share visibility (hybrid):** a sharee sees the place record plus place-level `notes`/`media`; per-trip notes, media and the trip list are owner-private, and so is any count or aggregate over them. Every place endpoint decides through `api/src/lib/placeAccess.ts`; no access = **404**, a sharee attempting an owner-only action = 403. What a sharee receives is `serializeSharedPlace` over the denylist in `api/src/lib/placeVisibility.ts`, on REST and delta alike. Guards: `api/src/__tests__/shareBoundary.test.ts`, `api/src/lib/placeAccess.unit.test.ts`, `api/src/lib/placeVisibility.unit.test.ts`, `api/src/routes/placesList.unit.test.ts`. [0001](docs/decisions/0001-place-share-visibility.md)
- **`foreignFields`** has exactly two writers (copy, place-type change), is owner-private, and no client can push it. Guards: `api/src/routes/placeFields.unit.test.ts`, `api/src/__tests__/placeCopy.test.ts`. [0002](docs/decisions/0002-foreign-fields.md)
- **A `PlaceLink` grants no visibility**; `Route.placeId` is what carries a route to a sharee. Guard: `api/src/__tests__/placeLinks.test.ts`. [0003](docs/decisions/0003-place-links-grant-no-visibility.md)
- **Things you made sync, maps you downloaded stay on this device.** `CATEGORY_SYNCS` in `mobile/src/saved/savedKeys.ts` declares it; guard `mobile/src/saved/savedKeys.test.ts`. [0010](docs/decisions/0010-what-syncs.md)
- **A place's `PlaceType` owns its form, colour and icon.** System types come from `SYSTEM_PLACE_TYPES` (`shared/src/placeTypes.ts`): global rows, pinned ids, `ownerId = null`, undeletable and unrenameable (404), sorted first with an explicit `nulls: "first"`. Icons and colours come only from `PLACE_TYPE_ICON_KEYS` / `PLACE_TYPE_COLORS`. On the map, fill = type, ring = sharing. Guards: `api/src/__tests__/placeTypes.test.ts`, `mobile/src/places/placeTypeIcons.test.ts`, `frontend/src/placeTypeIcons.test.ts`. [0011](docs/decisions/0011-place-types-and-system-rows.md)
- **A system row has `ownerId: null` on the wire too:** a delta row spec must accept it. Guard: `api/src/__tests__/syncBoundary.test.ts`, which parses the live server's output. [0011](docs/decisions/0011-place-types-and-system-rows.md)
- **Custom field definitions are scoped rows; one rule builds every form.** Build place forms with `defsForType` and trip forms with `tripFieldDefs` (`shared/src/tripLogFields.ts`); read grades via `numericFieldValue`/`fieldValue`, never a column; `RESERVED_FIELD_KEYS` (may a user take this key) is not `CANYON_FORM_FIELD_KEYS` (has a bespoke control); a form writes only the fields it showed. Guards: `shared/src/tripLogFields.test.ts`, `shared/src/placeTypes.test.ts`, `api/src/__tests__/placeTypes.test.ts`. [0012](docs/decisions/0012-custom-field-definitions.md)
- **A cache that a fetch replaces replays the pending outbox ops over the response** (`pendingInboxOps`). [0039](docs/decisions/0039-inbox-edits-are-outbox-ops.md)

### Other

- **A total needs a declaration:** no aggregate sums a user field; show an average and a highest until a definition declares that it accumulates (`shared/src/logbookStats.ts`). [0013](docs/decisions/0013-totals-need-a-declaration.md)
- **Every new foreground/background colour pair joins `scripts/wcag-contrast.mjs` in the same change** (text 4.5:1, UI 3:1, all four schemes); `KNOWN_FAILURES` only shrinks. Text or a glyph on a colour fill uses `INK` (`shared/src/designTokens.ts`), not `primary`. [0021](docs/decisions/0021-design-system-and-contrast-gate.md)
- **Check what the platform actually samples before tuning what you do with it:** read the native module's rate, sensor types and gating first. [0041](docs/decisions/0041-compass-heading-pipeline.md)
- **Friend search and lists are username-only:** `/friends/search`, `/friends` and `/friends/requests` never return `email`. Guard: `api/src/__tests__/friends.test.ts`.
- **Topo export legality has one source:** `reconcileExportSelection` / `validateExportRequest` in `shared/src/topoExport.ts` (`shared/src/topoExport.test.ts`); new export surfaces call them.
- **Trip titles have one derivation:** `displayName ?? formatTripPlaceNames(...)` (`shared/src/tripName.ts`) `?? "Untitled trip"`; frontend via `tripTitle()` in `frontend/src/placeUtils.ts`. Never store a derived title; `displayName` stays null until the user edits it, except where a place delete backfills it on trips losing their last linked place.
- **Reaper-driven auto-queued jobs dedup via a status-guarded `*-At` claim column:** flip it null→now in one `updateMany` and act only when exactly one row flipped. See `queueAutoExports` in `api/src/lib/topoJobReaper.ts` (tested in `api/src/lib/topoJobReaper.unit.test.ts`).
- **Upstream or infra failures throw `AppError`, never a bare `Error`:** 502 upstream refused, 503 a dependency we own is missing. Guard: `api/src/services/ropeWikiCache.unit.test.ts`. [0062](docs/decisions/0062-upstream-failures-are-apperrors.md)
- **Slow-changing third-party corpora are an S3 snapshot** (`reference/` in the media bucket, `getRopeWikiCanyons`); the live fetch stays behind `?fresh=true`. [0063](docs/decisions/0063-external-corpora-snapshot-and-real-fixtures.md)

When in doubt on a Logjam-specific convention, ask before writing code.
