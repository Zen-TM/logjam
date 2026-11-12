# 0037. Undoing an import puts back what it changed, field by field, for a day

- **Date:** 2026-10-18
- **Status:** Accepted
- **Supersedes:** —

## Context

An import from a file (Logjam Web's import dialog, `UnifiedImportDialog.tsx`)
creates places and trips, and also changes ones that already exist: it merges
into a matching place (`api/src/routes/placesBulk.ts`, by a picked target or
an `importKey` match) and updates a trip it imported before
(`api/src/routes/tripLogsBulk.ts`). The rows it creates carry the batch's
`importBatchId`; the rows it changes don't. Undo is
`DELETE /imports/:batchId` (`api/src/routes/imports.ts`).

Until 2026-10-18 Undo only deleted the rows the batch created. A row it had
changed kept the file's values, and `src/__tests__/import.test.ts` asserted
that ("merge applied + retained"), while the dialog's confirm told the user the
opposite: places it merged into "go back to the values they had". The
maintainer: restoring is the expected behaviour. Found by the CSV-import e2e
spec (`frontend/e2e/csv-import.spec.ts`, #506).

Logjam Web offers Undo in one place only: the dialog's result screen, holding
the batch id in component state. Once the dialog closes, nothing in a client
can undo that batch.

## Decision

- **What an import changed is recorded per row, per batch, in
  `import_snapshots`** (`ImportSnapshot` in `schema.prisma`), in the same
  transaction as the change (`snapshotWrites` in `api/src/lib/importSnapshot.ts`).
  A snapshot holds only the fields the import changed, each with its value
  before and the value the import wrote. A map field (`fieldValues`,
  `customFields`) is recorded key by key. A row the batch created gets none.
- **Undo restores a field only while it still holds what the import wrote**
  (`restoreBatch`): one changed since is kept and counted in the response's `keptFields`. A map field is compared and restored
  key by key, so editing one attribute after an import keeps that attribute
  and nothing else. The restore is an ordinary owner-scoped update, so a
  sharee and a phone's delta pull the old values. Undo then deletes the
  batch's snapshots and what it created.
- **A snapshot lives a day.** `sweepExpiredImportSnapshots` deletes one 24 hours
  after its last write (`SNAPSHOT_TTL_MS`, a constant, so the confirm's "for a
  day" can't drift from it), from the API's periodic sweep (`startTopoJobReaper`'s pass,
  beside the file-send and tombstone sweeps), and a snapshot past that age is
  never restored even before the sweep reaches it. Undo after a day still
  deletes what the batch created and restores nothing. Logjam Web's confirm
  says "for a day".
- The table is user data: it joins the account-delete purge
  (`routes/users.ts`), the data export (`lib/dataExport.ts`) and the
  prod-snapshot scrub (`scripts/snapshot-scrub.sql`).

Guards: `api/src/lib/importSnapshot.unit.test.ts` (field and key diff, restore
only-if-unchanged, the retention cutoff), `src/__tests__/import.test.ts`
(a merge restored and its snapshot gone; an edited field kept and counted, the
restore reaching a sharee and a phone's delta; nothing restored past the
retention), `src/routes/accountPurge.unit.test.ts`,
`src/lib/snapshotScrub.unit.test.ts`.

## Consequences

- **Positive:** Undo does what its confirm says. Nothing changed after an import is
  lost to an Undo. The table holds at most a day's
  imports, and only the changed fields of rows that existed before.
- **Negative:** a restore is partial when something changed a field between
  the import and the Undo (a phone syncing an offline edit, another tab, a
  sharee): that field stays, the rest go back, and the user is told how many
  stayed. With Undo only on the result screen, that window is minutes. After a day an Undo through the API
  restores nothing, and its response can't tell that from "nothing to
  restore". One more table every purge, export and scrub must name.
- **Neutral:** two requests in flight under one batch id can snapshot the same
  row twice; Logjam Web sends one at a time. A trip whose places before the
  import have all been deleted since comes back with none.

## Alternatives considered

- **Stamp the merged rows with the batch id and leave it at that**, as created
  rows are: Undo can find them but has nothing to put back, so it either
  deletes rows that existed before the import or leaves them changed. That is
  the behaviour this replaces.
- **Copy the whole row before the import changes it**, and put the copy back
  on Undo: simpler to write, but restoring a whole row overwrites every edit
  made since, and it stores every field of the row, not
  the few the import touched.
- **Restore every recorded field unconditionally:** a clean "back to before",
  but it silently drops whatever the user changed between the import and the
  Undo, the same loss the whole-row copy has, field by field.
- **Keep snapshots until Undo, a row's delete or account delete**, with no
  expiry: built first in #508, then cut in the same PR. Undo exists only on the
  dialog's result screen, so a batch that isn't undone there never can be, and
  its snapshots would stay for good.
- **Send a restore deadline with each import response** for Logjam Web to
  track: built in #508 and replaced by the server enforcing the window. The
  client's deadline couldn't match what the sweep deletes (chunked requests,
  retries, the browser's clock).
