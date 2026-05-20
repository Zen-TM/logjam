import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { snapshotFromCanyon, type RopeWikiSnapshot } from "../services/ropewiki";
import { getRopeWikiCanyons } from "../services/ropeWikiCache";

const router = Router();

const UPDATE_CHUNK_SIZE = 200;

// POST /ropewiki/import — bulk-import RopeWiki canyons for the authenticated user
router.post(
  "/import",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    const fresh = req.query.fresh === "true";
    const { canyons: parsed, errors: parseErrors } =
      await getRopeWikiCanyons(fresh);

    // Find which RopeWiki IDs this user already has
    const existing = await prisma.canyon.findMany({
      where: { ownerId: user.id, ropeWikiId: { not: null } },
      select: { ropeWikiId: true },
    });
    const existingIds = new Set(existing.map((c) => c.ropeWikiId));

    const toCreate = parsed.filter((c) => !existingIds.has(c.ropeWikiId));

    if (toCreate.length > 0) {
      await prisma.canyon.createMany({
        data: toCreate.map((c) => ({
          ownerId: user.id,
          name: c.name,
          latitude: c.latitude,
          longitude: c.longitude,
          numAbseils: c.numAbseils,
          longestAbseil: c.longestAbseil,
          vGrade: c.vGrade,
          aGrade: c.aGrade,
          commitment: c.commitment,
          quality: c.quality,
          hours: c.hours,
          attributes: c.attributes,
          ropeWikiId: c.ropeWikiId,
          ropeWikiSnapshot: snapshotFromCanyon(c),
        })),
        skipDuplicates: true,
      });
    }

    res.json({
      imported: toCreate.length,
      skipped: parsed.length - toCreate.length,
      errors: parseErrors,
    });
  },
);

// POST /ropewiki/refresh — re-fetch CSV and update non-edited canyons, add new ones
router.post(
  "/refresh",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    const fresh = req.query.fresh === "true";
    const { canyons: parsed, errors: parseErrors } =
      await getRopeWikiCanyons(fresh);

    // Load all existing RopeWiki-sourced canyons for this user
    const existingCanyons = await prisma.canyon.findMany({
      where: { ownerId: user.id, ropeWikiId: { not: null } },
    });
    const existingByRwId = new Map(
      existingCanyons.map((c) => [c.ropeWikiId!, c]),
    );

    type SnapshotOnly = { id: string; snapshot: RopeWikiSnapshot };
    type FullUpdate = {
      id: string;
      data: {
        name: string;
        latitude: number;
        longitude: number;
        numAbseils: number | null;
        longestAbseil: number | null;
        vGrade: number | null;
        aGrade: number | null;
        commitment: number | null;
        quality: number | null;
        hours: number | null;
        attributes: object;
        ropeWikiSnapshot: RopeWikiSnapshot;
      };
    };

    const toCreate: typeof parsed = [];
    const toUpdateSnapshotOnly: SnapshotOnly[] = [];
    const toUpdateAll: FullUpdate[] = [];
    let unchanged = 0;

    for (const freshC of parsed) {
      const existing = existingByRwId.get(freshC.ropeWikiId);

      if (!existing) {
        toCreate.push(freshC);
        continue;
      }

      const snapshot = (existing.ropeWikiSnapshot as RopeWikiSnapshot) || null;
      const freshSnapshot = snapshotFromCanyon(freshC);

      if (!snapshot) {
        // Legacy import w/o snapshot — treat as user-edited, just store snapshot
        toUpdateSnapshotOnly.push({ id: existing.id, snapshot: freshSnapshot });
        continue;
      }

      const edited =
        existing.name !== snapshot.name ||
        existing.latitude !== snapshot.latitude ||
        existing.longitude !== snapshot.longitude ||
        existing.numAbseils !== snapshot.numAbseils ||
        existing.longestAbseil !== snapshot.longestAbseil ||
        existing.vGrade !== snapshot.vGrade ||
        existing.aGrade !== snapshot.aGrade ||
        existing.commitment !== snapshot.commitment ||
        existing.quality !== snapshot.quality ||
        existing.hours !== snapshot.hours ||
        JSON.stringify(existing.attributes) !==
          JSON.stringify(snapshot.attributes);

      if (edited) {
        toUpdateSnapshotOnly.push({ id: existing.id, snapshot: freshSnapshot });
        continue;
      }

      const rwChanged = JSON.stringify(freshSnapshot) !== JSON.stringify(snapshot);
      if (rwChanged) {
        toUpdateAll.push({
          id: existing.id,
          data: {
            name: freshC.name,
            latitude: freshC.latitude,
            longitude: freshC.longitude,
            numAbseils: freshC.numAbseils,
            longestAbseil: freshC.longestAbseil,
            vGrade: freshC.vGrade,
            aGrade: freshC.aGrade,
            commitment: freshC.commitment,
            quality: freshC.quality,
            hours: freshC.hours,
            attributes: freshC.attributes,
            ropeWikiSnapshot: freshSnapshot,
          },
        });
      } else {
        unchanged++;
      }
    }

    // Bulk create new canyons
    if (toCreate.length > 0) {
      await prisma.canyon.createMany({
        data: toCreate.map((c) => ({
          ownerId: user.id,
          name: c.name,
          latitude: c.latitude,
          longitude: c.longitude,
          numAbseils: c.numAbseils,
          longestAbseil: c.longestAbseil,
          vGrade: c.vGrade,
          aGrade: c.aGrade,
          commitment: c.commitment,
          quality: c.quality,
          hours: c.hours,
          attributes: c.attributes,
          ropeWikiId: c.ropeWikiId,
          ropeWikiSnapshot: snapshotFromCanyon(c),
        })),
        skipDuplicates: true,
      });
    }

    // Chunked transaction updates (different data per row → can't updateMany)
    const allUpdates = [
      ...toUpdateAll.map((u) =>
        prisma.canyon.update({ where: { id: u.id }, data: u.data }),
      ),
      ...toUpdateSnapshotOnly.map((u) =>
        prisma.canyon.update({
          where: { id: u.id },
          data: { ropeWikiSnapshot: u.snapshot },
        }),
      ),
    ];
    for (let i = 0; i < allUpdates.length; i += UPDATE_CHUNK_SIZE) {
      await prisma.$transaction(allUpdates.slice(i, i + UPDATE_CHUNK_SIZE));
    }

    res.json({
      added: toCreate.length,
      updated: toUpdateAll.length,
      unchanged,
      userEdited: toUpdateSnapshotOnly.length,
      errors: parseErrors,
    });
  },
);

export default router;
