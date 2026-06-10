import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { Prisma } from "@prisma/client";
import { getEnv } from "../lib/env";
import { deleteS3Keys } from "../lib/s3Cleanup";
import { decrementStorageUsed } from "../lib/storageQuota";
import { resolveUser } from "../lib/resolveUser";

const MEDIA_BUCKET = getEnv().S3_BUCKET_MEDIA ?? "";

const BULK_DELETE_LIMIT = 500;

const router = Router();

type BulkCanyonInput = {
  name: string;
  latitude: number;
  longitude: number;
  altNames?: string[];
  notes?: string | null;
  vGrade?: number | null;
  aGrade?: number | null;
  commitment?: number | null;
  quality?: number | null;
  wetsuits?: number | null;
  numAbseils?: number | null;
  longestAbseil?: number | null;
  hours?: number | null;
  attributes?: Record<string, unknown>;
};

type BulkRequest =
  | { mode: "create"; canyons: BulkCanyonInput[] }
  | { mode: "replace"; replacements: { canyonId: string; data: BulkCanyonInput }[] };

type BulkError = { rowIndex: number; message: string };

function validateInput(
  input: BulkCanyonInput,
  rowIndex: number,
  errors: BulkError[],
): boolean {
  if (!input.name || typeof input.name !== "string" || !input.name.trim()) {
    errors.push({ rowIndex, message: `Row ${rowIndex}: name is required` });
    return false;
  }
  if (
    typeof input.latitude !== "number" ||
    !isFinite(input.latitude) ||
    input.latitude < -90 ||
    input.latitude > 90
  ) {
    errors.push({ rowIndex, message: `Row ${rowIndex}: invalid latitude` });
    return false;
  }
  if (
    typeof input.longitude !== "number" ||
    !isFinite(input.longitude) ||
    input.longitude < -180 ||
    input.longitude > 180
  ) {
    errors.push({ rowIndex, message: `Row ${rowIndex}: invalid longitude` });
    return false;
  }
  const gradeChecks: [string, number | null | undefined, number, number][] = [
    ["vGrade", input.vGrade, 1, 7],
    ["aGrade", input.aGrade, 1, 7],
    ["commitment", input.commitment, 1, 6],
    ["quality", input.quality, 1, 5],
    ["wetsuits", input.wetsuits, 1, 5],
  ];
  for (const [field, val, min, max] of gradeChecks) {
    if (val != null && (!Number.isInteger(val) || val < min || val > max)) {
      errors.push({ rowIndex, message: `Row ${rowIndex}: ${field} must be an integer between ${min} and ${max}` });
      return false;
    }
  }
  return true;
}

function toCreateData(
  input: BulkCanyonInput,
  ownerId: string,
): Prisma.CanyonCreateManyInput {
  return {
    ownerId,
    name: input.name.trim(),
    altNames: input.altNames ?? [],
    latitude: input.latitude,
    longitude: input.longitude,
    notes: input.notes ?? null,
    vGrade: input.vGrade ?? null,
    aGrade: input.aGrade ?? null,
    commitment: input.commitment ?? null,
    quality: input.quality ?? null,
    wetsuits: input.wetsuits ?? null,
    numAbseils: input.numAbseils ?? null,
    longestAbseil: input.longestAbseil ?? null,
    hours: input.hours ?? null,
    attributes: (input.attributes ?? {}) as Prisma.InputJsonValue,
  };
}

