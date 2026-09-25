# 0063. Slow-changing external corpora are held as an S3 snapshot; parser fixtures are the source's real output

- **Date:** 2026-08-30
- **Status:** Accepted
- **Supersedes:** —

## Context

An external data source can be withdrawn without notice. RopeWiki went behind
a Cloudflare managed challenge that 403s every non-browser client on every path
regardless of User-Agent (2026-08-30) — no header or retry fixes it, and their
own robots.txt still permits us, so the block is WAF config disagreeing with
stated policy.

The RopeWiki parser tests passed for months against synthetic CSV with
lowercase headers and clean cells, while the live export sends `PAGEID`,
`15r`, `229.659 ft` and HTML-wrapped ratings — none of that was covered, so a
header-casing regression would have shipped green.

## Decision

- Slow-changing third-party corpora are held as a hand-refreshed S3 snapshot
  (`reference/` in the media bucket, read by `getRopeWikiCanyons`), with the
  live fetch kept behind `?fresh=true` so re-enabling it is a default, not a
  rebuild.
- Parser fixtures are the source's real output, not a tidied version of it.
  Commit a few real rows under `__fixtures__/` and parse those too
  (`api/src/services/__fixtures__/ropewiki-nsw-sample.csv`).

## Consequences

- **Positive:** Not recorded.
- **Negative:** Not recorded.
- **Neutral:** Not recorded.

## Alternatives considered

Not recorded.
