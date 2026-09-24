# CLAUDE.md — Logjam Root

Guidance for Claude Code in this repo. Sub-CLAUDE.md in `frontend/`, `api/`, `mobile/`, `topo/` cover stack rules.

## Context

Logjam = **private** mapping/logbook app for canyoning NSW. **Not** publication platform. Privacy = design constraint, not feature.

> "Be mindful not to publicise 'new' canyons or routes, particularly those in wilderness areas, to preserve opportunities for discovery and to minimise environmental impacts." — NSW NPWS

**Privacy rules (enforce every new feature):**
- No public/unauth endpoints on user data.
- No analytics/telemetry leaving user account.
- No share/export defaults broadening visibility — sharing explicit, per-place, between auth'd users.
- Logs/errors must not contain place coords, names, tags or field values in plain text. A user-authored field LABEL is as sensitive as a note (`fieldValues`, `foreignFields`); guards: `api/src/lib/logger.unit.test.ts`, `mobile/src/sentry/scrubEvent.test.ts`.

**Shared rebuild rule:** after editing `shared/`, run `cd shared && npm run build` (or `make shared`) before `api`/`frontend` pick up changes. Both depend via `file:../shared` and import from `shared/dist/`. `make dev` and `make reset` invoke `make shared` automatically; manual rebuild is only needed when editing `shared/` while app dev servers are already running.

## Environments — never confuse

| Env | Trigger | Auth | DB | AWS |
|---|---|---|---|---|
| **Local dev** | `make dev` + `.env.local` | `AUTH_MODE=fake`, seeded user (alice) | Local Postgres in docker | MiniStack via `AWS_ENDPOINT_URL` (S3 + ECS RunTask: workers run as real local containers) |
| **Prod** | deployed to AWS (EB runs API, ECS runs workers) | Cognito JWT | RDS | Real AWS, profile `logjam`, region `ap-southeast-2` |

**Hard rules:**
- Never run prod-targeted commands without explicit user confirmation.
- `AUTH_MODE=fake` throws if `NODE_ENV=production` (see `api/src/middleware/auth.ts`) — don't weaken.
- `api/.env` prod-style and gitignored; `.env.local` at root = dev file.

## AWS architecture

Prod runs on Elastic Beanstalk (API) + ECS Fargate (workers) + S3 + CloudFront + Cognito, IaC'd in `infra/terraform/`. All AWS CLI calls use `--profile logjam --region ap-southeast-2`. Full topology, task-def/bucket/distribution details, and CLI one-liners: the **aws-architecture** skill.

## Conventions (self-updating)

On user correction or non-obvious pattern confirmation, **immediately ask** "Save this to CLAUDE.md?" before continuing. If approved, append below with one-line rationale. End-of-turn: list other patterns noticed for batch confirm.

Additive only. Never silently delete existing conventions — flag stale entries for user review.

- **Two lists that must agree = one declaration + a test.** Schema vs migration, tables vs wipe, entities vs update targets. Every hand-kept parallel list in `mobile/` had drifted by the 2026-08-13 audit, one of them fatally (`ADDED_COLUMNS` vs `CREATE TABLE` killed delta sync on every fresh install). Derive the second list from the first, and add the test that fails when something joins one and not the other.
- **Check what the platform is actually sampling before tuning what you do with it.** Three rounds of filter work on the mobile compass (2026-08-17) went into compensating for a sensor stream that had no gyroscope in it — `expo-location` fuses bare accelerometer + magnetometer at a hardcoded `SENSOR_DELAY_NORMAL`, so it reported a genuinely *backwards* bearing at the start of a turn and no filter could have removed it. The constants got better each round and the fault was upstream of all of them. Read the native module's source for sample rate, sensor types and gating before treating the signal as given; `mobile/CLAUDE.md`'s Battery section carries the specifics.

