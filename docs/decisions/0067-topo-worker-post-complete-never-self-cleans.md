# 0067. A topo worker never self-cleans after `complete`; the Dockerfile COPY list is derived

- **Date:** 2026-08-28
- **Status:** Accepted
- **Supersedes:** —

## Context

`push_send.py` was absent from the worker image's `COPY` list for a month;
before it, `email_send.py` (743b1a3). A missing module raises
`ModuleNotFoundError` *after* the terminal status flip, which used to take the
self-clean path and delete the finished job's S3 outputs. The 0-rowcount →
`delete_s3_prefix_best_effort` inference only means "reaped or deleted"
*before* the flip.

## Decision

- **The Dockerfile COPY list is derived, not remembered.**
  `tests/test_docker_image_files.py` walks the import graph from
  `worker.py`/`export_worker.py` (function-local imports included) and fails if
  any local module is missing a `COPY` line.
- **A post-`complete` exception must never self-clean.** `worker.py` `main()`
  sets `completed = True` immediately after the guarded `complete` flip; the
  except branch returns early when it is set. Guarded by
  `TestWorkerPostCompletionSelfClean` in `tests/test_status_guards.py`.

## Consequences

- **Positive:** Not recorded.
- **Negative:** Not recorded.
- **Neutral:** Not recorded.

## Alternatives considered

Not recorded.
