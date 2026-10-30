# 0043. GeoPDFs render in the browser, and nothing about one reaches the server

- **Date:** 2026-10-29
- **Status:** Accepted
- **Supersedes:** —

## Context

A GeoPDF was an async server job. `POST /geo-pdf` wrote a `geo_pdf_jobs` row
holding the extent, title and place markers (`config`), launched the
`logjam-geo-pdf-worker` Fargate task, which rendered with node-canvas and
pdfkit (its generator, `generateGeoPdf`), uploaded the PDF to the
`geo-pdf` folder of the topo bucket's exports and notified. Around it sat the runtime estimator, the
reaper timeouts, GeoPDF's share of the compute credits, storage and egress
charging, job sharing (`Share` rows of entity type `geoPdfJob`), the
`geo_pdf_complete` notification, Logjam Web's GeoPDFs page and Logjam GPS's
"Account GeoPDFs" list with its auto-download switch.

The render is bounded (105 MP of canvas, about two minutes) and almost all of
the drawing is portable TypeScript. A prototype ran it in a tab on a laptop, a
Pixel 9 and an iPhone 8 (#602). `frontend/src/geoPdf/` now does so, in a
worker, in strips that fit the smallest canvas a browser allows. That makes
the server path a second renderer and a stack of machinery that buys a wait
and a copy of the user's print on our side.

## Decision

- **A GeoPDF is made in Logjam Web, in the browser, and nothing about it is
  stored or sent to the API.** The extent, title and place markers stay on the
  device. There is no job row, no S3 object, no presigned link, no completion
  notification and no estimate.
- **The server path is gone:** the `/geo-pdf` job routes, the worker, the generator
  and its terrain and vector-tile modules, GeoPDF's credit, quota, egress and
  reaper paths, the GeoPDF worker's job, and its Docker assets. The
  `logjam-geo-pdf-worker` task definition and its log group stay, unchanged:
  maintainer announcements and the legacy-topo purge run one-off scripts on it
  (`docs/operations/announcements.md`), and `infra/scripts/pin-release.sh` names
  the family, so a rename would make every API deploy depend on a Terraform
  apply. A rename can be its own later change.
- **Update 2026-10-30: the task definition and log group are renamed
  `logjam-api-script` and `/ecs/logjam-api-script`** (container `api-script`,
  Terraform `api_script`), because the family renders nothing and the old
  name misled. The rename went in two applies, the new family beside the old
  and then the old removed, since `infra/scripts/pin-release.sh` names the
  family and every API deploy would otherwise depend on a Terraform apply.
  Terraform's destroy deregisters only its own revision; the revisions deploys
  pinned were deregistered by hand. Everything else above stands.
- **Job history and GeoPDF sharing are gone:** `geoPdfJob` is not a
  `SHARABLE_ENTITY_TYPES` member, so a sharee can no longer see a GeoPDF
  (sharing a place still shares the map). Guard:
  `shared/src/sharing.test.ts`, "refuses the retired GeoPDF job kind".
- **Logjam GPS loses the Account GeoPDFs list and the auto-download setting,**
  and keeps importing a PDF file (0008). The import takes a file URI and has no
  download-from-account path.
- **The rows go at once:** the migration `20261027000000_delete_geo_pdf_jobs`
  deletes every `geo_pdf_jobs` row, its shares and its notifications, and gives
  back the storage the completed ones were charged. The empty table and its
  Prisma model dropped a release later (updated 2026-10-30), because the image
  serving during the deploy swap still read them (0003). A job queued on that
  old image after the DELETE runs, and completed, stays charged; the migration
  that drops the table repeats the refund-then-delete first. Guard:
  `prisma/upgrade-check/`.
- **`GET /geo-pdf` answers `{ jobs: [] }`** (a one-route router, since
  deleted) because a Logjam GPS build is supported until three months after
  its successor ships (0022), and an old build asks for the list. It goes three
  months after the first Logjam GPS release without the list. Guard: its own
  test, since deleted.
- **Update 2026-10-30: the `GET /geo-pdf` stub is gone, and account deletion
  no longer deletes `geo_pdf_jobs` rows.** No Logjam GPS build with the
  GeoPDF list was ever released, and the only installed copy is the
  maintainer's own phone, which they will update, so no supported build makes
  the request 0022 protects. An old Logjam GPS build that asks gets a 404.
  The `geo_pdf_jobs` table and the `GeoPdfJob` model dropped in
  `20261030000000_drop_geo_pdf_jobs`, which repeats the refund-then-delete
  first (guard: `prisma/upgrade-check/`). Everything else above stands.
- **There is no fallback for a browser that cannot render:** the dialog
  refuses with a sentence. The browser floor of 0042 (Safari 17, Chrome 114,
  Firefox 125) is what lets the renderer assume `OffscreenCanvas` in a worker.
- Raising the canvas cap or adding a server render back needs this ADR changed.
  No test holds the absence of a server renderer; review does.
- **Update 2026-10-29: Logjam Web keeps the statewide archive tiles a print
  read in the browser's Cache API, so a repeat print starts warm.** That is an
  on-device record of which areas were printed, so it holds same-origin
  statewide archives only, never a presigned or third-party URL, and is cleared
  at sign-out and at sign-in. Nothing leaves the device, so "stored or sent to
  the API" still holds for the GeoPDF itself. Guards:
  `frontend/src/geoPdf/tiles.test.ts`, `frontend/src/useAuth.test.tsx`.
  Everything else above stands.

## Consequences

- **Positive:** nothing about a print leaves the device, which suits a
  privacy-first, self-funded project. A task definition, a log group, a table,
  a notification type and GeoPDF's quota and credit paths are gone. The user
  stops waiting for a task to launch.
- **Negative:** a render does not survive a closed tab; there is no history, no
  re-download of an earlier print, no GeoPDF to share with a friend and no
  GeoPDF waiting on the phone from a laptop. A phone or a laptop that cannot
  hold the canvas refuses what the server would have drawn. People below the
  browser floor cannot print at all.
- **Neutral:** the prod Terraform plan for this change touches no GeoPDF task
  definition or log group. PDFs already in that `geo-pdf` exports folder are not deleted by this
  change; the topo bucket's 7-day `exports/` lifecycle rule collects them. The
  maintainer may remove them sooner by hand. The `geo_pdf_jobs` table and model
  dropped in `20261030000000_drop_geo_pdf_jobs` (updated 2026-10-30). The
  `autoDownloadGeoPdfs` and `geoPdfEmail` preferences are no longer read and
  are not written; an old value stays inert in `users.ui_preferences` until the
  user next saves a preference.

## Alternatives considered

- **Keep the server worker.** It survives a closed tab, runs in any browser and
  keeps history, sharing and the Logjam GPS handoff. Rejected: with a browser
  renderer, keeping both doubles the renderer, and the stack costs a task
  definition, a table and a wait.
- **Browser render with a server fallback.** Rejected: the stack stays, the two
  renderers drift, and the fallback is barely exercised.
- **Browser render, then upload the result as a job.** Keeps history, sharing
  and the handoff without the worker. Rejected: the handoff is rarely used (a
  GeoPDF is mostly printed from a computer, and a downloaded region covers the
  phone), and it keeps the table, the storage charge and the S3 object.
- **One canvas per render.** Rejected: iOS Safari caps one canvas at about
  16.7 MP, below an A3 at 1:25 000. The renderer draws in strips.
- **Snapshot the MapLibre canvas.** Rejected: print rendering is 300 DPI with
  its own width stops and label sizing, which a scaled map canvas does not
  match.
- **Render synchronously in the API.** Rejected: a request of 30 to 120 s.
- **Drop `GET /geo-pdf` at once.** Considered: an old Logjam GPS build would
  answer "Couldn't load your GeoPDFs." where it now says there are none, a
  break of a request a supported build makes (0022). Rejected for the stub above;
  superseded by the update above, once no released build had the list.
- **Keep the stub three months after the first Logjam GPS release without the
  list.** The rule above, until 2026-10-30. Rejected then: that release never
  shipped the list, so nobody was left to answer.
- **Drop the table in the same release.** Rejected by 0003: the old image still
  reads it during the swap.
- **No persistent tile cache, so every print is cold.** Rejected by the update
  above: a repeat print of the same area re-reads the same ranges, and the
  cache costs only an on-device record that sign-out and sign-in clear.