- **An invariant in a CLAUDE.md needs an executable check, or it is a comment.** Same audit: `networkPolicy.ts`'s header stated the rule its own code broke; three more documented rules had silently-diverging code. When you write a rule down, write the test too, and cite it in the entry.

- **Place share visibility (hybrid model):** `PlaceShare` recipients see the place record including place-level `notes` and place-level `media`. Per-trip `notes`, per-trip `media`, and the trip log list are owner-private. Single source of the access decision: `api/src/lib/placeAccess.ts` (`getPlaceRole` / `requirePlaceAccess` / `requirePlaceOwnerAccess` / `requirePlaceOwner`) — used by `api/src/routes/places.ts` (GET/PATCH/DELETE `/:id`, POST `/:id/copy`), `api/src/routes/sharing.ts` (POST `/:id/share`, GET `/:id/shares`), and `api/src/routes/tripLogs.ts` (GET `/`, GET `/:id`). Any new endpoint on shared places must derive its decision from these helpers, not inline owner/share checks. Guard: `api/src/__tests__/shareBoundary.test.ts` (the regression from the recipient side), `api/src/lib/placeAccess.unit.test.ts`.
  - **404-not-403 anti-oracle:** no-access (`role === "none"`) on a place resource returns **404**, never 403, so the status can't confirm a place ID exists to someone who can't see it. Owner-only actions a *sharee* attempts return **403** (they legitimately see the place, just lack the permission). `requirePlaceAccess` (read) and `requirePlaceOwnerAccess` (owner-only mutations) bake this in, and every place-id surface routes through them — the two that did not (media attach, bulk CSV merge target) were closed by `024f410` on 2026-07-04.
  - **Owner-private extends to derived cardinality, not just the rows.** A count/aggregate of owner-private data (trip tally, share fan-out) is itself owner-private — withholding the trip *list* while shipping its `_count` is not a boundary. A sharee-reachable payload must not carry `_count`/sum/exists over owner-private relations; scope it to the owned response (see `placeListInclude` in `api/src/routes/places.ts`, `api/src/routes/placesList.unit.test.ts`). A test that asserts the *list* is withheld will pass while its count leaks — assert the aggregate's absence too.
  - **What a sharee may see is a DENYLIST plus a completeness guard, not a hand-kept `select`.** `OWNER_PRIVATE_PLACE_FIELDS` / `SHAREE_VISIBLE_PLACE_FIELDS` in `api/src/lib/placeVisibility.ts` name every column and why; `serializeSharedPlace` is the one filter and BOTH the REST and the delta path go through it — the delta path once stripped by name only, so `importKey` and `importBatchId` leaked while `foreignFields` did not. The guard (`placeVisibility.unit.test.ts`) parses `model Place` out of `schema.prisma`, so a new column fails the build until someone decides which side it is on. That is the point: an allowlist drifts silently when a column is added, a denylist drifts loudly.
