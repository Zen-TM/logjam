# 0062. An upstream or infra failure is thrown as an AppError whose status names the layer

- **Date:** 2026-08-30
- **Status:** Accepted
- **Supersedes:** —

## Context

A bare `Error` from a service renders as a generic 500. `errorHandler` only
echoes a real status/message for `AppError`; anything else becomes "Internal
server error". So an upstream or infra failure thrown as `new Error(...)`
reaches the user as an apparent app crash with nothing to act on — that is how
RopeWiki's Cloudflare 403 presented (2026-08-30): prod logged
`unhandled_error`, the client saw a 500, and the actual cause was a third party
blocking us.

## Decision

Throw `AppError` with a status that names the layer: 502 upstream refused, 503
a dependency we own is missing. Guard: `api/src/services/ropeWikiCache.unit.test.ts`
asserts the 502/503 statusCodes rather than just that it throws.

## Consequences

- **Positive:** Not recorded.
- **Negative:** Not recorded.
- **Neutral:** Not recorded.

## Alternatives considered

Not recorded.
