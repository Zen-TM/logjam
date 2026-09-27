# 0022. A Logjam GPS build is supported until three months after its successor's release; SYNC_PROTOCOL keeps N−1 until then

- **Date:** 2026-09-28
- **Status:** Accepted
- **Supersedes:** —

## Context

A Logjam GPS build stays on a phone until its owner updates it, and the phone
may be offline for a whole trip first. The API has two levers over old builds,
and until now no rule for either:

- `MIN_MOBILE_VERSION` (`api/src/lib/env.ts`, a bare semver, default `0.0.0`,
  so off in prod) is served unauthenticated by `api/src/routes/meta.ts`. The
  build's gate (`mobile/src/useMinVersionGate.ts`) compares it with its own
  version, and `upgradeEnforcement` (`mobile/src/version.ts`) blocks only on a
  connection known to be unmetered and warns everywhere else. Nothing said
  when the minimum may rise.
- `SYNC_PROTOCOL` (`shared/src/sync.ts`) is `1`, and the server speaks only
  that: `/meta` lists `sync.protocols: [SYNC_PROTOCOL]`, `POST /sync/push`
  rejects any other `protocol` with a 400, `GET /sync/delta` resets a cursor
  from another version, and `mobile/src/sync/deltaPull.ts` throws on a
  response with a protocol it does not speak. Bumping the constant today is a
  hard cutover for every build in the field.

Nobody could see which builds were in the field either: `/sync/*` validated
the `x-logjam-client` header (`requireClientHeader` in
`api/src/routes/sync.ts`) and logged nothing, though a comment claimed it did.
It now logs a `sync_client` line per request with `client_platform` and
`client_version`, which `docs/operations/queries.md` aggregates. The API's
log group keeps 7 days (`api/.ebextensions/cloudwatch-logs.config`, the
figure `frontend/public/privacy.html` promises), so longer windows need a
metric, not logs.

## Decision

1. **Supported window.** A Logjam GPS build is supported until three months
   after the release of the next build: no change to the API may break a
   request it makes while it is supported. The newest build has no successor,
   so it is always supported. A release date is the date of the build's
   `mobile-vX.Y.Z` tag, or of its Play Store release for a build published
   before tags existed.
2. **`MIN_MOBILE_VERSION` bump.** The minimum may be raised to version V only
   when every build below V has been superseded for more than three months.
   Time alone decides; traffic does not. V is a released build. The change is a
   reviewed PR, never a console edit, and it states V, the release dates of
   the builds it cuts off, and their request counts from
   `docs/operations/queries.md`, so the cost of the bump is visible to the
   reviewer.
3. **`SYNC_PROTOCOL` bump.** Moving from N to N+1 ships a server that serves
   both: `/meta` lists both in `sync.protocols`, and `/sync/push` and
   `/sync/delta` answer each client in the protocol it speaks. Protocol N is
   removed only by the PR that raises `MIN_MOBILE_VERSION` past the last
   build that speaks it, under rule 2. A PR that bumps the protocol and drops
   N at once is forbidden, unless it deliberately retires the whole fleet and
   says so.

Guards: rules 1 to 3 have no executable check; they are checked in review of
the PR that bumps a lever. The first protocol bump adds a test that `/meta`
lists N and N−1 and that both push and delta accept each. The logging the
bump PR quotes is guarded by the `requireClientHeader logging` tests in
`api/src/routes/sync.unit.test.ts`, including that a rejected header is never
logged.

## Consequences

- **Positive:** a bump is a lookup of release dates, which needs no prod
  access, and every user gets three months with an update available before
  their build can be cut, however close together releases ship. Protocol N−1
  needs no second number: it lives exactly as long as the builds that speak
  it.
- **Negative:** time alone can cut off a build that is still in heavy use; the
  request counts are shown in the PR but do not stop it, and those users meet
  the upgrade screen (a warning on a metered connection, a block on an
  unmetered one). A slow release cadence keeps old builds supported
  longer: nothing can be cut until its successor has been out three months,
  so a breaking change waits on a release. During a protocol transition
  `api/src/routes/sync.ts` carries two code paths.
- **Neutral:** `GET /sync/delta` with an empty cursor carries no protocol,
  so the first protocol bump must add a way for the client to name it (a
  parameter, or the version in `x-logjam-client`). The 30- and 90-day counts
  need a CloudWatch metric filter on the `sync_client` line, not built yet;
  until then the PR quotes the 7-day counts. Feature-flag governance is left
  until a flag system exists.

## Alternatives considered

- **Three months from the build's own release:** the first version of this
  rule, rejected before merge. After a long gap between releases a build is
  already past three months when its update ships, so it could be cut the
  same day, leaving its users no time to update.
- **Three months from its own release and two newer releases:** rejected. It
  keeps the newest two builds supported, but two releases shipped close
  together can still cut a build a day after its first update existed.
- **A traffic threshold** (the builds with more than 1% or 5% of 30-day sync
  requests stay supported): rejected. The counts are requests, not people,
  so one phone that syncs often can hold a build up on its own, and a 30-day
  share needs the metric filter that does not exist yet. The counts still
  appear in the bump PR.
- **Time and traffic together** (cut a build only once it is past the
  window and below the threshold): rejected, as it keeps the traffic threshold's failure: one
  stale phone could hold the minimum down indefinitely.
- **Refusing below-minimum builds at `/sync/*`** with a 400, so the server
  enforces the minimum too: rejected. `upgradeEnforcement` deliberately lets
  a below-minimum build keep syncing on a metered connection; a 400 there
  would strand its unsynced edits on a phone in the field. The server logs
  such a request with `reason: "below_min"` and serves it.
- **Keeping API logs for 90 days** to answer the long windows from Logs
  Insights: rejected, as it breaks the 7-day retention promise in
  `frontend/public/privacy.html`.
- **A fixed transition period for protocol N−1:** rejected for a second
  number that could disagree with rule 2.
