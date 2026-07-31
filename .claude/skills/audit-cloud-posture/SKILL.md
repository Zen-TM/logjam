---
name: audit-cloud-posture
description: Read-only security-posture audit of the LIVE prod AWS account (not the repo) — security groups, RDS/S3/CloudFront/WAF/IAM/KMS/Cognito/Secrets/EB config — via aws describe/list/get calls, cross-referenced to infra/terraform. Catches misconfigurations that only exist in the running account (open ports, unencrypted-at-rest, public buckets, EB-managed SG rules never in the repo) that the static-repo audits structurally cannot see. Use when the user asks to audit cloud/AWS/infra security posture, check for exposed resources, or runs /audit-cloud-posture. ID prefix CP.
---

# Cloud Posture Audit

Owns: **live-account misconfiguration** — "is a real prod resource exposed / unencrypted / over-permissioned right now." Distinct from `security` (app-code exploitability) and `architecture` (IaC topology *coherence/drift*): this audits the **running account state**, including resources that never appear in the repo (EB-managed SGs, console-created rules). Boundary priority: directly below `security`, above `privacy` (schema §5). ID prefix `CP`.

This audit reads the live account. It has **no repomix pack** (like `deps`) — the signal is the AWS API, not source files.

## READ-ONLY — hard rule

Use ONLY non-mutating calls: `aws sts get-caller-identity`, `aws <svc> describe-*`, `list-*`, `get-*`. **NEVER** run create / modify / delete / put / revoke / authorize / attach / detach / run / start / stop / reboot, or any verb that changes state. A posture audit observes; it never remediates. Remediation is the user's, via IaC, after the report.

## Account guard (run FIRST, fail loud)

```bash
aws sts get-caller-identity --profile logjam --region ap-southeast-2 \
  --query 'Account' --output text
```
- Must print `620853681701`. Any other account, or an auth error → **STOP**, tell the user to authenticate (`aws sso login --profile logjam` or fix the profile). Never audit the wrong account; never fall back to a different profile silently.
- Prod is `ap-southeast-2`; CloudFront + its WAF web ACLs are global/`us-east-1` (use `--region us-east-1` for `wafv2 ... --scope CLOUDFRONT` and the CloudFront-fronting ACLs).

## Roles — read which one you are FIRST

- **Standalone** (`/audit-cloud-posture`, you are the main agent): you are the **driver**. Do *Driver steps* — run the account guard, then spawn ONE worker subagent to run *Execution*, so the AWS-call volume stays out of your context.
- **Under `audit-all`** (you were already spawned as the worker subagent): **you cannot spawn another subagent.** There is no pack to wait for. Skip *Driver steps* — run the account guard yourself, then *Execution*.

## Driver steps (standalone only)

