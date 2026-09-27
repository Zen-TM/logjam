# 0001. The API image connects to RDS over verified TLS using a bundled CA

- **Date:** 2026-06-11
- **Status:** Accepted
- **Supersedes:** —

## Context

node-postgres does NOT negotiate TLS by default (the pre-7 Prisma engine did) —
RDS rejects plain connections with `no pg_hba.conf entry ... no encryption`.
This broke prod on 2026-06-11.

## Decision

The Docker image bundles the RDS CA at `/app/rds-ca.pem` (Dockerfile ADD);
`services/prisma.ts` enables *verified* TLS whenever that file exists, and
stays plain on the dev host where it doesn't. `DATABASE_SSL_CA` overrides the
path (fails loud if missing). `DATABASE_SSL=disable` forces a plain connection
even when the CA is present — set only on local-dev worker task defs
(`infra/terraform/envs/local/ecs.tf`), which run the prod image (CA bundled)
against the local non-SSL Postgres. Don't remove either half.

## Consequences

- **Positive:** Not recorded.
- **Negative:** Not recorded.
- **Neutral:** Not recorded.

## Alternatives considered

Not recorded.
