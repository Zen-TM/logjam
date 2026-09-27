# Architecture decision records

One file per decision, `NNNN-kebab-title.md`, in the order they were made.
Start a new one from [`0000-template.md`](0000-template.md). An accepted
decision is never edited to say something else: write a new ADR that
supersedes it, and mark the old one `Superseded by`.

When a decision earns an ADR: root `AGENTS.md` → Decisions. A rule most
sessions in a directory must follow is one line in that directory's
`AGENTS.md`, linking back here; the rest are found by searching this
directory for the paths and symbols a change touches.

| # | Decision | Date | Status |
|---|---|---|---|
| [0001](0001-place-share-visibility.md) | Place share visibility | 2026-07-04 | Accepted |
| [0002](0002-foreign-fields.md) | foreignFields for values whose definition the recipient lacks | 2026-09-06 | Accepted |
| [0003](0003-place-links-grant-no-visibility.md) | A PlaceLink grants no visibility | 2026-09-06 | Accepted |
| [0020](0020-pre-deploy-migrations-expand-contract.md) | Prod migrations run in a gated pre-deploy task; migrations are expand/contract | 2026-07-17 | Accepted |
| [0022](0022-share-the-decision-not-the-drawing.md) | Share the decision, not the drawing: shared declarations + parity tests, no generated cross-platform UI | 2026-09-25 | Accepted |
| [0023](0023-agpl-and-dco.md) | AGPL-3.0 only; DCO sign-off, not a CLA | 2026-09-25 | Accepted |
| [0031](0031-mlrn-11-map-interaction-rules.md) | MLRN 11 (Fabric): the map interaction rules that follow from it | 2026-08-18 | Accepted |
| [0033](0033-guest-mode-is-dont-sync-yet.md) | Guest mode is "don't sync yet", not a separate storage path | 2026-08-05 | Accepted |
| [0034](0034-offline-region-downloads.md) | Offline region downloads: one queue, the file is the checkpoint | 2026-07-30 | Accepted |
| [0035](0035-geopdf-import-by-file-uri.md) | GeoPDF import takes a file URI, never bytes | 2026-08-10 | Accepted |
| [0036](0036-share-versus-send-a-copy.md) | Share and Send a copy are two verbs, answered in one panel and the inbox | 2026-08-22 | Accepted |
| [0039](0039-inbox-edits-are-outbox-ops.md) | Inbox read state and deletion are outbox ops; a refetch replays the queue | 2026-08-30 | Accepted |
| [0040](0040-map-sensors-only-while-focused.md) | Map sensors run only while the map is focused and foregrounded; the heading lives outside React state | 2026-08-17 | Accepted |
| [0041](0041-compass-heading-pipeline.md) | Compass heading: gyro-fused source, one camera writer, a rate-tracking display | 2026-08-17 | Accepted |
| [0042](0042-declination-and-compass-fault-warnings.md) | Declination is learned from the platform; compass faults are warned about, not corrected | 2026-08-17 | Accepted |
| [0043](0043-background-work-battery-rules.md) | Nothing automatic runs or wakes the radio behind a dark screen | 2026-08-17 | Accepted |
| [0044](0044-track-recording-fix-rate-and-map-boost.md) | Track recording: fix-rate presets, and a boost to `finest` while the map is looked at | 2026-08-17 | Accepted |
| [0045](0045-on-device-data-privacy.md) | On-device data privacy: app lock off by default, declared stores, one wipe path | 2026-08-04 | Accepted |
| [0046](0046-mobile-sentry-and-scrubber.md) | Mobile crash reporting: Sentry behind a scrubber and a consent gate | 2026-07-23 | Accepted |
| [0047](0047-signed-ota-updates.md) | OTA updates are code-signed, with the private key outside the repo | 2026-08-16 | Accepted |
| [0064](0064-rds-tls-via-bundled-ca.md) | The API image connects to RDS over verified TLS using a bundled CA | 2026-06-11 | Accepted |
