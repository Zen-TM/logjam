---
name: local-testing
description: Use when running or debugging something against the local dev stack or an Android device — make dev, make reset, the api integration suite, Playwright e2e, Metro and the dev client, especially when it fails in a way your change does not explain (500s in untouched tests, a stale result after editing shared/, a dev client that will not load). Not for unit tests, lint, production, or writing about the stack. Covers fresh-worktree gaps and symptom → cause → fix tables.
---

# Local testing

How each suite runs is in its package `AGENTS.md`. This skill is what goes
wrong when a local run misbehaves in a way the error does not explain.

- **A worktree has none of the gitignored files.** No `node_modules`: `npm ci`
  in each package you run, then `make shared`. No `.env.local`: copy it from
  the checkout that ran `make dev` (the API exits at boot on env validation
  without it). Mobile's extra files are listed in `mobile/AGENTS.md`.
- **Suspect the environment before your change** when failures land in code
  the change does not touch: find the symptom in the table for that area
  before editing anything.
- **A matching row is a lead, not a verdict.** Check its cause holds here
  before applying the fix: a symptom can have a cause no row lists.

| Running or debugging… | Read |
|---|---|
| the API, Logjam Web, the dev stack or the seed | [references/stack.md](references/stack.md) |
| Metro, the dev client, a phone or an emulator | [references/mobile.md](references/mobile.md) |

A new row is a failure an agent actually hit, that only some runs meet, and
that no script, test message or `AGENTS.md` line already explains. Its
symptom is the text someone would search for.
