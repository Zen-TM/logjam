# Audit Shared Contract

All `audit-*` skills obey this. Read once at skill start.

## 0. Run directory (where output goes)

Every run writes into a **dated** dir: `docs/audits/<YYYY-MM-DD>/` (gitignored — local only). One file per aspect inside it: `docs/audits/<YYYY-MM-DD>/<aspect>.md`, plus the orchestrator's `_index.md`. A standalone `/audit-<aspect>` writes into today's dated dir, creating it if absent (it does NOT overwrite a sibling aspect). The prior run is the most-recent *other* dated dir — used for continuity (§6).

## 1. Repomix packing (token-bounded — do NOT pack the whole repo)

Each skill packs only its scoped subtree, compressed, to a temp file:

```bash
npx repomix --include "<comma,sep,globs>" --compress --remove-empty-lines \
  --output ".audit-tmp/<aspect>.repomix.txt" --style markdown
```

- If `npx repomix --version` fails → STOP, tell user to `npm i -g repomix`. Fail loud, no fallback.
- After packing, **assert the output file exists and is non-empty**. An empty/failed pack means a bad glob — fix it or STOP; never run a subagent against a missing pack (it will emit zero or hallucinated findings).
- `--compress` strips bodies to signatures (tree-sitter) — keeps structure, cuts tokens ~70%. Good for the first pass. Files whose *bodies* carry the signal (SQL migrations, HTML legal text, CSS rule bodies) must be opened raw by the subagent — each skill names these.
- The subagent reads the pack file for the map, then **opens real files** for any line it intends to report (see §4).
- **Cleanup ownership:** delete **only your own** `.audit-tmp/<aspect>.repomix.txt` at the end — NEVER `rm -rf .audit-tmp/` (the directory is shared; deleting it mid-sweep destroys packs other parallel subagents still need). When run under `audit-all`, the orchestrator owns directory cleanup exclusively and subagents delete nothing.

## 2. Model tier (passed as `model` on the Agent tool)

Pinned floors — do NOT silently run a reasoning aspect on a cheaper tier (run-to-run tier drift was the largest source of divergent results between past runs):

| Aspect | Model | Why |
|---|---|---|
| security, privacy, architecture, cloud-posture | **no `model` param → inherit the session's reasoning tier** (Opus / Sonnet / Fable-class). Never downgrade. | reasoning-heavy; cheap tiers produce confident-wrong findings |
| ux | `model: sonnet` | judgement but bounded |
| code-health, deps | `model: haiku` | mechanical scanning (haiku constraints in §4) |

The report header (§3) records the **actual** model used. If it differs from this table, the orchestrator/skill flags the mismatch in its final report so the reader knows reasoning depth varied.

## 3. Report output

- Path: `docs/audits/<YYYY-MM-DD>/<aspect>.md` (see §0). Overwrite on re-run of the same date. One file per aspect.
- **Do NOT emit `-plan.md` or `-unaddressed.md`.** Audit output is findings only; remediation planning is owned by the separate `fix-all` skill. (This was prior emergent drift — stop it.)
- Use this exact structure:

```markdown
# <Aspect> Audit — <YYYY-MM-DD>

Scope: <globs packed>  ·  Model: <actual model>  ·  Findings: N (C crit / H high / M med / L low)

## Summary
| ID | Severity | Confidence | Area | One-line |
|----|----------|------------|------|----------|
| SEC-001 | high | high | auth | ... |

## Findings

### <ASPECT>-001 · <severity> · `<file>:<line>`
**What:** <observed fact>
**Why it matters:** <impact>
**Fix:** <concrete change>
**Confidence:** high | med | low
**Cross-ref:** <other-ID, or —>

## Continuity (vs previous run)   ← see §6; omit only if no prior run exists

## Areas reviewed and found sound

## Defence-in-depth (unproven)   ← see §4; NOT counted in the severity totals above
```

- ID prefix per aspect: `SEC`, `CP`, `PRIV`, `ARCH`, `UX`, `CH`, `DEP`.
- Severity: `critical` / `high` / `medium` / `low`.
- **deps exception:** a `DEP` finding cites `package@version` instead of `file:line`, but MUST still carry **What / Why / Fix / Confidence / Cross-ref** (`Cross-ref: —` when none). No silent half-compliance.

## 4. Verify-before-write (mandatory)

- Every finding MUST cite a `file:line` the subagent actually opened and Read — not inferred from the compressed pack alone. **haiku aspects:** for any `high`-severity finding, paste the exact source snippet you Read as proof; a "no importer / dead code" claim requires a confirming `Grep` before it is reported.
- **Speculative / unproven findings do not get a severity number.** If a finding has no confirmable impact path ("no current exploit path proven", "depends on deployed behaviour I can't see"), put it under `## Defence-in-depth (unproven)` at Confidence: low — it is excluded from the severity counts in the header and Summary. Only confirmable, reproduced issues get an `ID` + severity.
- No praise, no "looks good" filler. Findings only. `## Areas reviewed and found sound` lists *what was checked and cleared* (one line each) so a reader knows the coverage — that is not praise.
- **Ban pure style nits as numbered findings.** Naming preferences, "console.error scattered", "consider a convention" with no concrete defect → collapse into a single `## Minor` note, not the Summary table.

## 5. Boundary rule (one owner per finding — kills cross-report duplicates)

Ownership priority: **security > cloud-posture > privacy > architecture > ux > code-health > deps**.

A finding that spans aspects belongs to the **highest-priority** owning aspect. Lower-priority reports must NOT restate it — they add a one-line `Cross-ref` pointer to the owning ID instead. Examples:
- A world-open `:5432` or a public `logjam-media` bucket in the LIVE account → `cloud-posture` owns (account misconfiguration). `architecture` cross-refs only if it's also IaC/topology drift; `privacy` cross-refs the data-sensitivity. **But:** an app-code exploit (authz bypass that reaches the same data) stays `security` — CP owns the *infrastructure exposure*, security owns the *application* path.
- `storage_encrypted = false` committed in `rds.tf` that *also* matches the live instance → `cloud-posture` owns (the live resource is unencrypted). If the `.tf` says `true` but the live instance is `false`, that committed-vs-applied drift is `architecture` (cross-ref CP).
- Leaked canyon coords in a log line → `security` owns (data exposure). privacy cross-refs.
- A dependency with a known CVE → `deps` owns. security cross-refs only if exploited in-app.
- Duplicated CSS that also breaks visual consistency → `ux` owns. code-health cross-refs.
- A cross-cutting concern duplicated across many files (e.g. user-resolution in every route) → `architecture` owns (layering/coupling). code-health cross-refs. Local mechanical copy-paste with no architectural angle stays `code-health`.
- A swallowed error inside a non-atomic cross-store delete → `code-health` owns the swallowed error; `architecture` owns the transactional-boundary design layered on top. Both may exist as separate findings, each cross-reffing the other.

## 6. Continuity (vs previous run — builds trust, catches silent regressions)

If a previous dated run dir exists (§0), the subagent reads the prior `<aspect>.md` and, in a `## Continuity (vs previous run)` section, marks **every** prior finding as one of:
- `fixed` — verified resolved in current source (cite the line proving it).
- `still-present` — re-confirmed; carries its current ID in this run.
- `not-re-examined` — out of this pack's scope this run (say why).

This makes the "issues fixed over time" signal visible and prevents a finding silently vanishing because a later run simply didn't look (the UX 15→4 disappearance happened this way). Never drop a prior finding without accounting for it here.
