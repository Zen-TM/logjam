import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import {
  fetchAndParseRopeWiki,
  snapshotFromCanyon,
  type RopeWikiSnapshot,
} from "../services/ropewiki";

const router = Router();

// POST /ropewiki/import — bulk-import RopeWiki canyons for the authenticated user
router.post(
  "/import",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    const { canyons: parsed, errors: parseErrors } =
      await fetchAndParseRopeWiki();

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
          notes: c.notes,
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

    const { canyons: parsed, errors: parseErrors } =
      await fetchAndParseRopeWiki();

    // Load all existing RopeWiki-sourced canyons for this user
    const existingCanyons = await prisma.canyon.findMany({
      where: { ownerId: user.id, ropeWikiId: { not: null } },
    });
    const existingByRwId = new Map(
      existingCanyons.map((c) => [c.ropeWikiId!, c]),
    );

    let added = 0;
    let updated = 0;
    let unchanged = 0;
    let userEdited = 0;

    for (const fresh of parsed) {
      const existing = existingByRwId.get(fresh.ropeWikiId);

      if (!existing) {
        // New canyon — create it
        await prisma.canyon.create({
          data: {
            ownerId: user.id,
            name: fresh.name,
            latitude: fresh.latitude,
            longitude: fresh.longitude,
            numAbseils: fresh.numAbseils,
            longestAbseil: fresh.longestAbseil,
            notes: fresh.notes,
            vGrade: fresh.vGrade,
            aGrade: fresh.aGrade,
            commitment: fresh.commitment,
            quality: fresh.quality,
            hours: fresh.hours,
            attributes: fresh.attributes,
            ropeWikiId: fresh.ropeWikiId,
            ropeWikiSnapshot: snapshotFromCanyon(fresh),
          },
        });
        added++;
        continue;
      }

      // Existing canyon — three-way merge
      const snapshot = (existing.ropeWikiSnapshot as RopeWikiSnapshot) || null;
      const freshSnapshot = snapshotFromCanyon(fresh);

      if (!snapshot) {
        // No snapshot (legacy import) — treat as user-edited, just store snapshot
        await prisma.canyon.update({
          where: { id: existing.id },
          data: { ropeWikiSnapshot: freshSnapshot },
        });
        userEdited++;
        continue;
      }

      // Check if user has edited any field by comparing current values to snapshot
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
        // User edited — keep their values, just update the snapshot
        await prisma.canyon.update({
          where: { id: existing.id },
          data: { ropeWikiSnapshot: freshSnapshot },
        });
        userEdited++;
      } else {
        // User never touched it — check if RopeWiki data changed
        const rwChanged =
          JSON.stringify(freshSnapshot) !== JSON.stringify(snapshot);

        if (rwChanged) {
          await prisma.canyon.update({
            where: { id: existing.id },
            data: {
              name: fresh.name,
              latitude: fresh.latitude,
              longitude: fresh.longitude,
              numAbseils: fresh.numAbseils,
              longestAbseil: fresh.longestAbseil,
              vGrade: fresh.vGrade,
              aGrade: fresh.aGrade,
              commitment: fresh.commitment,
              quality: fresh.quality,
              hours: fresh.hours,
              attributes: fresh.attributes,
              ropeWikiSnapshot: freshSnapshot,
            },
          });
          updated++;
        } else {
          unchanged++;
        }
      }
    }

    res.json({
      added,
      updated,
      unchanged,
      userEdited,
      errors: parseErrors,
    });
  },
);

export default router;