- **What syncs has ONE rule, and it is stated in the UI: things you made sync, maps you downloaded stay on this device.** Places, routes, imports and recorded tracks belong to the account; offline regions, LiDAR topo overlays and GeoPDFs are map material obtained elsewhere and stay on the handset. It splits the Saved tab's six categories 3/3 with no exception to explain, which is why it can be said in one sentence. (Seven and 4/3 until the places rework: markers were their own Saved category, and folding them into places took the category with them — a shared place surfaces on the Places screen under its type's tab, not in Saved.) The user meets it TWICE and in two registers: a small green cloud on each Saved row that is actually in the account (`theme.success`, per item, derived from `pendingCreateIds` rather than from the category — the category says what SHOULD be there, the outbox says what is), and the sentence itself in Settings → Offline and storage. Mark the positive, never the absence: an earlier "This device" pill on every region and GeoPDF spent a whole pill saying something reassuring in the language of a warning, on the rows least at risk, while the rows a user actually worries about said nothing. The rule does NOT belong at the top of Saved — that is the most valuable space on the tab, for a sentence read once. The declaration is `CATEGORY_SYNCS` in `mobile/src/saved/savedKeys.ts` (RN-free, so it is testable) and NOT `SavedScreen`'s `CATEGORY_META`; a new Saved category cannot be added without answering the question, because the `Record<SavedCategory, boolean>` refuses the omission. Guard: `mobile/src/saved/savedKeys.test.ts` pins the actual split rather than only its completeness — so a change there fails until the hero copy that states the rule moves with it. Before this, the boundary was decided piecemeal and invisible: a GPX linked to a place synced while the same file imported on its own did not, and routes synced while imports did not.
- **A place has a TYPE, and the type owns the form, the colour and the icon.** `Canyon` and `Waypoint` are one `Place` (2026-09-06 rework); what used to be two entities with two forms is one entity whose `PlaceType` says which questions it asks. Three SYSTEM types (Canyon, Campsite, Marker) are GLOBAL rows with pinned ids and `ownerId = null` — one row shared by every account, which is what lets a shared or copied place of a system type resolve for its recipient with no reconciliation at all — and a user may add their own. `SYSTEM_PLACE_TYPES` in `shared/src/placeTypes.ts` is the declaration; the seed reads it rather than restating it, and the ids are pinned UUIDv4s (`api/src/lib/seedIds.unit.test.ts`).
  - **A system type is undeletable and unrenameable, and the API answers 404 rather than 403** — the same anti-oracle every id-addressed surface uses. RopeWiki import writes reserved field keys into the Canyon type, so a deletable Canyon type would let import write values nothing can render. Guard: `api/src/__tests__/placeTypes.test.ts`.
  - **System types sort FIRST, and that needs saying out loud in SQL.** A system type's `ownerId` is NULL and Postgres sorts NULLS LAST on a plain `ASC`, so `GET /place-types` returned the built-ins at the BOTTOM while its own docstring promised the opposite — both clients build their leftmost tab and their default type from this order. `orderBy: [{ ownerId: { sort: "asc", nulls: "first" } }, …]`; guard: `placeTypes.test.ts`, "returns the system types before the caller's own". SQLite sorts NULLs FIRST by default, so the phone's mirror query spells the same order explicitly rather than relying on either engine (`listMirrorPlaceTypes`).
  - **Icon and colour come from CURATED lists** (`PLACE_TYPE_ICON_KEYS`, `PLACE_TYPE_COLORS`), not free text, for two hard reasons: an icon key resolves in one client's icon set and not the other's (mobile draws Feather, web draws lucide — guards: `mobile/src/places/placeTypeIcons.test.ts`, `frontend/src/placeTypeIcons.test.ts`, one per side of the same list), and a map marker colour has a WCAG 3:1 guarantee that can only be asserted over a closed set (`scripts/wcag-contrast.mjs` checks every palette entry under every theme scheme). A free hex picker would not fail that check — it would DELETE it.
  - **On the map, FILL is the type and the RING is sharing.** Colour used to encode ownership and cannot any more, because it now says which kind of place this is. See `mobile/src/map/PlacePinsLayer.tsx`.
