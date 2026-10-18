// What an import changed on a place or trip it did not create, recorded so
// Undo (DELETE /imports/:batchId) can put it back.
//
// A snapshot holds only the fields the import changed, each with its value
// before and the value the import wrote. Undo restores a field only while it
// still holds what the import wrote: one the user has changed since is kept,
// and counted. A field that holds a map (`fieldValues`, `customFields`) is
// compared and restored key by key, so editing one attribute after an import
// keeps that attribute and nothing else. Guards: importSnapshot.unit.test.ts,
// src/__tests__/import.test.ts.
//
// RETENTION: a snapshot lives IMPORT_SNAPSHOT_TTL_MS (24 h by default) from
// its last write, then the reaper's sweep deletes it (sweepExpiredImportSnapshots,
// run by startTopoJobReaper). Undo is offered only on Logjam Web's import
// result screen, so a snapshot outliving that is clutter holding old copies of
// user text. Undo after expiry still deletes what the batch created and
// restores nothing; each import response says until when it can restore
// (`restorableUntil`), and Logjam Web's confirm says so. Undo, the row's
// delete and account delete remove a snapshot sooner.
import { isDeepStrictEqual } from "node:util";
import {
  enforceCanyoningTag,
  linksCanyon,
  setFieldValues,
} from "@logjam/shared";
import prisma from "../services/prisma";
import { getEnv } from "./env";

export type RowFields = Record<string, unknown>;
export type Change = { before: RowFields; after: RowFields };

const MAP_FIELDS = new Set(["fieldValues", "customFields"]);

const asMap = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

// A missing map key and a null one are the same value: setFieldValues deletes
// a key set to null.
const same = (a: unknown, b: unknown) =>
  isDeepStrictEqual(a ?? null, b ?? null);

/** The fields `next` changes on `prev`, or null when it changes none. */
export function diffFields(prev: RowFields, next: RowFields): Change | null {
  const before: RowFields = {};
  const after: RowFields = {};
  for (const field of Object.keys(next)) {
    if (MAP_FIELDS.has(field)) {
      const was = asMap(prev[field]);
      const now = asMap(next[field]);
      const b: Record<string, unknown> = {};
      const a: Record<string, unknown> = {};
      for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
        if (same(was[key], now[key])) continue;
        b[key] = was[key] ?? null;
        a[key] = now[key] ?? null;
      }
      if (Object.keys(a).length > 0) {
        before[field] = b;
        after[field] = a;
      }
    } else if (!same(prev[field], next[field])) {
      before[field] = prev[field] ?? null;
      after[field] = next[field] ?? null;
    }
  }
  return Object.keys(after).length > 0 ? { before, after } : null;
}

function overlay(base: RowFields, top: RowFields): RowFields {
  const out = { ...base };
  for (const [field, value] of Object.entries(top)) {
    out[field] = MAP_FIELDS.has(field)
      ? { ...asMap(base[field]), ...asMap(value) }
      : value;
  }
  return out;
}

/** One batch can change a row twice (Logjam Web posts places, then the places
 *  a logbook creates, under one batch id): the snapshot keeps the first
 *  `before` of each field and the last `after`. */
export function combineChanges(earlier: Change, later: Change): Change | null {
  return diffFields(
    overlay(later.before, earlier.before),
    overlay(earlier.after, later.after),
  );
}

/** The fields Undo writes back, and how many it keeps because they changed
 *  since the import. A map field comes back whole, ready to write. */
export function restoreFields(
  current: RowFields,
  change: Change,
): { restore: RowFields; kept: number } {
  const restore: RowFields = {};
  let kept = 0;
  for (const [field, wrote] of Object.entries(change.after)) {
    const was = change.before[field];
    if (MAP_FIELDS.has(field)) {
      const now = asMap(current[field]);
      const patch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(asMap(wrote))) {
        if (same(now[key], value)) patch[key] = asMap(was)[key] ?? null;
        else if (!same(now[key], asMap(was)[key])) kept++;
      }
      if (Object.keys(patch).length > 0) {
        restore[field] = setFieldValues(current[field], patch);
      }
    } else if (same(current[field], wrote)) {
      restore[field] = was;
    } else if (!same(current[field], was)) {
      kept++;
    }
  }
  return { restore, kept };
}

/** The place fields a merge writes. */
export const placeFields = (place: {
  altNames: string[];
  notes: string | null;
  importKey: string | null;
  fieldValues: unknown;
}): RowFields => ({
  altNames: place.altNames,
  notes: place.notes,
  importKey: place.importKey,
  fieldValues: place.fieldValues,
});

/** The trip fields a re-import writes; `placeIds` is its links, in order. */
export const tripFields = (trip: {
  displayName: string | null;
  types: string[];
  date: Date;
  notes: string | null;
  customFields: unknown;
  places: { placeId: string; position: number }[];
}): RowFields => ({
  displayName: trip.displayName,
  types: trip.types,
  date: trip.date.toISOString(),
  notes: trip.notes,
  customFields: trip.customFields,
  placeIds: [...trip.places]
    .sort((a, b) => a.position - b.position)
    .map((link) => link.placeId),
});

/** The writes that record `changes` (row id → what this request changed on
 *  it), folded into what earlier requests of the batch recorded. They go in
 *  the transaction that makes the changes. */
