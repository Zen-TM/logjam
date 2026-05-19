import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { Prisma } from "@prisma/client";

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
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

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

      // validate + ownership-check all rows before any writes
      const validReplacements: { canyonId: string; data: BulkCanyonInput }[] = [];
      for (let i = 0; i < replacements.length; i++) {
        const { canyonId, data } = replacements[i];
        if (!canyonId) {
          errors.push({ rowIndex: i, message: `Row ${i}: canyonId is required` });
          continue;
        }
        if (!validateInput(data, i, errors)) continue;

        const existing = await prisma.canyon.findUnique({ where: { id: canyonId } });
        if (!existing) {
          errors.push({ rowIndex: i, message: `Row ${i}: canyon not found` });
          continue;
        }
        if (existing.ownerId !== user.id) {
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

export default router;