- **A custom field DEFINITION is a row with a scope, and one rule builds every form.** Definitions live in `custom_field_defs` (they used to be an array on `User.uiPreferences`), and each carries its types — `placeTypeIds` for a place definition, `tripTypes` (free-text tags, matched case-insensitively) for a trip definition — plus an `appliesToAllTypes` FLAG — a flag rather than join rows for every type that exists today, because rows would silently fail to apply to a type created tomorrow and the user who ticked "All" would never find out (`api/src/__tests__/placeTypes.test.ts`, §7.4). `defsForType` (`shared/src/tripLogFields.ts`) is the one rule both clients build a place form from, so a phone and a browser cannot disagree about which fields a campsite has.
  - **The seven canyon grades are ordinary field values now** (`fieldValues`, keyed by RESERVED keys the system definitions own). A user field that would collide with one is refused with a suggestion, on create AND on rename (`placeTypes.test.ts`, §7.6). Anything reading a grade goes through `numericFieldValue`/`fieldValue`, never a column.
  - **"Reserved" and "already drawn by another control" are DIFFERENT SETS, and
    conflating them deletes fields.** `RESERVED_FIELD_KEYS` answers "may a user
    take this key" and covers every system definition — including the campsite's
    `capacity` and `is a cave?`. Both clients cut reserved keys out of their
    generic field list on the grounds that the canyon UI renders them, which
    silently removed those two from the create form and the filter sheet: they
    are system fields that nothing draws specially. `CANYON_FORM_FIELD_KEYS`
    (derived from the canyon scoping, pinned by `shared/src/placeTypes.test.ts`)
    is the set with bespoke controls. Found by running the app, not by a test.
  - **A TRIP's form is `tripFieldDefs(defs, the trip's own TYPES, stored values, edited keys)` — and the two union clauses are what stop it eating data.** (Changed 2026-09-13: it used to be scoped by the types of the places the trip links. A trip is often logged with no place at all, and its tags are what say what the user was doing, so a trip definition carries `tripTypes` and a place definition `placeTypeIds` — the API refuses a write that fills the other.) Render the definitions scoped to the trip's tags (case-insensitively), UNION any key already stored, UNION any key typed into since the form opened. Both clients save exactly the fields shown, so without the stored half untagging a trip or rescoping a definition drops a recorded answer, and without the edited half ticking a tag, filling in its attribute and unticking it again drops an unsaved one. Keyed on EDITED, not on "has a value now", or backspacing to empty unmounts the field under the cursor. Guard: `shared/src/tripLogFields.test.ts`, "tripFieldDefs". The phone holds both halves as ONE kept-keys set and lists kept-only fields under "Leftover attributes", each with a remove button — clearing is no way out for every kind of field, and nothing else said which ones were leftovers. A YES/NO is three states (— / Yes / No) on both mobile forms: a switch wrote `false` for every toggle shown, which left a No nobody gave on every trip the attribute was ever shown on, kept after untagging and counted as answered by the stats (`mobile/src/customFields/fieldValueCoercion.test.ts`). Logjam Web still draws a checkbox and writes that `false` until its rework. The canyoning tag that decides which of these a canyon trip is asked is force-added only for a linked CANYON (`linksCanyon`, `shared/src/tripName.ts`) — it used to be any place, which tagged a night at a campsite. The same rule in miniature applies to a place form: write only the fields the form SHOWED, over the stored object — iterating every definition wrote a null for the ones scoped to other types, and a null removes the key.
- **A SYSTEM row belongs to no account, on the wire as well as in the database.**
  Both kinds — the three place types and the nine field definitions — carry
  `ownerId: null`, and the delta row spec must say so: `ownerId: isString` on the
  definition spec dropped all nine off every page a phone pulled, so grades
  arrived on places with no definition to label or bound them and `defsForType`
  answered "no fields" for a canyon. Every parser test on both sides built its
  rows by hand and saw nothing. Ground truth lives in
  `api/src/__tests__/syncBoundary.test.ts`, which parses what the LIVE server
  sends through the shared specs — the guard for this whole class, not just this
  field.

- **`foreignFields` is the park for a value whose definition the recipient does not have, and it has exactly two writers.** A copied place carries values keyed by the SENDER's definitions; they land in `Place.foreignFields` as `[{key,label,type,min,max,value}]`, rendered read-only in their own section with three per-item actions (adopt as a field of my type / append to notes / discard). Copy and place-type-change are the only writers — never a user edit, and it is absent from the `PLACE_FIELDS` push allowlist so a client cannot write one (guards: `api/src/routes/placeFields.unit.test.ts`, `api/src/__tests__/placeCopy.test.ts`, §7.13). It is OWNER-PRIVATE and never appears on a delta row where `syncRole === "shared"`; a sharee gets `fieldDefsSnapshot` instead, derived live from the OWNER's current definitions. Without that rule the design inherits the propagation objection that killed dumping the values into notes: B copies A's place, shares it with C, and C reads A's field labels.
- **A `PlaceLink` grants NO visibility.** It is symmetric, stored once under the canonical (low id, high id) pair, and owner-private — which is why `where: { ownerId }` IS the both-endpoints-are-visible filter, and why the 219-line visibility-diffing module the old canyon↔waypoint join needed could be deleted outright. A route still reaches a sharee through `Route.placeId`, which is a FOREIGN KEY and a different thing. Guard: `api/src/__tests__/placeLinks.test.ts` (a sharee's link list is empty, §7.3, and the create→link→flush→delta round trip, §7.18).

- **Friend search and lists are username-only:** `/friends/search`, `/friends`, and `/friends/requests` never return `email`. Drop `email` from any `select` on user joins in the friends routes.
- **Topo export legality has one source:** `reconcileExportSelection` / `validateExportRequest` in `shared/src/topoExport.ts`. New export surfaces (dialogs, auto-export, reaper) call these — never re-derive format/bundling/layer rules.
- **Trip titles have one derivation:** `displayName` (user override) `?? formatTripPlaceNames(linked place names, join-position order)` (`shared/src/tripName.ts`) `?? "Untitled trip"` — frontend via `tripTitle()` in `frontend/src/placeUtils.ts`. Never inline the name join or store a derived title; `displayName` stays null until the user edits it (the only exception: place-delete paths backfill `displayName` on trips losing their last linked place, so they keep a label).
- **Reaper-driven auto-queued jobs dedup via a status-guarded `*-At` claim column:** flip the marker (e.g. `TopoJob.autoExportedAt`) null→now in one `updateMany` and only act when it flips exactly one row, so overlapping sweeps / multiple API instances can't double-queue. See `queueAutoExports` in `api/src/lib/topoJobReaper.ts`.
- **A cache that a fetch REPLACES must replay the pending local ops over the response.** The mobile inbox is refetch-and-cache rather than delta-synced, so `GET /notifications` is the authority on every field it returns — and a fetch that ignored the outbox silently undid whatever the user had just done offline: a row marked read went back to unread, a deleted one came back on the next pull-to-refresh. `pendingInboxOps` (`mobile/src/sync/notificationsCache.ts`) applies the queue over the response before it is written. Any future "just refetch it" store needs the same replay, or the queue and the screen disagree until the flush.
- **A new format assertion on a request path must be run against the seed and the fixtures, with a test.** `parsePushOp` (`api/src/routes/sync.ts`) tightened entity ids to strict UUIDv4; `api/prisma/seed.ts` kept hand-minting version-nibble-0 ids, so NO seeded place could sync ANY edit from mobile (found 2026-08-21) — invisibly, because the local mirror still updated, the UI looked correct, and only the outbox row held the 400. The seed is the one input nobody re-reads after writing it, and an envelope-level 400 makes the field being edited irrelevant, so the fault presents as a bug in whatever feature you just built. Seeded ids now come from `seedId()` in `api/prisma/seedIds.ts`; guard is `api/src/lib/seedIds.unit.test.ts`.
- **Product names:** the web app is **Logjam Web**, the mobile app is **Logjam GPS**. Never bare "the app"/"the web app"/"on the web" in user copy where either surface could be meant.
- **A bare `Error` from a service renders as a generic 500.** `errorHandler` only echoes a real status/message for `AppError`; anything else becomes "Internal server error". So an upstream or infra failure thrown as `new Error(...)` reaches the user as an apparent app crash with nothing to act on — that is how RopeWiki's Cloudflare 403 presented (2026-08-30): prod logged `unhandled_error`, the client saw a 500, and the actual cause was a third party blocking us. Throw `AppError` with a status that names the layer: 502 upstream refused, 503 a dependency we own is missing. Guard: `api/src/services/ropeWikiCache.unit.test.ts` asserts the 502/503 statusCodes rather than just that it throws.
- **Parser fixtures are the source's real output, not a tidied version of it.** The RopeWiki parser tests passed for months against synthetic CSV with lowercase headers and clean cells, while the live export sends `PAGEID`, `15r`, `229.659 ft` and HTML-wrapped ratings — none of that was covered, so a header-casing regression would have shipped green. Commit a few real rows under `__fixtures__/` and parse those too (`api/src/services/__fixtures__/ropewiki-nsw-sample.csv`).
- **An external data source can be withdrawn without notice.** RopeWiki went behind a Cloudflare managed challenge that 403s every non-browser client on every path regardless of User-Agent (2026-08-30) — no header or retry fixes it, and their own robots.txt still permits us, so the block is WAF config disagreeing with stated policy. Slow-changing third-party corpora are held as a hand-refreshed S3 snapshot (`reference/` in the media bucket, read by `getRopeWikiCanyons`), with the live fetch kept behind `?fresh=true` so re-enabling it is a default, not a rebuild.

- **A TOTAL needs a declaration, not a heuristic.** An aggregate screen can
  read a number's SHAPE — bounded on both sides with a small span is a rating,
  open-ended is a quantity (`shared/src/logbookStats.ts`) — but no property of a
  definition says whether a quantity ACCUMULATES. `min`/`max` don't, and neither
  does which entity it hangs off: summing a place attribute over trips produced
  "1996 longest pitch" and "48 capacity", and the obvious correction (a trip's
  own answers are the ones it spends) produced "1530 rope length" one commit
  later. Both directions shipped and both were wrong. Until a definition carries
  an explicit "adds up each trip" flag, an average and a highest are the honest
  pair — they are never wrong for either kind. The same rule in miniature:
  a tally over ONE distinct value is a constant, not a distribution.

- **A colour pair is measured under all FOUR schemes before it ships, never
  judged by eye in one.** Every screenshot anyone looks at is Sandstone, and a
  pair that reads fine there can fail badly elsewhere: the phone's hero puts
  `textMuted` on `bonus2` (3.94:1 in Sandstone) and `textPrimary` on `bonus2`
  (2.43:1 in Ironbark, where `bonus2` is a LIGHT green), and it shipped that way
  (found 2026-09-13 while designing Logjam Web). A new foreground/background
  pair — a surface, a tint, a label on a fill — joins `scripts/wcag-contrast.mjs`
  (text 4.5:1, UI 3:1) in the same change. CI runs it (`shared` job). A pair
  that fails today and ships anyway goes in its `KNOWN_FAILURES` with where it
  renders — the list can only shrink, because a known failure that starts
  passing fails the run. The two hero pairs above are on it; the GeoPDF and
  waypoint hues failed 3:1 as glyphs on Sandstone and were lifted rather than
  listed.
- **Text or a glyph ON a colour fill uses a dark ink, not the scheme's
  `primary`.** `primary` as the label clears 4.5:1 on the accent and on the
  light place-type palette, which is why it looked like a rule; on the reserved
  shared heath `#B79EC0` it is 3.7:1 (Sandstone) and on the GeoPDF asset hue
  2.7:1. The phone's active "Shared" rail chip was that failing pair. The one
  fixed ink is `INK` in `shared/src/designTokens.ts` (Logjam GPS `Chip`; Logjam
  Web `--ink`), and `scripts/wcag-contrast.mjs` measures it on every fill.

