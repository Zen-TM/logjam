import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { Prisma } from "@prisma/client";
import {
  mergeCanyon,
  DEFAULT_CANYON_MERGE_POLICY,
  type CanyonMergePolicy,
  type MergeableField,
} from "@logjam/shared";
import { resolveUser } from "../lib/resolveUser";
import { canyonImportKey } from "../lib/importKeys";
import { deleteCanyonsCascade } from "../lib/bulkDelete";

const BULK_DELETE_LIMIT = 500;
// Cap import rows per request so a single authenticated call can't force an
// unbounded IN-list lookup + multi-chunk write transaction (the import path does
// per-element work proportional to length). Mirrors BULK_DELETE_LIMIT; the 1 MB
// body cap and 300/min limiter are the other ceilings. See SEC-001.
const BULK_IMPORT_LIMIT = 2000;
const CHUNK_SIZE = 200;

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
  numAbseils?: number | null;
  longestAbseil?: number | null;
  hours?: number | null;
  attributes?: Record<string, unknown>;
};

type BulkError = { rowIndex: number; message: string };

function validateInput(
  input: BulkCanyonInput,
  rowIndex: number,
  errors: BulkError[],
): boolean {
  // Messages carry no "Row N:" prefix: `rowIndex` is returned alongside so the
  // caller can label the error with the ORIGINAL CSV line (the request-body index
  // isn't the CSV line once unparseable rows are filtered client-side). A prefix
  // here produced the double "Row 1: Row 0: ..." index seen in the UI (IMPORT-7).
  if (!input.name || typeof input.name !== "string" || !input.name.trim()) {
    errors.push({ rowIndex, message: "name is required" });
    return false;
  }
  if (
    typeof input.latitude !== "number" ||
    !isFinite(input.latitude) ||
    input.latitude < -90 ||
    input.latitude > 90
  ) {
    errors.push({ rowIndex, message: "invalid latitude" });
    return false;
  }
  if (
    typeof input.longitude !== "number" ||
    !isFinite(input.longitude) ||
    input.longitude < -180 ||
    input.longitude > 180
  ) {
    errors.push({ rowIndex, message: "invalid longitude" });
    return false;
  }
  const gradeChecks: [string, number | null | undefined, number, number][] = [
    ["vGrade", input.vGrade, 1, 7],
    ["aGrade", input.aGrade, 1, 7],
    ["commitment", input.commitment, 1, 6],
  ];
  for (const [field, val, min, max] of gradeChecks) {
    if (val != null && (!Number.isInteger(val) || val < min || val > max)) {
      errors.push({ rowIndex, message: `${field} must be an integer between ${min} and ${max}` });
      return false;
    }
  }
  // quality is a decimal (1-5); allow non-integer values.
  if (
    input.quality != null &&
    (!isFinite(input.quality) || input.quality < 1 || input.quality > 5)
  ) {
    errors.push({ rowIndex, message: "quality must be a number between 1 and 5" });
    return false;
  }
  return true;
}

const MERGEABLE_FIELD_NAMES: MergeableField[] = [
  "vGrade", "aGrade", "commitment", "quality", "numAbseils", "longestAbseil", "hours", "notes",
];

function validateMergePolicy(policy: unknown): CanyonMergePolicy | null {
  if (typeof policy !== "object" || policy === null) return null;
  const candidate = policy as Record<string, unknown>;
  for (const field of MERGEABLE_FIELD_NAMES) {
    const value = candidate[field];
    if (value !== "keepExisting" && value !== "useIncoming") return null;
  }
  // Drop unknown keys — reconstruct from known fields only.
  const result = {} as CanyonMergePolicy;
  for (const field of MERGEABLE_FIELD_NAMES) {
    result[field] = candidate[field] as "keepExisting" | "useIncoming";
  }
  return result;
}

type ImportRow = {
  data: BulkCanyonInput;
  resolution: { kind: "create" } | { kind: "merge"; canyonId: string };
};

type ImportRequest = {
  importBatchId: string;
  rows: ImportRow[];
  mergePolicy?: unknown;
};

