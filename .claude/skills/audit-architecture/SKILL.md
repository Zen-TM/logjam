---
name: audit-architecture
description: Token-efficient architecture audit of the Logjam codebase. Examines data-model integrity (cascades, indexes, referential design), resource/job lifecycle (stuck-job reapers, retry drivers, AWS topology consistency), cross-store transactional boundaries, statefulness/scalability assumptions, layering/coupling, partial-failure boundaries, and doc/config drift vs CLAUDE.md. Uses a scoped repomix pack and a reasoning-tier subagent, writes docs/audits/<date>/architecture.md. Use when the user asks to audit architecture, system design, data model, schema/indexes, job lifecycle, scalability, coupling/layering, or run /audit-architecture.
---

# Architecture Audit

Owns: **structural / design correctness** — data-model integrity, resource lifecycle, cross-store atomicity, statefulness, layering, partial-failure boundaries, AWS-topology coherence. Boundary priority: below security/privacy, above ux/code-health (shared §5). Yields exploitability to security and policy-text to privacy; owns the structural facet and cross-refs. ID prefix `ARCH`.

## Roles — read which one you are FIRST

- **Standalone** (`/audit-architecture`, you are the main agent): you are the **driver**. Do *Driver steps* — pack, then spawn ONE worker subagent to run *Execution*.
- **Under `audit-all`** (you were already spawned as the worker subagent): **you cannot spawn another subagent.** The orchestrator already created `.audit-tmp/architecture.repomix.txt`. Skip *Driver steps* — run *Execution* yourself.

## Driver steps (standalone only)

1. Read `.claude/skills/audit-shared/schema.md`.
2. Verify repomix (`npx repomix --version`; fail loud if absent). Pack (below); assert the output exists and is non-empty.
3. Spawn ONE subagent via the Agent tool — `subagent_type: general-purpose`, **no model override** (inherit reasoning tier; architecture findings need real reasoning — do not downgrade to haiku). Hand it the pack path, the schema path, and the **Execution** section below. Tell it: write the report, do NOT spawn further subagents.
4. When it returns: report counts + path. Delete only `.audit-tmp/architecture.repomix.txt`.

Pack — backend + schema + worker + cross-package + AWS/deploy config + IaC + CI. Terraform IS the documented source of truth for prod topology (root CLAUDE.md), so it must be packed — but the `--ignore` is load-bearing: without it the pack pulls ~674 MB of vendored providers under `.terraform/` AND `*.tfstate` (which can contain secrets — never pack state). Schema/migrations read raw (compression strips SQL bodies); the worker opens `schema.prisma` + `migrations/**` + the `.tf` files directly:
```bash
npx repomix --include "api/src/**/*.ts,api/prisma/schema.prisma,api/prisma/migrations/**,api/Dockerrun.aws.json,api/CLAUDE.md,frontend/CLAUDE.md,topo/**/*.py,topo/CLAUDE.md,shared/src/**,CLAUDE.md,infra/terraform/envs/prod/*.tf,infra/terraform/envs/local/*.tf,infra/terraform/modules/**/*.tf,.github/workflows/**" --ignore "**/*.test.ts,**/*.unit.test.ts,**/dist/**,**/.terraform/**,**/*.tfstate,**/*.tfstate.backup,**/.terraform.lock.hcl" --compress --remove-empty-lines --output ".audit-tmp/architecture.repomix.txt" --style markdown
```

## Execution (the audit work — whoever runs it; do NOT spawn subagents)

Read `.claude/skills/audit-shared/schema.md` if you haven't (§3 format, §4 verify, §5 boundary, §6 continuity). Read the pack `.audit-tmp/architecture.repomix.txt` for the map, then **open real source/schema/migration/`.tf` files** for every line you report (§4). Apply the rubric. Write `docs/audits/<DATE>/architecture.md` (incl. Continuity vs the previous run if one exists). Under `audit-all`, delete nothing; standalone, the driver handles cleanup.

### Rubric

- **Data-model integrity**: FK `onDelete` semantics — does the schema rely on manual route-layer cascades that can drift (a parent delete forgetting a child → FK violation or orphan)? Missing `@@index` on hot FK / filter columns (Postgres does NOT auto-index FK scalars — check every `where`/join column against `CREATE INDEX` in migrations). Nullable/uniqueness constraints that don't match access patterns.
- **Referential integrity the DB can't enforce**: polymorphic FKs (type+id columns like `Media.linkedType`/`linkedId`), JSON-embedded foreign keys (`Notification.payload.canyonId`), and any orphan-cleanup logic that lives ONLY in application code. **Count the call sites** that must replicate the cleanup (media S3-purge is hand-rolled across `lib/bulkDelete.ts`, `routes/canyons.ts`, `routes/tripLogs.ts`, …) — each is a place a future delete path forgets and orphans rows/blobs.
- **Deployment & migration safety**: how/when migrations reach prod (boot-time `prisma migrate deploy` in `api/src/boot.ts` vs a gated step), what happens on migration failure (a boot-time deploy that `process.exit`s = full outage, not contained), and whether CI (`.github/workflows/**`) runs tests/lint/`migrate diff`-validate before producing the deploy artifact. An untested boot-time migration against prod RDS is an availability risk.
- **Resource / job lifecycle**: any async job (`TopoJob`, `TopoExportJob`, GeoPDF) — is there a driver out of `pending`/`processing` for failure modes the in-process `except` can't catch (task never placed, container SIGKILL/spot-reclaim/OOM)? Reaper / watchdog / max-age sweep present? Retry semantics actually have a mechanism, not just a status column. Attempt-count bounding.
- **Cross-store transactional boundaries**: DB (Postgres) + S3 + quota counters mutated across a delete/create — ordering and atomicity. DB-commit-then-best-effort-S3 leaves orphans and can't re-drive cleanup (keys already gone). Two separate commits (status + storage increment) with a crash window.
- **Statefulness / scalability**: in-memory state that assumes a single instance (rate-limit `MemoryStore`, in-process caches, sticky assumptions). Synchronous heavy work blocking the request thread / event loop (e.g. GeoPDF) inconsistent with the offloaded-worker model. Undocumented single-instance assumptions.
- **Layering / coupling**: cross-cutting concern copy-pasted across many files (owns this vs code-health's local dupes — shared §5); substantial business logic inline in route handlers where the repo's template keeps routes thin; cross-package imports bypassing `shared/`.
- **AWS-topology coherence**: does code match the documented topology (EB single container, ECS Fargate worker, no SQS, presign flows) **and the Terraform that defines it** (`infra/terraform/envs/prod/*.tf` — `ecs.tf`, `eb.tf`, `rds.tf`, `s3.tf`, `cloudfront.tf`, `audit.tf`, `db_app_role.tf`)? Sub-CLAUDE.md vs root vs actual `awsClients.ts` exports vs `.tf` — doc/config/IaC drift on load-bearing design intent. Flag code-or-infra committed-but-not-applied vs prod state (e.g. WORM `audit.tf` / least-priv `db_app_role.tf` — operator-gated, may not be live).
- **Cross-package `shared/` sync**: constants that must stay in lock-step across languages (`TOPO_LAYERS` canonical in `shared/`, mirrored in topo Python with a sync comment; `tests/test_layer_sync.py` guards drift) — verify code matches the canonical source, no silently-diverged copy.

Also include an `## Areas reviewed and found sound (no finding)` section so a reader knows what was checked and cleared. Verify by reading source/schema/migrations. Tag confidence. Cross-ref security (exploitability), privacy (policy text), code-health (mechanical), deps (versions) rather than restating.