// POST /canyons/bulk
router.post(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const body = req.body as BulkRequest;

    if (body.mode === "create") {
      const { canyons } = body;
      if (!Array.isArray(canyons) || canyons.length === 0) {
        throw new AppError(400, "canyons array is required");
      }

      const errors: BulkError[] = [];
      const validData: Prisma.CanyonCreateManyInput[] = [];

      for (let i = 0; i < canyons.length; i++) {
        if (validateInput(canyons[i], i, errors)) {
          validData.push(toCreateData(canyons[i], user.id));
        }
      }

      if (validData.length > 0) {
        await prisma.canyon.createMany({ data: validData });
      }

      res.json({ created: validData.length, replaced: 0, errors });
      return;
    }

    if (body.mode === "replace") {
      const { replacements } = body;
      if (!Array.isArray(replacements) || replacements.length === 0) {
        throw new AppError(400, "replacements array is required");
      }

      const errors: BulkError[] = [];

      const candidateIds = replacements
        .map((r) => r.canyonId)
        .filter((id): id is string => Boolean(id));
      const owned = await prisma.canyon.findMany({
        where: { id: { in: candidateIds } },
        select: { id: true, ownerId: true },
      });
      const ownerById = new Map(owned.map((c) => [c.id, c.ownerId]));

      // validate + ownership-check all rows before any writes
      const validReplacements: { canyonId: string; data: BulkCanyonInput }[] = [];
      for (let i = 0; i < replacements.length; i++) {
        const { canyonId, data } = replacements[i];
        if (!canyonId) {
          errors.push({ rowIndex: i, message: `Row ${i}: canyonId is required` });
          continue;
        }
        if (!validateInput(data, i, errors)) continue;

        const ownerId = ownerById.get(canyonId);
        if (ownerId === undefined) {
          errors.push({ rowIndex: i, message: `Row ${i}: canyon not found` });
          continue;
        }
        if (ownerId !== user.id) {
          throw new AppError(403, "Forbidden");
        }
        validReplacements.push({ canyonId, data });
      }

      if (validReplacements.length > 0) {
        await prisma.$transaction(
          validReplacements.map(({ canyonId, data }) =>
            prisma.canyon.update({
              where: { id: canyonId },
              data: {
                name: data.name.trim(),
                altNames: data.altNames ?? [],
                latitude: data.latitude,
                longitude: data.longitude,
                notes: data.notes ?? null,
                vGrade: data.vGrade ?? null,
                aGrade: data.aGrade ?? null,
                commitment: data.commitment ?? null,
                quality: data.quality ?? null,
                wetsuits: data.wetsuits ?? null,
                numAbseils: data.numAbseils ?? null,
                longestAbseil: data.longestAbseil ?? null,
                hours: data.hours ?? null,
                attributes: (data.attributes ?? {}) as Prisma.InputJsonValue,
              },
            }),
          ),
        );
      }

      res.json({ created: 0, replaced: validReplacements.length, errors });
      return;
    }

    throw new AppError(400, "mode must be 'create' or 'replace'");
  },
);

// POST /canyons/bulk/delete — bulk delete canyons by ID (owner only)
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
      throw new AppError(400, `Cannot delete more than ${BULK_DELETE_LIMIT} canyons at once`);
    }

    const owned = await prisma.canyon.findMany({
      where: { id: { in: ids as string[] }, ownerId: user.id },
      select: { id: true },
    });
    const ownedIds = owned.map((c) => c.id);
    if (ownedIds.length === 0) {
      res.json({ deletedIds: [] });
      return;
    }

    const tripIds = (
      await prisma.tripLog.findMany({
        where: { canyonId: { in: ownedIds } },
        select: { id: true },
      })
    ).map((t) => t.id);

    const media = await prisma.media.findMany({
      where: {
        OR: [
          { linkedType: "tripLog", linkedId: { in: tripIds } },
          { linkedType: "canyon", linkedId: { in: ownedIds } },
        ],
      },
      select: { s3KeyDisplay: true, s3KeyThumbnail: true, fileSizeBytes: true },
    });

    // S3-first (ARCH-004): blobs go before the rows, so an S3 failure leaves
    // the rows (and therefore the keys) intact for a retried delete. The row
    // deletes and the quota decrement then share one transaction so a crash
    // between them can't leave the quota over-counted.
    const s3Keys = media.flatMap((m) =>
      [m.s3KeyDisplay, m.s3KeyThumbnail].filter((k): k is string => Boolean(k)),
    );
    const totalBytes = media.reduce((sum, m) => sum + (m.fileSizeBytes ?? 0n), 0n);
    await deleteS3Keys(MEDIA_BUCKET, s3Keys);

    await prisma.$transaction(async (tx) => {
      await tx.media.deleteMany({
        where: { linkedType: "tripLog", linkedId: { in: tripIds } },
      });
      await tx.media.deleteMany({
        where: { linkedType: "canyon", linkedId: { in: ownedIds } },
      });
      await tx.tripLog.deleteMany({ where: { canyonId: { in: ownedIds } } });
      await tx.canyonShare.deleteMany({ where: { canyonId: { in: ownedIds } } });
      // Purge canyon_shared notifications held by OTHER users (the share
      // recipients) that reference the deleted canyons — not just the owner's
      // own rows (PRIV-003), matching the single-delete path in canyons.ts.
      // The OR list is bounded by BULK_DELETE_LIMIT.
      await tx.notification.deleteMany({
        where: {
          type: "canyon_shared",
          OR: ownedIds.map((canyonId) => ({
            payload: { path: ["canyonId"], equals: canyonId },
          })),
        },
      });
      await tx.canyon.deleteMany({ where: { id: { in: ownedIds } } });
      await decrementStorageUsed(user.id, totalBytes, tx);
    });

    res.json({ deletedIds: ownedIds });
  },
);

export default router;
