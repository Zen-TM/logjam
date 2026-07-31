---
name: fix-all
description: Sequentially fix every issue surfaced by a recent audit-all run. Owns its own remediation planning, creates a dedicated fix branch off the current branch, then runs one subagent per aspect in ownership-priority order — each subagent implements best-effort robust fixes, verifies, commits, and writes a "what was NOT implemented" report before handing back to the orchestrator. Use when the user asks to fix/remediate audit findings, "fix everything from the audit", apply the audit fixes, or runs /fix-all.
---

# Full Audit Fix Orchestrator

Sister skill to `audit-all`. Where `audit-all` fans out in **parallel** to find issues, `fix-all` runs **sequentially** to fix them — sequential because fixes mutate overlapping files and each aspect must see the previous aspect's committed work (no merge races, later aspects skip cross-ref'd issues already fixed upstream).

**fix-all owns planning.** The audit produces findings only; this skill derives the execution plan. It attempts **all severities** (critical → low). It commits after every aspect. It NEVER runs prod-targeted or irreversible commands — operator-gated work is reported, not executed.

## Inputs

- A completed audit run dir `docs/audits/<YYYY-MM-DD>/` containing `_index.md` + per-aspect `<aspect>.md` in the `audit-shared/schema.md` format.
- If the user names a run, use it. Else pick the **most recent dated dir** under `docs/audits/`. If none exists, STOP and tell the user to run `/audit-all` first. Fail loud — never invent findings.

## Steps

1. **Read the shared contract** `.claude/skills/audit-shared/schema.md` once (finding format, ID prefixes, boundary/ownership rule §5).
2. **Resolve the run dir** (above). Read `_index.md` and every `<aspect>.md`. Build the full finding inventory: `ID · severity · confidence · file:line · fix · cross-ref`.
3. **Plan** (fix-all owns this). Write `docs/audits/<run>/fix-plan.md`:
   - Group findings by owning aspect. Order aspects by ownership priority (schema §5): **security → cloud-posture → privacy → architecture → ux → code-health → deps**.
   - **cloud-posture fixes are IaC edits, never live mutation.** A CP finding's fix is a Terraform change (flip `storage_encrypted`, add a restrictive ingress rule, tighten an IAM policy) — its subagent edits `infra/terraform/**` and reports the `terraform apply` (plus any snapshot/restore/SG change) as **operator-gated** per step 5's never-run-prod rule. It MUST NOT run `aws` mutating calls or `terraform apply` itself. Many CP findings will be report-only (operator-gated) rather than committed code.
   - Collapse cross-refs: a finding that cross-refs a higher-priority owner is fixed **once** by the owner; list the lower-priority ID as "resolved-by <owner-ID>" so its aspect subagent skips it.
   - Within each aspect, order by severity (crit first), then by file (co-located fixes batched).
   - Flag **operator-gated** items up front (anything needing prod access, a migration apply, AWS/Terraform apply, secret rotation, a destructive/irreversible action, or a decision only the user can make). These are NOT auto-fixed — they go straight to the report as "needs operator action".
   - Note **low-confidence** findings: the subagent must re-verify against current source before fixing, and drop the finding (report it) if it no longer reproduces — never "fix" a false positive.
4. **Create the fix branch ONCE** off the current branch: `fix/audit-<run-date>` (e.g. `fix/audit-2026-06-21`). If it already exists, check it out and continue (resumable). Do NOT fix on `main`. Confirm the branch in the report.
5. **Run aspect subagents sequentially** — one Agent call per aspect, in the priority order from step 3. Wait for each to finish (and confirm its commit landed) before launching the next. For each:
   - `subagent_type: general-purpose`
   - `model`: inherit reasoning tier (no downgrade — fixing is higher-stakes than auditing; a wrong fix ships a bug). Deps version-bump-only work MAY use a cheaper tier.
   - `run_in_background: false` (sequential — the orchestrator drives the order).
   - Prompt: the **Subagent contract** below, with the run dir, the aspect, and that aspect's slice of `fix-plan.md`.
   - After it returns: verify a commit exists on the fix branch (`git log --oneline -1`); read the aspect's fix-report. If the subagent failed to commit, do NOT proceed — surface it and stop so the user can intervene (a half-applied uncommitted aspect must not be buried under the next one).
