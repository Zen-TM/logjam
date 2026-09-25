# 0014. Client compatibility mechanism

- **Date:** 2026-09-25
- **Status:** Accepted
- **Supersedes:** —

## Context

Mobile-to-API compatibility requires coordinating client versions, protocol revisions, and server version gates. The mechanism shipped across the codebase establishes how clients identify themselves, how minimum required versions are advertised, how sync protocol mismatches are handled, and how client-side upgrade enforcement behaves under differing network conditions.

This record documents the Mobile ↔ API compatibility mechanism as shipped, along with its known gaps. (The policy governing version bumps is left to a later ADR.)

## Decision

The compatibility mechanism consists of the following components as shipped:

| Piece | Location |
|---|---|
| `MIN_MOBILE_VERSION` env, bare-semver validated, default `0.0.0` (lever is off in prod) | `api/src/lib/env.ts` |
| Served unauthenticated (deliberate: a stale build must learn it's stale even with broken auth) | `api/src/routes/meta.ts`, plus `/meta` capability doc |
| `SYNC_PROTOCOL = 1`, checked both ways; mobile throws on mismatch | `shared/src/sync.ts`, `mobile/src/sync/deltaPull.ts` |
| Gate: checks on start, re-checks on foreground only while "unknown"; `ok` never re-gated, `upgradeRequired` terminal | `mobile/src/useMinVersionGate.ts` |
| Enforcement: block only on a definitely-unmetered connection, else warn; `metered: null` → warn; offline never blocks | `upgradeEnforcement`, `mobile/src/version.ts` |
| `x-logjam-client: mobile/<semver>` on every request; regex `^[a-z]+\/[0-9A-Za-z.\-+]+$` | `mobile/src/config.ts`, `mobile/src/api/apiFetch.ts` |
| `/sync/*` rejects a missing/malformed header with 400 | `requireClientHeader`, `api/src/routes/sync.ts` |

Known gaps in the shipped mechanism:
1. **The header is validated and never recorded.** Nothing in `api/src/middleware/` or `logger.ts` touches it, though a comment in `sync.ts` claims the version is logged. Fleet composition is unobservable, so `MIN_MOBILE_VERSION` can't be chosen safely.
2. **`CLIENT_SEMVER` is hand-kept in three places** — `mobile/src/config.ts:32`, `mobile/package.json:3`, `mobile/app.json:7` — no guard. Violates the repo's "two lists that must agree = one declaration + a test" rule, and fails silently: ship `0.2.0` with the header still saying `0.1.0` and the gate blocks everyone or nobody. `mobile/app.config.ts` exists and doesn't touch `version`.
3. **No written bump policy for `MIN_MOBILE_VERSION`; no `CHANGELOG.md`**.
4. **`runtimeVersion.policy: "appVersion"` in `mobile/app.json`** — OTA footgun.

## Consequences

- **Positive:** Not recorded.
- **Negative:** Not recorded.
- **Neutral:** Not recorded.

## Alternatives considered

Not recorded.
