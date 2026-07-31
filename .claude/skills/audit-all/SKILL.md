---
name: audit-all
description: Run the full Logjam audit sweep — security, cloud-posture, privacy, architecture, ux, code-health, and deps — as parallel background subagents, then aggregate into docs/audits/<date>/_index.md. Token-efficient orchestrator over the individual audit-* skills. Use when the user asks for a full/complete codebase audit, "audit everything", an overall health/security review, or runs /audit-all.
---

# Full Audit Orchestrator

Runs all seven aspect audits in parallel and aggregates. Each aspect's rubric, scope, and model tier live in its own `audit-<aspect>/SKILL.md` — this skill orchestrates, it does not redefine them.

Two aspects have **no repomix pack** and gather their own signal: `deps` (npm/pip advisories) and `cloud-posture` (live read-only AWS describe/list/get calls against the prod account). The other five are repomix-packed.

## Steps

1. **Read** `.claude/skills/audit-shared/schema.md` once (shared contract). Note today's date `<DATE>` and create the run dir `docs/audits/<DATE>/`. Identify the previous run dir (most recent *other* dated dir) for continuity (schema §6).
2. **Verify repomix** (`npx repomix --version`). Fail loud if absent.
3. **Run each aspect's repomix pack** — the `npx repomix ... --output .audit-tmp/<aspect>.repomix.txt` command from each `audit-<aspect>/SKILL.md` (deps and cloud-posture skip repomix — no pack). Run them in parallel where the shell allows. **After each, assert the output file exists and is non-empty** (schema §1). If a pack fails or is empty, do NOT spawn that aspect's subagent — record it as failed and continue with the rest. For `cloud-posture`, run its **account guard** instead (`aws sts get-caller-identity --profile logjam` must return `620853681701`); if it fails (no creds / wrong account), record cloud-posture as failed and continue — do not spawn it.
4. **Launch 7 background subagents in parallel** (one fewer if an aspect failed its pack/guard in step 3) — one Agent call per aspect, each with:
   - `subagent_type: general-purpose`
   - `run_in_background: true`
   - `model` — exact mapping (do not re-open each SKILL to learn it; do not downgrade the reasoning four):
     - security, privacy, architecture, cloud-posture → **no `model` param** (inherit reasoning tier)
     - ux, code-health → `model: sonnet`
     - deps → `model: haiku`
   - prompt: "You ARE the worker subagent for the <aspect> audit — **do NOT spawn any further subagents** (you can't); do the work yourself. Read the **## Execution** section of `.claude/skills/audit-<aspect>/SKILL.md` and `.claude/skills/audit-shared/schema.md`. Skip that skill's *Driver steps* — the pack already exists at `.audit-tmp/<aspect>.repomix.txt` (deps and cloud-posture have no pack: gather the signal yourself per its Execution section — **cloud-posture uses read-only AWS calls only**, profile `logjam`, and must re-run its account guard first). Open real source files (or, for cloud-posture, cite the live AWS resource id + the `.tf` cross-ref) to confirm every finding (schema §4). Write `docs/audits/<DATE>/<aspect>.md` in the shared schema, including the Continuity section vs `docs/audits/<PREV>/<aspect>.md` if it exists (§6). Obey the boundary rule — do not restate findings owned by a higher-priority aspect; cross-ref by ID. **Do NOT delete `.audit-tmp/` or any pack file — the orchestrator owns cleanup.**"
5. **Wait** for all **seven** to finish (you're re-invoked as each completes).
6. **Resume any that failed:** if an aspect's `docs/audits/<DATE>/<aspect>.md` is missing or truncated (no `## Findings` section) — e.g. a subagent hit the session usage limit — re-spawn that one aspect (its pack still exists; subagents no longer delete the dir). Report which aspects needed a rerun.
7. **Aggregate** → write `docs/audits/<DATE>/_index.md`:
   ```markdown
   # Logjam Audit — <DATE>

   Models: <which aspects ran on which model; flag any that differ from schema §2>

   | Aspect | Crit | High | Med | Low | Report |
   |--------|------|------|-----|-----|--------|
   | Security | .. | .. | .. | .. | [security.md](security.md) |
   | Cloud posture | .. | .. | .. | .. | [cloud-posture.md](cloud-posture.md) |
   | Privacy  | .. | .. | .. | .. | [privacy.md](privacy.md) |
   | Architecture | .. | .. | .. | .. | [architecture.md](architecture.md) |
   | UX       | .. | .. | .. | .. | [ux.md](ux.md) |
   | Code health | .. | .. | .. | .. | [code-health.md](code-health.md) |
   | Deps     | .. | .. | .. | .. | [deps.md](deps.md) |

   (Counts exclude `Defence-in-depth (unproven)` items per schema §4.)

   ## Top priorities (all critical + high, across aspects)
   - <ID> · <severity> · <one-line> → <report>

   ## Cross-references
   - <ID> ↔ <ID> (same root issue, different lens)

   ## Continuity rollup
   - Fixed since last run: <IDs>. Still-present: <IDs>. Not-re-examined: <IDs>.

   ## Run notes
   - <reruns, failed packs, model mismatches, anything operationally noteworthy>

   ## How to use
   A new session reads this index, then drills into each aspect report. Each finding has file:line, fix, and confidence. Triage low-confidence findings first to discard false positives. To remediate, run `/fix-all` (it consumes this run dir).
   ```
8. **Clean up** — the orchestrator now deletes `.audit-tmp/` exclusively (subagents were told not to). `rm -rf .audit-tmp/`.
9. Report to user: per-aspect counts + path to `_index.md`. Note any aspect that failed/was rerun or ran on an off-spec model, so it can be re-run via its own `/audit-<aspect>`.

## Notes
- Boundary rule (schema §5) is what prevents the same issue appearing in 3 reports. Enforce it in aggregation: if two reports describe the same root cause, the lower-priority one should already be a cross-ref; if not, fix it during aggregation.
- Continuity (schema §6) is enforced per-subagent, but the index rolls it up so a reader sees fixed-vs-still-present at a glance — a finding must never silently disappear between runs.
- Cost: this launches 7 subagents. For a cheaper run, the user can invoke a single `/audit-<aspect>` instead.
- `cloud-posture` is the only aspect that touches the **live AWS account** (read-only). It needs valid `logjam` credentials in the session; with none, its account guard fails and the orchestrator records it failed (the other six are unaffected — they're repo-static).