// POST /canyons/bulk — idempotent file-import endpoint
router.post(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);

    const body = req.body as ImportRequest;

    if (!body.importBatchId || typeof body.importBatchId !== "string") {
      throw new AppError(400, "importBatchId is required");
    }
    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      throw new AppError(400, "rows array is required");
    }
    if (body.rows.length > BULK_IMPORT_LIMIT) {
      throw new AppError(413, `Cannot import more than ${BULK_IMPORT_LIMIT} canyons at once`);
    }

    const policy: CanyonMergePolicy = body.mergePolicy
      ? (validateMergePolicy(body.mergePolicy) ?? DEFAULT_CANYON_MERGE_POLICY)
      : DEFAULT_CANYON_MERGE_POLICY;

    // ---- Phase 1: Validate ALL rows before ANY write ----
    const errors: BulkError[] = [];

    type ValidatedRow = {
      rowIndex: number;
      data: BulkCanyonInput;
      importKey: string;
      resolution: ImportRow["resolution"];
    };

    const validRows: ValidatedRow[] = [];
    for (let i = 0; i < body.rows.length; i++) {
      const row = body.rows[i];
      if (!row.data || !row.resolution) {
        errors.push({ rowIndex: i, message: "data and resolution are required" });
        continue;
      }
      if (row.resolution.kind !== "create" && row.resolution.kind !== "merge") {
        errors.push({ rowIndex: i, message: 'resolution.kind must be "create" or "merge"' });
        continue;
      }
      if (row.resolution.kind === "merge" && !row.resolution.canyonId) {
        errors.push({ rowIndex: i, message: "resolution.canyonId is required for merge" });
        continue;
      }
      if (!validateInput(row.data, i, errors)) continue;

      const importKey = canyonImportKey(row.data.name, row.data.latitude, row.data.longitude);
      validRows.push({ rowIndex: i, data: row.data, importKey, resolution: row.resolution });
    }

    // Look up merge target canyons, scoped to the caller's own canyons. A target
    // owned by someone else simply isn't found — indistinguishable from a
    // nonexistent id — so the response can't confirm a canyon ID exists to a
    // non-owner (no 403-vs-not-found existence oracle).
    const mergeTargetIds = validRows
      .filter((r) => r.resolution.kind === "merge")
      .map((r) => (r.resolution as { kind: "merge"; canyonId: string }).canyonId);

    const mergeTargetLookup = mergeTargetIds.length > 0
      ? await prisma.canyon.findMany({
          where: { id: { in: mergeTargetIds }, ownerId: user.id },
          select: {
            id: true, ownerId: true, importKey: true,
            name: true, latitude: true, longitude: true, altNames: true,
            vGrade: true, aGrade: true, commitment: true, quality: true,
            numAbseils: true, longestAbseil: true, hours: true, notes: true,
            attributes: true,
          },
        })
      : [];
    const mergeTargetById = new Map(mergeTargetLookup.map((c) => [c.id, c]));

    // Validate merge targets. A target that doesn't exist OR isn't owned by the
    // caller is absent from the owner-scoped lookup above and rejected here as a
    // per-row error — the two cases are deliberately indistinguishable.
    const rowsAfterTargetCheck: ValidatedRow[] = [];
    for (const row of validRows) {
      if (row.resolution.kind === "merge") {
        const targetId = (row.resolution as { kind: "merge"; canyonId: string }).canyonId;
        const target = mergeTargetById.get(targetId);
        if (!target) {
          errors.push({ rowIndex: row.rowIndex, message: "target canyon not found" });
          continue;
        }
      }
      rowsAfterTargetCheck.push(row);
    }

    // Look up existing canyons by importKey for idempotency.
    const allImportKeys = rowsAfterTargetCheck.map((r) => r.importKey);
    const existingByKey = new Map<string, typeof mergeTargetLookup[number]>();
    if (allImportKeys.length > 0) {
      const existing = await prisma.canyon.findMany({
        where: { ownerId: user.id, importKey: { in: allImportKeys } },
        select: {
          id: true, ownerId: true, importKey: true,
          name: true, latitude: true, longitude: true, altNames: true,
          vGrade: true, aGrade: true, commitment: true, quality: true,
          numAbseils: true, longestAbseil: true, hours: true, notes: true,
          attributes: true,
        },
      });
      for (const row of existing) {
        if (row.importKey) existingByKey.set(row.importKey, row);
      }
    }

    // ---- Phase 2: Build operations ----
    type CreateOp = {
      kind: "create";
      data: Prisma.CanyonCreateManyInput;
    };
    type MergeOp = {
      kind: "merge";
      canyonId: string;
      mergedData: Record<string, unknown>;
      setImportKey: string | null; // Set importKey if canyon didn't have one.
    };

    const creates: CreateOp[] = [];
    const merges: MergeOp[] = [];
    // Tracks the create op already queued for a given importKey so a second
    // create row with the SAME importKey (identical/near-identical rows — common
    // in real spreadsheets) folds into the first instead of hitting the
    // (ownerId, importKey) unique constraint at write time (was a raw 500) — IMPORT-1.
    const createOpByKey = new Map<string, CreateOp>();
    let created = 0;
    let merged = 0;

    for (const row of rowsAfterTargetCheck) {
      const { data, importKey, resolution } = row;

      // Check if a canyon with this importKey already exists (idempotent).
      const existingCanyon = existingByKey.get(importKey);
      if (existingCanyon) {
        // Merge into existing — do NOT create, do NOT touch its importBatchId.
        // Cast attributes from Prisma JsonValue to Record<string, unknown> for mergeCanyon.
        const mergedResult = mergeCanyon(
          { ...existingCanyon, attributes: existingCanyon.attributes as Record<string, unknown> | null },
          data,
          policy,
        );
        merges.push({
          kind: "merge",
          canyonId: existingCanyon.id,
          mergedData: {
            altNames: mergedResult.altNames,
            vGrade: mergedResult.vGrade ?? null,
            aGrade: mergedResult.aGrade ?? null,
            commitment: mergedResult.commitment ?? null,
            quality: mergedResult.quality ?? null,
            numAbseils: mergedResult.numAbseils ?? null,
            longestAbseil: mergedResult.longestAbseil ?? null,
            hours: mergedResult.hours ?? null,
            notes: mergedResult.notes ?? null,
            attributes: mergedResult.attributes as Prisma.InputJsonValue,
          },
          setImportKey: null, // Already has an importKey.
        });
        merged++;
        continue;
      }

      if (resolution.kind === "merge") {
        // Merge into a specific pre-existing canyon.
        const targetId = (resolution as { kind: "merge"; canyonId: string }).canyonId;
        const target = mergeTargetById.get(targetId)!;
        const mergedResult = mergeCanyon(
          { ...target, attributes: target.attributes as Record<string, unknown> | null },
          data,
          policy,
        );
        merges.push({
          kind: "merge",
          canyonId: targetId,
          mergedData: {
            altNames: mergedResult.altNames,
            vGrade: mergedResult.vGrade ?? null,
            aGrade: mergedResult.aGrade ?? null,
            commitment: mergedResult.commitment ?? null,
            quality: mergedResult.quality ?? null,
            numAbseils: mergedResult.numAbseils ?? null,
            longestAbseil: mergedResult.longestAbseil ?? null,
            hours: mergedResult.hours ?? null,
            notes: mergedResult.notes ?? null,
            attributes: mergedResult.attributes as Prisma.InputJsonValue,
          },
          // Set importKey if currently null (so future re-imports are idempotent).
          // Do NOT set importBatchId (pre-existing row — must survive undo).
          setImportKey: target.importKey ? null : importKey,
        });
        merged++;
      } else {
        // Fold a duplicate create (same importKey within this request) into the
        // first one — fill nulls under the merge policy, keep name/lat/lng — so a
        // repeated row never collides on the unique constraint (IMPORT-1).
        const priorOp = createOpByKey.get(importKey);
        if (priorOp) {
          const folded = mergeCanyon(
            {
              name: priorOp.data.name,
              latitude: priorOp.data.latitude,
              longitude: priorOp.data.longitude,
              altNames: priorOp.data.altNames as string[] | undefined,
              attributes: priorOp.data.attributes as unknown as Record<string, unknown> | null,
              vGrade: priorOp.data.vGrade,
              aGrade: priorOp.data.aGrade,
              commitment: priorOp.data.commitment,
              quality: priorOp.data.quality,
              numAbseils: priorOp.data.numAbseils,
              longestAbseil: priorOp.data.longestAbseil,
              hours: priorOp.data.hours,
              notes: priorOp.data.notes,
            },
            data,
            policy,
          );
          priorOp.data.altNames = folded.altNames;
          priorOp.data.vGrade = (folded.vGrade ?? null) as number | null;
          priorOp.data.aGrade = (folded.aGrade ?? null) as number | null;
          priorOp.data.commitment = (folded.commitment ?? null) as number | null;
          priorOp.data.quality = (folded.quality ?? null) as number | null;
          priorOp.data.numAbseils = (folded.numAbseils ?? null) as number | null;
          priorOp.data.longestAbseil = (folded.longestAbseil ?? null) as number | null;
          priorOp.data.hours = (folded.hours ?? null) as number | null;
          priorOp.data.notes = (folded.notes ?? null) as string | null;
          priorOp.data.attributes = folded.attributes as Prisma.InputJsonValue;
          continue; // duplicate folded — not a separate create
        }

        // Create new canyon with importKey AND importBatchId.
        const createOp: CreateOp = {
          kind: "create",
          data: {
            ownerId: user.id,
            name: data.name.trim(),
            altNames: data.altNames ?? [],
            latitude: data.latitude,
            longitude: data.longitude,
            notes: data.notes ?? null,
            vGrade: data.vGrade ?? null,
            aGrade: data.aGrade ?? null,
            commitment: data.commitment ?? null,
            quality: data.quality ?? null,
            numAbseils: data.numAbseils ?? null,
            longestAbseil: data.longestAbseil ?? null,
            hours: data.hours ?? null,
            attributes: (data.attributes ?? {}) as Prisma.InputJsonValue,
            importKey,
            importBatchId: body.importBatchId,
          },
        };
        creates.push(createOp);
        createOpByKey.set(importKey, createOp);
        created++;
      }
    }

    // ---- Phase 3: Execute in chunked transactions (size 200) ----
    // Within-request duplicates are already folded above; a residual unique-
    // constraint clash can still happen if a concurrent import created the same
    // importKey between our idempotency lookup and this write (TOCTOU). Surface it
    // as a structured 409 instead of a raw 500 (IMPORT-1). No canyon name/coords
    // in the message (privacy rule).
    try {
      // Creates via createMany in chunks.
      for (let i = 0; i < creates.length; i += CHUNK_SIZE) {
        const chunk = creates.slice(i, i + CHUNK_SIZE);
        await prisma.canyon.createMany({
          data: chunk.map((op) => op.data),
        });
      }

      // Merges (updates) via batched $transaction.
      for (let i = 0; i < merges.length; i += CHUNK_SIZE) {
        const chunk = merges.slice(i, i + CHUNK_SIZE);
        await prisma.$transaction(
          chunk.map((op) =>
            prisma.canyon.update({
              where: { id: op.canyonId },
              data: {
                ...op.mergedData,
                ...(op.setImportKey ? { importKey: op.setImportKey } : {}),
              },
            }),
          ),
        );
      }
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new AppError(
          409,
          "Some of these canyons already exist or were just added. Reload your canyons and try the import again.",
        );
      }
      throw err;
    }

    res.json({
      batchId: body.importBatchId,
      created,
      merged,
      skipped: 0,
      errors,
    });
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

    const deletedIds = await deleteCanyonsCascade(user.id, ids as string[]);
    res.json({ deletedIds });
  },
);

export default router;