## Testing

Integration suites (`api` `npm test`, topo Docker runbooks) are **NOT** in CI — run them locally before committing changes they cover. Everything else (unit suites, lint, typecheck) gates PRs via `.github/workflows/ci.yml`.

### How to run

| Suite | Command | Needs |
|---|---|---|
| `shared` unit | `cd shared && npm test` (vitest) | nothing |
| `api` unit | `cd api && npm run test:unit` (vitest, `*.unit.test.ts`, Prisma/AWS mocked) | nothing — no server/DB |
| `api` integration | `cd api && npm test` (vitest, `src/__tests__/`) | running local API (`make dev` first) |
| `frontend` unit | `cd frontend && npm test` (vitest, jsdom) | nothing |
| `topo` unit | `cd topo && python -m unittest discover -s tests` | host runs pure logic; GDAL/PDAL paths skip on host, run in worker Docker image |

Two kinds of `api` test, kept separate: `*.unit.test.ts` (colocated with source, no infra) vs `src/__tests__/*.test.ts` (integration, hits live API). `npm run test:unit` must pass with **no** `make dev` running — if it needs a server, it's misfiled.

**Multi-user integration tests:** fake auth honors an `x-fake-sub` request header (dev only; impossible outside `AUTH_MODE=fake` because it lives inside that branch, guarded fail-closed at module load in `api/src/middleware/auth.ts`) so one test process can act as any seeded user per request. Use the helper `api/src/__tests__/_actors.ts` — `as(BOB_SUB)` / `as(CAROL_SUB)` spread onto a supertest `.set(...)`; no header = alice (unchanged). The seed (alice/bob/carol with friendships + shares) supports sharee/stranger-perspective tests — see `src/__tests__/shareBoundary.test.ts` (the SEC-001 regression from the recipient side, which mocked-Prisma unit tests can't reach). Note: the integration suite hits the in-process `globalLimiter` (300 req/**60s, keyed per-IP** — it mounts before `requireAuth`, so `userOrIpKey` always falls back to IP and all actors share ONE budget; "per-user" only applies to authed keying it never reaches). The suite runs files sequentially (`fileParallelism: false`) and `__tests__/_rateLimitGate.ts` sleeps to the window reset when `RateLimit-Remaining` runs low, so back-to-back runs self-throttle instead of 429ing.

**Committed fixtures convention:** small canned inputs live in a `__fixtures__/` dir beside their test (e.g. `api/src/services/__fixtures__/sample.mvt` for the vector-tile decode test, regenerable by hand-encoding via `pbf`). Use this for fixture-based parser/decoder tests instead of inlining large blobs.

`topo` pure-logic tests import `tests/_native_stub.py` first, which stubs `osgeo`/`psycopg2`/etc when absent (dev host) so they run in CI; inside Docker the real libs import and the stub is a no-op. A test that exercises a real native lib must skip when stubbed (see `tests/test_tile_compose.py` for GDAL; `tests/test_status_guard_db.py` for the real-Postgres ARCH-001 resurrection invariant, gated on `RUN_DB_IT=1` + real `psycopg2`). Cross-language constant drift is guarded by `tests/test_layer_sync.py` (TS `TOPO_LAYERS` ↔ Python `ALL_LAYERS`). Heavier worker integration runbooks: `topo/tests/INTEGRATION.md`. Real-Cognito auth-lifecycle E2E: `frontend/e2e/auth-lifecycle.spec.ts` (env-gated on a staging pool).

### What to test when adding code

- **Privacy/security boundaries are mandatory** (see privacy rules above): share-visibility filters, email-omission, log redaction (`api/src/lib/logger.ts`), error-detail whitelist (`api/src/middleware/errorHandler.ts`), auth fail-closed guards. A new endpoint touching shared places or user data deserves a test that the boundary holds.
- **Don't unit-test:** thin Prisma/AWS pass-through route handlers (covered by integration tests), MapLibre/MUI rendering, GDAL/PDAL subprocess orchestration. When logic is tangled with Prisma/AWS/MapLibre, extract the pure part and test that.
- Mock Prisma via `vi.mock("../services/prisma")`, AWS via the `@aws-sdk/*` module; never hit a real service in a unit test.

## README updates

Touch `README.md` only when user-facing setup changes (commands, env vars, install steps). Skip internal refactors. Per-subdir READMEs (`topo/README.md`) follow same rule.

When in doubt on a Logjam-specific convention, ask before writing code.