6. **Aggregate** → write `docs/audits/<run>/fix-summary.md`:
   - Table: aspect · findings attempted · fixed · deferred · needs-operator · commit SHA(s).
   - A consolidated **"Needs operator action"** list (every operator-gated / irreversible item across aspects, with the exact action).
   - A consolidated **"Not implemented"** list (every finding a subagent could not robustly fix, with the reason).
   - Link each aspect's `fix-reports/<aspect>-fix-report.md`.
7. **Report to user**: branch name, per-aspect fixed/deferred counts, the operator-action list, and the path to `fix-summary.md`. Do NOT open a PR or push unless the user asks.

## Subagent contract (hand to each aspect subagent)

```
You are fixing the <aspect> findings from the Logjam audit run docs/audits/<run>/.

Read first: docs/audits/<run>/<aspect>.md (your findings), the relevant slice of
docs/audits/<run>/fix-plan.md (your ordered worklist, with resolved-by / operator-gated
flags), .claude/skills/audit-shared/schema.md (finding format), and the root + relevant
sub-CLAUDE.md so your fixes match repo conventions and privacy rules.

You are on branch fix/audit-<date> — it is already checked out. Do NOT create or switch branches.

For each finding assigned to you (skip any marked resolved-by-<other-ID> or operator-gated):
1. Re-verify it against CURRENT source by opening the cited file:line. If it no longer
   reproduces (already fixed upstream, false positive, code changed), DROP it — record in
   the report under "Not implemented: <reason>". Never fabricate a fix for a non-issue.
2. Implement the most robust, best-effort fix — not a patch over a symptom. Prefer reusing
   existing utilities/types/patterns (search first; CLAUDE.md: duplicated code is a defect).
   Fail loudly, no silent fallbacks. Match surrounding code style.
3. Verify cheaply where possible: rebuild the touched package (`tsc -b` / `npm run build`;
   rebuild shared/ first if you touched it), run the nearest unit test, or run the
   privacy/security boundary test if you touched that surface. Record what you ran and the
   result. Do NOT start servers or hit live AWS/prod.
4. NEVER run prod-targeted or irreversible commands (prod migrations, terraform apply, AWS
   mutations, secret rotation, force-push, data deletion). If a fix requires one, do the
   safe code part only and route the operator step to the report.

When done with your aspect:
- Stage and commit your work with a conventional-commit message describing the fixed IDs,
  ending with the footer:
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  One commit per aspect is fine (or a few logically-grouped commits). Commit even partial
  progress so nothing is lost before handoff.
- Write docs/audits/<run>/fix-reports/<aspect>-fix-report.md:
  # <Aspect> Fix Report — <run date>
  Branch: fix/audit-<date>  ·  Commit(s): <sha ...>
  ## Fixed
  | ID | severity | what changed | files | verification |
  ## Not implemented
  | ID | severity | reason (false-positive / too-risky / needs-redesign / no-repro) | action needed |
  ## Needs operator action
  | ID | what only the operator can do (prod/migration/AWS/secret/decision) | exact command or step |
- Return to the orchestrator: counts (fixed / not-implemented / needs-operator) + commit SHA(s).
```

## Notes

- **Why sequential, not parallel:** fixes edit overlapping files; parallel writers conflict and a later aspect must build on the earlier aspect's committed state. The orchestrator enforces strict ordering and verifies each commit before the next launches.
- **Resumability:** the fix branch and per-aspect commits make a re-run idempotent — already-fixed findings drop out at the re-verify step, so `/fix-all` can be re-invoked after fixing a stuck aspect.
- **Boundary rule reuse:** the audit's cross-ref ownership (schema §5) is what lets fix-all fix a spanning issue once and skip its echoes — don't let two aspect subagents both edit the same root cause.
- **Scope guard:** fix-all fixes what the audit found. It does not hunt for new issues mid-fix. If a subagent trips over an unaudited bug while fixing, it notes it in the report rather than expanding scope.
