# Architecture decision records

An ADR keeps the reasoning for a choice someone could later undo without
knowing why. One file per decision, `NNNN-kebab-title.md`, in the order they
were made. Whether a change earns one: root `AGENTS.md` → Decisions.

This page is how to write one, supersede one and keep one current. The
[index](#index) is at the end.

## Writing an ADR

Start from [`0000-template.md`](0000-template.md). An ADR ships in the same PR
as the change it explains, so a reviewer reads the reasoning beside the diff.
Merging that PR accepts it.

### Number, title, status

- **Number:** the highest in this directory plus one. Never reuse or fill a
  number. If another branch takes the same number first, renumber yours when
  you rebase, and fix every link to it.
- **Title and filename:** the title states the decision, so the index reads
  as a list of rules: "A PlaceLink grants no visibility", not "Place links".
  The filename is `NNNN-` plus a short kebab-case form of the title.
- **Date:** the day the decision was made.
- **Status:** `Accepted`. Merging the PR accepts it, so `Draft` is not used.

### The sections

Whoever finds this ADR later is changing code and searches this directory for
the paths and symbols involved. Name them in the ADR, or it is never found.

- **Context:** what forced the choice: the constraint or the failure, with
  the paths, symbols, dates and incident that pin it down. Leave out how the
  bug was found and anything that belongs under Alternatives. Keep history
  only when it stops someone repeating it.
- **Decision:** a rule that a later change could break and a reviewer could
  check. A description of the feature or an account of the fix is not a
  decision. Name the guard test that enforces it. If there is none, say so.
- **Consequences:** always name the cost. A choice between real alternatives
  gives something up, usually what the rejected option had going for it. Also
  name the work it leaves for later: 0009's key must be backed up, and
  rotating it needs a new build.
- **Alternatives considered:** each option that was really rejected and why.
  The first to list is the obvious one the next contributor would reach for.
  If you know an option was built and then removed, say so, so it is not
  built again.

Never write "Not recorded" in a new ADR, and never invent an alternative or a
consequence to fill a section. If you cannot name a real rejected option, the
change probably fails the first Decisions criterion in root `AGENTS.md`: stop
and say so rather than write the ADR. The template's "Not recorded" is only
for backfilling a decision made long ago, whose date comes from `git log`.

### Index and links

- Add a row to the [index](#index): number, title as in the H1, date, status.
- If most sessions in a directory must follow the rule, it also gets one line
  in that directory's `AGENTS.md`, linking the ADR. If a guard test fails
  loudly on the mistake, put the pointer in its assertion message instead.
  Before adding either, read
  [`.agents/skills/authoring-skills/references/agents-md.md`](../../.agents/skills/authoring-skills/references/agents-md.md).

## When a decision changes: supersede it

An accepted ADR's decision is never edited to say something else.

1. Write a new ADR that states the whole current decision, so a reader never
   has to merge two files. Set its `Supersedes` to the old one, and say in
   Context what changed.
2. In the old ADR, change only the status line, to `Superseded by [NNNN](…)`.
   Update its index row to match.
3. Search for every citation of the old number or file
   (`git grep -n -e 'decisions/NNNN' -e '\[NNNN\]'`), in `AGENTS.md` lines,
   comments and guard-test messages, and point each one at the new ADR.

## While a decision stands: keep it current

An accepted ADR changes in three ways only:

- **A moved path or renamed symbol** is corrected in place, unmarked, in the
  change that moved it: this directory is found by searching for the paths a
  change touches. Guard: `shared/src/adrReferences.test.ts`.
- **A stale fact or figure** is corrected in place and marked
  "(updated YYYY-MM-DD)".
- **A narrow exception, or a reason that no longer holds,** is a bullet under
  Decision, `**Update YYYY-MM-DD: <what changes>.**`, that says what still
  holds the decision up and ends "Everything else above stands". For an
  exception, list the option you rejected under Alternatives. When no reason
  is left holding the decision up, supersede it.

Leave the title, status and index row alone. If the change would alter what
the decision chooses, or a reader would need both texts to know the rule,
supersede instead.

## Index

| # | Decision | Date | Status |
|---|---|---|---|
| [0001](0001-rds-tls-via-bundled-ca.md) | The API image connects to RDS over verified TLS using a bundled CA | 2026-06-11 | Accepted |
| [0002](0002-place-share-visibility.md) | Place share visibility | 2026-07-04 | Accepted |
| [0003](0003-pre-deploy-migrations-expand-contract.md) | Prod migrations run in a gated pre-deploy task; migrations are expand/contract | 2026-07-17 | Accepted |
| [0004](0004-mobile-sentry-and-scrubber.md) | Mobile crash reporting: Sentry behind a scrubber and a consent gate | 2026-07-23 | Accepted |
| [0005](0005-offline-region-downloads.md) | Offline region downloads: one queue, the file is the checkpoint | 2026-07-30 | Accepted |
| [0006](0006-on-device-data-privacy.md) | On-device data privacy: app lock off by default, declared stores, one wipe path | 2026-08-04 | Accepted |
| [0007](0007-guest-mode-is-dont-sync-yet.md) | Guest mode is "don't sync yet", not a separate storage path | 2026-08-05 | Accepted |
| [0008](0008-geopdf-import-by-file-uri.md) | GeoPDF import takes a file URI, never bytes | 2026-08-10 | Accepted |
| [0009](0009-signed-ota-updates.md) | OTA updates are code-signed, with the private key outside the repo | 2026-08-16 | Accepted |
| [0010](0010-map-sensors-only-while-focused.md) | Map sensors run only while the map is focused and foregrounded; the heading lives outside React state | 2026-08-17 | Accepted |
| [0011](0011-compass-heading-pipeline.md) | Compass heading: gyro-fused source, one camera writer, a rate-tracking display | 2026-08-17 | Accepted |
| [0012](0012-declination-and-compass-fault-warnings.md) | Declination is learned from the platform; compass faults are warned about, not corrected | 2026-08-17 | Accepted |
| [0013](0013-background-work-battery-rules.md) | Nothing automatic runs or wakes the radio behind a dark screen | 2026-08-17 | Accepted |
| [0014](0014-track-recording-fix-rate-and-map-boost.md) | Track recording: fix-rate presets, and a boost to `finest` while the map is looked at | 2026-08-17 | Accepted |
| [0015](0015-mlrn-11-map-interaction-rules.md) | MLRN 11 (Fabric): the map interaction rules that follow from it | 2026-08-18 | Accepted |
| [0016](0016-share-versus-send-a-copy.md) | Share and Send a copy are two verbs, answered in one panel and the inbox | 2026-08-22 | Accepted |
| [0017](0017-inbox-edits-are-outbox-ops.md) | Inbox read state and deletion are outbox ops; a refetch replays the queue | 2026-08-30 | Accepted |
| [0018](0018-foreign-fields.md) | foreignFields for values whose definition the recipient lacks | 2026-09-06 | Accepted |
| [0019](0019-place-links-grant-no-visibility.md) | A PlaceLink grants no visibility | 2026-09-06 | Accepted |
| [0020](0020-share-the-decision-not-the-drawing.md) | Share the decision, not the drawing: shared declarations + parity tests, no generated cross-platform UI | 2026-09-25 | Accepted |
| [0021](0021-agpl-and-dco.md) | AGPL-3.0 only; DCO sign-off, not a CLA | 2026-09-25 | Accepted |
| [0022](0022-mobile-builds-supported-three-months.md) | A Logjam GPS build is supported until three months after its successor's release; SYNC_PROTOCOL keeps N−1 until then | 2026-09-28 | Accepted |
| [0023](0023-ota-runtime-is-the-native-fingerprint.md) | An OTA update's runtime version is the native fingerprint, and a production update ships only from its release's branch | 2026-09-28 | Accepted |
| [0024](0024-prod-terraform-applies-on-merge-by-plan-fingerprint.md) | Prod Terraform applies on merge, and only the plan the PR showed | 2026-09-28 | Superseded by [0026](0026-plan-fingerprint-covers-planned-values.md) |
| [0025](0025-github-settings-in-terraform.md) | The repository's GitHub settings are Terraform, applied on merge like prod | 2026-09-29 | Accepted |
| [0026](0026-plan-fingerprint-covers-planned-values.md) | The apply compares an HMAC of each changed resource's planned values, reporting first and refusing once trusted | 2026-10-02 | Accepted |