1. Read `.claude/skills/audit-shared/schema.md`.
2. Run the account guard above. If it fails, STOP per that section.
3. Spawn ONE subagent via the Agent tool — `subagent_type: general-purpose`, **no model override** (inherit the reasoning tier; posture exploitability/severity judgement is reasoning-heavy — do NOT downgrade to haiku). Hand it the schema path and the **Execution** section below. Tell it: read-only AWS only, write the report, do NOT spawn further subagents.
4. When it returns: report counts by severity + the path (don't restate every finding).

## Execution (the audit work — whoever runs it; do NOT spawn subagents)

Read `.claude/skills/audit-shared/schema.md` if you haven't (finding format §3, verify-before-write §4, boundary §5, continuity §6). Read the **root `CLAUDE.md` "AWS architecture" section** — it is the documented intended topology (two CloudFront dists, single-instance EB origin, RDS private, two S3 buckets, WORM audit bucket, on-demand Fargate workers). The audit is: **does the live account match that intent, with no excess exposure.**

Run the read-only calls (profile `logjam`), open the relevant `infra/terraform/envs/prod/*.tf` to cross-reference, and write `docs/audits/<DATE>/cloud-posture.md` in the shared schema, including the Continuity section vs the previous run's `cloud-posture.md` if one exists (§6).

**Verify-before-write (§4) for this aspect:** every finding cites the **actual AWS resource id** (sg-…, the db identifier, bucket name, policy ARN) and the describe-output field that proves it — not an inferred guess. Where the misconfiguration is *also* representable in Terraform, add the `infra/terraform/envs/prod/<file>.tf:<line>` so the fix lands in IaC; where the resource is **live-only / not in TF** (e.g. the EB-managed instance SG `awseb-…`), say so explicitly — that "exists in the account but not the repo" gap is itself a high-value observation (it is exactly why the static-repo audits miss it).

### Rubric

Check, with Logjam context (private canyoning app — coords/names must never be world-reachable; CloudFront is the only intended public ingress to the API):

- **Security-group ingress**: enumerate every SG (`ec2 describe-security-groups`). Flag any `0.0.0.0/0` / `::/0` on a non-public port. Data/admin ports open to the world (`5432` Postgres, `22`, `3389`, `6379`) = **critical**. The public API origin (EB instance SG, `:80`) must be restricted to the CloudFront origin-facing prefix list (`pl-b8a742d1`), not the world — a world-open origin is a WAF bypass (cross-ref `security` origin-verify SEC ids). The RDS SG (`sg-06cc0aaa310968aa4`, `:5432`) must source only the app/worker SGs, never a CIDR.
- **RDS** (`rds describe-db-instances`): `StorageEncrypted=true`; `PubliclyAccessible=false`; `BackupRetentionPeriod>0`; `DeletionProtection=true`; IAM auth on; TLS enforced (`rds.force_ssl` in the param group). Each false is its own finding, severity by exposure.
- **S3** (`s3api get-public-access-block` / `get-bucket-policy` / `get-bucket-encryption` / `get-bucket-versioning`): every bucket has all four public-access-block flags true; no bucket policy with `Principal:"*"` lacking a hard condition; default encryption on. `logjam-media` and the audit bucket must never be public. Audit/WORM bucket (`logjam-audit-…`): object-lock + versioning intact (cross-ref `architecture` if it's a topology/lifecycle issue, but a *publicly readable* audit bucket is CP-owned).
- **CloudFront** (`cloudfront get-distribution-config`): each distribution has a WAF web ACL associated; viewer min TLS ≥ `TLSv1.2_2021`; note `origin_protocol_policy = http-only` to the origin (plaintext CloudFront→origin) as a defence-in-depth gap (the SG-lock + origin-verify mitigate the bypass, but not on-path origin-leg interception — flag for origin TLS).
- **WAF** (`wafv2 get-web-acl --scope CLOUDFRONT --region us-east-1`): rate/managed rules are `block`, not `count` (a `count`-only rule enforces nothing); the ACL is actually associated with the distribution it's meant to protect.
- **IAM** (`iam list-policies` / `get-policy-version` / role trust): policies granting `Action:"*"` + `Resource:"*"` or `AdministratorAccess` to anything that isn't documented break-glass; the GitHub OIDC role trust scoped to `repo:Zen-TM/logjam:*` (not `*`); wildcards on sensitive actions; over-broad `gha_*` deploy grants (S3FullAccess etc. — cross-ref any prior SEC/CP finding).
- **Secrets Manager / KMS** (`secretsmanager list-secrets`, `kms describe-key`/`get-key-policy`): expected secrets present (`logjam/app-db-password`, `logjam/origin-verify`, `logjam/resend-api-key`, the RDS-managed master); no secret value retrievable by an over-broad policy; KMS key policies not world/`*`-principal.
- **Cognito** (`cognito-idp describe-user-pool`): password policy present; no unintended unauthenticated/implicit flows; advanced security mode if expected.
- **Public-exposure sweep**: any EC2 instance / ELB / RDS / bucket with a public address or policy that the documented topology does NOT call for. The intended public surface is exactly the two CloudFront distributions — anything else public is a finding.

Severity by **real exploitability × data sensitivity**: a world-open `:5432`, a public `logjam-media`, or an unencrypted RDS holding canyon coords is critical/high; a `count`-only WAF rule or http-only origin is medium defence-in-depth. Tag confidence. A finding whose exposure you cannot confirm from the describe output (e.g. "the SG is open but the resource may be private at another layer") goes under `## Defence-in-depth (unproven)` per §4, not the counts.