export async function snapshotWrites(
  ownerId: string,
  batchId: string,
  column: "placeId" | "tripLogId",
  changes: Map<string, Change>,
) {
  if (changes.size === 0) return { writes: [], recorded: 0 };
  const ids = [...changes.keys()];
  const where = {
    ownerId,
    batchId,
    ...(column === "placeId"
      ? { placeId: { in: ids } }
      : { tripLogId: { in: ids } }),
  };
  const prior = new Map(
    (await prisma.importSnapshot.findMany({ where })).map((row) => [
      row[column],
      { before: row.before as RowFields, after: row.after as RowFields },
    ]),
  );
  const rows = ids.flatMap((id) => {
    const earlier = prior.get(id);
    const change = earlier
      ? combineChanges(earlier, changes.get(id)!)
      : changes.get(id)!;
    return change
      ? [
          {
            ownerId,
            batchId,
            [column]: id,
            before: change.before as object,
            after: change.after as object,
          },
        ]
      : [];
  });
  return {
    writes: [
      prisma.importSnapshot.deleteMany({ where }),
      prisma.importSnapshot.createMany({ data: rows }),
    ],
    recorded: rows.length,
  };
}

/** Until when Undo can put back what a request recorded, or null if it
 *  recorded nothing. */
export function restorableUntil(recorded: number, now = new Date()) {
  return recorded > 0
    ? new Date(now.getTime() + getEnv().IMPORT_SNAPSHOT_TTL_MS).toISOString()
    : null;
}

/** Deletes snapshots past their retention (see the header). */
export async function sweepExpiredImportSnapshots(now = new Date()) {
  const { count } = await prisma.importSnapshot.deleteMany({
    where: {
      createdAt: {
        lt: new Date(now.getTime() - getEnv().IMPORT_SNAPSHOT_TTL_MS),
      },
    },
  });
  return count;
}

/** Puts back what a batch changed on rows it did not create, as ordinary
 *  owner-scoped updates (which bump `updatedAt`, so phones and sharees pull
 *  them), and drops the batch's snapshots. */
export async function restoreBatch(ownerId: string, batchId: string) {
  const snapshots = await prisma.importSnapshot.findMany({
    where: { ownerId, batchId },
    include: {
      place: {
        select: {
          altNames: true,
          notes: true,
          importKey: true,
          fieldValues: true,
        },
      },
      tripLog: {
        select: {
          displayName: true,
          types: true,
          date: true,
          notes: true,
          customFields: true,
          places: {
            select: {
              placeId: true,
              position: true,
              place: { select: { placeTypeId: true } },
            },
          },
        },
      },
    },
  });

  // A trip goes back to the places it was linked to, less any deleted since.
  const linkable = new Map(
    (
      await prisma.place.findMany({
        where: {
          ownerId,
          id: {
            in: snapshots.flatMap(
              (s) => ((s.before as RowFields).placeIds as string[]) ?? [],
            ),
          },
        },
        select: { id: true, placeTypeId: true },
      })
    ).map((p) => [p.id, p.placeTypeId]),
  );

  // Read, then written without a lock: an edit landing in between these two
  // statements is overwritten.
  let restoredPlaces = 0;
  let restoredTrips = 0;
  let keptFields = 0;
  const writes = [];
  for (const snapshot of snapshots) {
    const change = {
      before: snapshot.before as RowFields,
      after: snapshot.after as RowFields,
    };
    if (snapshot.place) {
      const { restore, kept } = restoreFields(
        placeFields(snapshot.place),
        change,
      );
      keptFields += kept;
      if (Object.keys(restore).length === 0) continue;
      restoredPlaces++;
      writes.push(
        prisma.place.update({
          where: { id: snapshot.placeId!, ownerId },
          data: restore,
        }),
      );
    } else if (snapshot.tripLog) {
      const { restore, kept } = restoreFields(
        tripFields(snapshot.tripLog),
        change,
      );
      keptFields += kept;
      if (Object.keys(restore).length === 0) continue;
      restoredTrips++;
      const { placeIds, ...data } = restore;
      const links = Array.isArray(placeIds)
        ? (placeIds as string[]).filter((id) => linkable.has(id))
        : null;
      // The canyoning tag follows the links the trip ends with, as on every
      // trip write (tripName.ts).
      if (links || data.types) {
        data.types = enforceCanyoningTag(
          (data.types ?? snapshot.tripLog.types) as string[],
          linksCanyon(
            links
              ? links.map((id) => linkable.get(id)!)
              : snapshot.tripLog.places.map((link) => link.place.placeTypeId),
          ),
        );
      }
      writes.push(
        prisma.tripLog.update({
          where: { id: snapshot.tripLogId!, userId: ownerId },
          data: {
            ...data,
            // A write of links alone does not move @updatedAt, which is what
            // phones pull by (tripLogsGlobal.ts does the same). Guard: the
            // re-linked trip test in src/__tests__/import.test.ts.
            ...(links
              ? {
                  updatedAt: new Date(),
                  places: {
                    deleteMany: {},
                    create: links.map((placeId, position) => ({
                      placeId,
                      position,
                    })),
                  },
                }
              : {}),
          },
        }),
      );
    }
  }
  await prisma.$transaction([
    ...writes,
    prisma.importSnapshot.deleteMany({ where: { ownerId, batchId } }),
  ]);
  return { restoredPlaces, restoredTrips, keptFields };
}
