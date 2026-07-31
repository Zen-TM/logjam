---
name: audit-deps
description: Token-efficient dependency and supply-chain audit of the Logjam codebase. Checks npm + Python deps for known vulnerabilities, outdated/abandoned packages, and license compatibility across frontend, api, shared, and topo. Runs npm audit / pip checks, uses a haiku subagent, writes docs/audits/<date>/deps.md. Use when the user asks to audit dependencies, supply chain, CVEs, vulnerable or outdated packages, dependency licenses, or run /audit-deps.
---

# Dependencies & Supply-Chain Audit

Owns: **dependency vulns, freshness, and license compatibility** (incl. legal license-compat, folded from legal). Lower boundary priority (shared §5) — an in-app exploit of a dep is security-owned; this report owns the dependency fact and cross-refs. ID prefix `DEP`.

**No repomix** — manifests + audit tools carry the signal (the one aspect where repomix adds nothing). The worker gathers its own signal (commands below); there is no shared pack.

## Roles — read which one you are FIRST

- **Standalone** (`/audit-deps`, you are the main agent): you are the **driver**. Do *Driver steps* — spawn ONE worker subagent to run *Execution*.
- **Under `audit-all`** (you were already spawned as the worker subagent): **you cannot spawn another subagent.** Run *Execution* yourself.

## Driver steps (standalone only)

1. Read `.claude/skills/audit-shared/schema.md`.
2. Spawn ONE subagent via the Agent tool — `subagent_type: general-purpose`, **`model: haiku`**. Hand it the schema path and the **Execution** section below. Tell it: gather the signal itself, write the report, do NOT spawn further subagents.
3. When it returns: report counts + path.

## Execution (the audit work — whoever runs it; do NOT spawn subagents)

Read `.claude/skills/audit-shared/schema.md` if you haven't (§3 format, §4 verify, §5 boundary, §6 continuity). Gather signal (run from repo root; capture output, don't fail if a tool is missing — note it):
```bash
for d in frontend api shared; do echo "== $d (all) =="; (cd $d && npm audit --json 2>/dev/null); echo "== $d (prod-only) =="; (cd $d && npm audit --omit=dev --json 2>/dev/null); echo "== $d (outdated) =="; (cd $d && npm outdated --json 2>/dev/null); done
ls topo/requirements*.txt topo/pyproject.toml 2>/dev/null
```
Capture BOTH the full and `--omit=dev` (prod-only) audit — the prod-vs-dev split is mandatory (rubric). For Python: read `topo/requirements*.txt` / `pyproject.toml` and flag pinned-old or known-risky GDAL/PDAL/numpy ranges (no network installs). Apply the rubric. Write `docs/audits/<DATE>/deps.md` (incl. Continuity vs the previous run if one exists).

### Rubric

- **Prod-vs-dev split (mandatory, report this FIRST)**: `npm audit --omit=dev` is the **primary** severity signal — runtime-reachable vulns. Dev/build-time-only advisories (vitest, CDK/Amplify build transitives, etc.) go in a separate clearly-labeled `### Dev/build-time only` subsection and are **capped at `low`** unless reachable against untrusted input in CI. Past runs rated dev-only vitest as `critical` — do not. State upfront whether prod (`--omit=dev`) is clean.
- **Known vulns**: map `npm audit` advisories to severity. Direct deps weighted higher than deep transitive. Note if a fix is a non-breaking bump vs a major. Do NOT inflate counts by listing each transitive hop separately — one finding per advisory, note the chain.
- **Outdated / abandoned**: majors behind, packages with no release in a long time, deprecated packages. Flag the ones that matter (security-relevant or core), not every patch.
- **License compatibility**: scan dependency licenses for copyleft (GPL/AGPL) or non-commercial terms that conflict with a private hosted app. Flag any AGPL in particular (network-use copyleft). Unknown/unlicensed deps = flag.
- **Lockfile integrity**: `package-lock.json` present and committed per package; no `file:` or git/url deps pulling unpinned code (note: `shared` is intentionally `file:../shared` — that's expected, not a finding).
- **Python**: GDAL/PDAL/numpy version pins — known-CVE versions, or unpinned ranges that risk supply-chain drift in the topo Docker image.

Each finding follows the schema §3 body — **What / Why / Fix / Confidence / Cross-ref** — but cites `package@version` in place of `file:line` (schema §3 deps exception). Don't drop the `Cross-ref` line (use `—` when none). Report concrete package@version → issue → fix (bump target). Ensure the header/Summary severity counts match the body (past runs contradicted themselves). Cross-ref security only when a vuln is actually reachable in app code.
