import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { Prisma } from "@prisma/client";
import { resolveUser } from "../lib/resolveUser";
import { assignTripImportKeys } from "../lib/importKeys";
import { deleteTripsCascade } from "../lib/bulkDelete";
import { parseTripTypes, parseDisplayName } from "./tripLogsGlobal";
import { enforceCanyoningTag, linksCanyon } from "@logjam/shared";

const BULK_DELETE_LIMIT = 500;
// Cap import rows per request so a single authenticated call can't force an
// unbounded IN-list lookup + multi-chunk write transaction (the import path does
// per-element work proportional to length). Mirrors BULK_DELETE_LIMIT; the 1 MB
// body cap and 300/min limiter are the other ceilings. See SEC-001.
const BULK_IMPORT_LIMIT = 2000;
const CHUNK_SIZE = 200;

const router = Router();

type BulkTripInput = {
  placeId: string | null;
  sourcePlaceName: string;
  displayName?: string | null;
  date: string;
  notes?: string | null;
  customFields?: Record<string, unknown>;
  types?: string[] | null;
};

type ImportRequest = {
  importBatchId: string;
  trips: BulkTripInput[];
};

// POST /trips/bulk — idempotent file-import endpoint
router.post(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const body = req.body as ImportRequest;

    if (!body.importBatchId || typeof body.importBatchId !== "string") {
      throw new AppError(400, "importBatchId is required");
    }
    if (!Array.isArray(body.trips) || body.trips.length === 0) {
      throw new AppError(400, "trips array is required");
    }
    if (body.trips.length > BULK_IMPORT_LIMIT) {
      throw new AppError(413, `Cannot import more than ${BULK_IMPORT_LIMIT} trip logs at once`);
    }

    // ---- Phase 1: Validate ALL rows before ANY write ----
    const errors: { index: number; error: string }[] = [];

    // Ownership-check all non-null placeIds.
    const placeIds = Array.from(
      new Set(
        body.trips
          .map((t) => t.placeId)
          .filter((id): id is string => id != null && id !== ""),
      ),
    );
    const ownedPlaces = placeIds.length > 0
      ? await prisma.place.findMany({
          where: { id: { in: placeIds } },
          select: { id: true, ownerId: true, placeTypeId: true },
        })
      : [];
    const ownerById = new Map(ownedPlaces.map((c) => [c.id, c.ownerId]));
    const placeTypeById = new Map(ownedPlaces.map((c) => [c.id, c.placeTypeId]));

    type ValidatedTrip = {
      index: number;
      placeId: string | null;
      displayName: string | null;
      date: Date;
      notes: string | null;
      customFields: Record<string, unknown>;
      sourcePlaceName: string;
      types: string[];
    };

    const validTrips: ValidatedTrip[] = [];
    for (let i = 0; i < body.trips.length; i++) {
      const t = body.trips[i];

      if (typeof t.sourcePlaceName !== "string") {
        errors.push({ index: i, error: "sourcePlaceName is required" });
        continue;
      }

      if (!t.date) {
        errors.push({ index: i, error: "date is required" });
        continue;
      }
      const date = new Date(t.date);
      if (isNaN(date.getTime())) {
        errors.push({ index: i, error: "invalid date" });
        continue;
      }

      // placeId is nullable — a place-less trip is valid.
      let placeId: string | null = null;
      if (t.placeId != null && t.placeId !== "") {
        const ownerId = ownerById.get(t.placeId);
        if (ownerId === undefined) {
          errors.push({ index: i, error: "place not found" });
          continue;
        }
        if (ownerId !== user.id) {
          errors.push({ index: i, error: "not the place owner" });
          continue;
        }
        placeId = t.placeId;
      }

      // types is an optional free-text list (trip categories) — reuse the same
      // validator as the single-trip routes rather than re-deriving the rules
      // here. Row-level so a bad `types` value doesn't abort the whole batch.
      // A canyon-linked trip always carries the `canyoning` tag — the same
      // invariant POST/PATCH /trips maintain (tripLogsGlobal.ts). displayName
      // gets the same trim + TRIP_NAME_MAX_LENGTH cap, or an imported row lands
      // over the limit and PATCH /trips/:id can never save it again.
      let types: string[];
      let displayName: string | null;
      try {
        types = enforceCanyoningTag(
          parseTripTypes(t.types) ?? [],
          linksCanyon(placeId !== null ? [placeTypeById.get(placeId)!] : []),
        );
        displayName = parseDisplayName(t.displayName) ?? null;
      } catch (e) {
        if (e instanceof AppError) {
          errors.push({ index: i, error: e.message });
          continue;
        }
        throw e;
      }

      validTrips.push({
        index: i,
        placeId,
        displayName,
        date,
        notes: t.notes ?? null,
        customFields: t.customFields ?? {},
        sourcePlaceName: t.sourcePlaceName,
        types,
      });
    }

    // ---- Phase 2: Compute import keys ----
    // Use the original body.trips (not just validTrips) for occurrence tracking,
    // but only valid trips will be processed. We need occurrence to be stable
    // relative to all rows that share the same contentHash in file order.
    // Since we filtered invalid rows, we assign keys only among the valid set.
    // NOTE: the hash inputs below (sourcePlaceName/date/notes/customFields)
    // must stay exactly as-is — adding `types` (or placeId) here would change
    // every previously-computed importKey and break idempotency for anyone
    // re-importing a batch from before this field existed.
    const keyAssignments = assignTripImportKeys(
      validTrips.map((t) => ({
        sourcePlaceName: t.sourcePlaceName,
        date: t.date.toISOString().slice(0, 10),
        notes: t.notes,
        customFields: t.customFields,
      })),
    );

    // Look up existing trips by importKey for upsert.
    const allImportKeys = keyAssignments.map((k) => k.importKey);
    const existingByKey = new Map<string, { id: string }>();
    if (allImportKeys.length > 0) {
      const existing = await prisma.tripLog.findMany({
        where: { userId: user.id, importKey: { in: allImportKeys } },
        select: { id: true, importKey: true },
      });
      for (const row of existing) {
        if (row.importKey) existingByKey.set(row.importKey, { id: row.id });
      }
    }

    // ---- Phase 3: Build create/update operations ----
    // Creates use `.create()` (not `createMany`) because attaching the place
    // join row is a nested write, which `createMany` cannot do — one place
    // per CSV row, linked via TripLogPlace at position 0.
    type CreateOp = { data: Prisma.TripLogCreateInput };
    type UpdateOp = { id: string; data: Prisma.TripLogUpdateInput };

    const creates: CreateOp[] = [];
    const updates: UpdateOp[] = [];

    for (let i = 0; i < validTrips.length; i++) {
      const trip = validTrips[i];
      const { importKey } = keyAssignments[i];
      const existing = existingByKey.get(importKey);

      const placeLink = trip.placeId
        ? { create: [{ placeId: trip.placeId, position: 0 }] }
        : {};

      if (existing) {
        // Update in place — re-apply resolution outputs (place link,
        // displayName, types) and fully replace the place join (single row,
        // or none).
        updates.push({
          id: existing.id,
          data: {
            displayName: trip.displayName,
            types: trip.types,
            date: trip.date,
            notes: trip.notes,
            customFields: trip.customFields as Prisma.InputJsonValue,
            places: { deleteMany: {}, ...placeLink },
          },
        });
      } else {
        // Create with importBatchId.
        creates.push({
          data: {
            user: { connect: { id: user.id } },
            displayName: trip.displayName,
            types: trip.types,
            date: trip.date,
            notes: trip.notes,
            customFields: trip.customFields as Prisma.InputJsonValue,
            importKey,
            importBatchId: body.importBatchId,
            places: placeLink,
          },
        });
      }
    }

    // ---- Phase 4: Execute in chunked transactions (size 200) ----
    for (let i = 0; i < creates.length; i += CHUNK_SIZE) {
      const chunk = creates.slice(i, i + CHUNK_SIZE);
      await prisma.$transaction(
        chunk.map((op) => prisma.tripLog.create({ data: op.data })),
      );
    }

    for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
      const chunk = updates.slice(i, i + CHUNK_SIZE);
      await prisma.$transaction(
        chunk.map((op) =>
          prisma.tripLog.update({
            where: { id: op.id },
            data: op.data,
          }),
        ),
      );
    }

    res.json({
      batchId: body.importBatchId,
      imported: creates.length,
      updated: updates.length,
      errors,
    });
  },
);

// POST /trips/bulk/delete — bulk delete trip logs by ID (owner only)
router.post(
  "/delete",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const { ids } = req.body as { ids: unknown };
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new AppError(400, "ids array is required");
    }
    if (ids.length > BULK_DELETE_LIMIT) {
      throw new AppError(413, `Cannot delete more than ${BULK_DELETE_LIMIT} trip logs at once`);
    }

    const deletedIds = await deleteTripsCascade(user.id, ids as string[]);
    res.json({ deletedIds });
  },
);

export default router;
