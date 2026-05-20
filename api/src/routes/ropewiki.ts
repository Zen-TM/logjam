import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { ropeWikiHeavyLimiter } from "../middleware/rateLimit";
import {
  snapshotFromCanyon,
  type RopeWikiCanyon,
  type RopeWikiSnapshot,
} from "../services/ropewiki";
import { getRopeWikiCanyons } from "../services/ropeWikiCache";
import {
  buildProposals,
  mergeFillNulls,
  type DedupeProposal,
} from "../services/ropewikiDedupe";

const router = Router();

const UPDATE_CHUNK_SIZE = 200;

type ReviewCandidatePayload = {
  ropeWikiId: number;
  rw: RopeWikiCanyon;
  candidates: {
    canyonId: string;
    name: string;
    latitude: number;
    longitude: number;
    distanceMeters: number;
    nameMatch: boolean;
  }[];
};

async function loadUser(sub: string) {
  const user = await prisma.user.findUnique({ where: { cognitoId: sub } });
  if (!user) throw new AppError(404, "User not found");
  return user;
}

async function applyAutoLinkAndCreate(
  ownerId: string,
  parsed: RopeWikiCanyon[],
  proposals: DedupeProposal[],
  existingByCanyonId: Map<string, import("@prisma/client").Canyon>,
): Promise<{
  imported: number;
  autoLinked: number;
  review: ReviewCandidatePayload[];
}> {
  const parsedByRwId = new Map(parsed.map((c) => [c.ropeWikiId, c]));

  const toAutoLink = proposals.filter((p) => p.tier === "autoLink");
  const toCreate = proposals.filter((p) => p.tier === "create");
  const toReview = proposals.filter((p) => p.tier === "review");

  if (toCreate.length > 0) {
    await prisma.canyon.createMany({
      data: toCreate.map((p) => {
        const c = parsedByRwId.get(p.ropeWikiId)!;
        return {
          ownerId,
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
        };
      }),
      skipDuplicates: true,
    });
  }

  if (toAutoLink.length > 0) {
    const updates = toAutoLink.map((p) => {
      const fresh = parsedByRwId.get(p.ropeWikiId)!;
      const existing = existingByCanyonId.get(p.bestCanyonId!)!;
      return prisma.canyon.update({
        where: { id: existing.id },
        data: {
          ...mergeFillNulls(existing, fresh),
          ropeWikiSnapshot: snapshotFromCanyon(fresh),
        },
      });
    });
    for (let i = 0; i < updates.length; i += UPDATE_CHUNK_SIZE) {
      await prisma.$transaction(updates.slice(i, i + UPDATE_CHUNK_SIZE));
    }
  }

  const review: ReviewCandidatePayload[] = toReview.map((p) => ({
    ropeWikiId: p.ropeWikiId,
    rw: parsedByRwId.get(p.ropeWikiId)!,
    candidates: p.candidates.map((s) => {
      const existing = existingByCanyonId.get(s.canyonId)!;
      return {
        canyonId: existing.id,
        name: existing.name,
        latitude: existing.latitude,
        longitude: existing.longitude,
        distanceMeters: Math.round(s.distanceMeters),
        nameMatch: s.nameMatch,
      };
    }),
  }));

  return {
    imported: toCreate.length,
    autoLinked: toAutoLink.length,
    review,
  };
}

// POST /ropewiki/import — first-pass import. Auto-links high-confidence
// matches against the user's existing canyons, inserts no-match rows, and
// returns mid-confidence rows for client-side review (no mutation for
// those). Already-linked RopeWiki rows are skipped.
router.post(
  "/import",
  requireAuth,
  ropeWikiHeavyLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await loadUser(req.user!.sub);

    const fresh = req.query.fresh === "true";
    const { canyons: parsed, errors: parseErrors } =
      await getRopeWikiCanyons(fresh);

    const allUserCanyons = await prisma.canyon.findMany({
      where: { ownerId: user.id },
    });
    const linkedRwIds = new Set(
      allUserCanyons
        .filter((c) => c.ropeWikiId !== null)
        .map((c) => c.ropeWikiId!),
    );
    const candidatePool = allUserCanyons.filter((c) => c.ropeWikiId === null);
    const existingByCanyonId = new Map(candidatePool.map((c) => [c.id, c]));

    const toProcess = parsed.filter((c) => !linkedRwIds.has(c.ropeWikiId));
    const skipped = parsed.length - toProcess.length;

    const proposals = buildProposals(toProcess, candidatePool);
    const result = await applyAutoLinkAndCreate(
      user.id,
      toProcess,
      proposals,
      existingByCanyonId,
    );

    res.json({
      imported: result.imported,
      autoLinked: result.autoLinked,
      skipped,
      review: result.review,
      errors: parseErrors,
    });
  },
);

type ApplyDecision = {
  ropeWikiId: number;
  action: "link" | "create" | "skip";
  targetCanyonId?: string;
};

// POST /ropewiki/import/apply — resolve review-tier decisions returned from
// /import. Each decision either links the RopeWiki canyon onto an existing
// user canyon (fill-nulls merge), creates a new canyon, or skips.
router.post(
  "/import/apply",
  requireAuth,
  ropeWikiHeavyLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await loadUser(req.user!.sub);

    const decisions = req.body?.decisions;
    if (!Array.isArray(decisions)) {
      throw new AppError(400, "decisions must be an array");
    }
    const normalized: ApplyDecision[] = decisions.map((d, i) => {
      if (
        typeof d?.ropeWikiId !== "number" ||
        !["link", "create", "skip"].includes(d?.action)
      ) {
        throw new AppError(400, `Invalid decision at index ${i}`);
      }
      if (d.action === "link" && typeof d.targetCanyonId !== "string") {
        throw new AppError(
          400,
          `link decision at index ${i} missing targetCanyonId`,
        );
      }
      return {
        ropeWikiId: d.ropeWikiId,
        action: d.action,
        targetCanyonId: d.targetCanyonId,
      };
    });

    const { canyons: parsed, errors: parseErrors } =
      await getRopeWikiCanyons(false);
    const parsedByRwId = new Map(parsed.map((c) => [c.ropeWikiId, c]));

    const targetIds = normalized
      .filter((d) => d.action === "link" && d.targetCanyonId)
      .map((d) => d.targetCanyonId!);
    const targets = targetIds.length
      ? await prisma.canyon.findMany({
          where: { id: { in: targetIds }, ownerId: user.id },
        })
      : [];
    const targetById = new Map(targets.map((t) => [t.id, t]));

    let linked = 0;
    let created = 0;
    let skipped = 0;
    const errors: string[] = [...parseErrors];

    const toCreateRows: RopeWikiCanyon[] = [];
    const updates: ReturnType<typeof prisma.canyon.update>[] = [];

    for (const d of normalized) {
      const fresh = parsedByRwId.get(d.ropeWikiId);
      if (!fresh) {
        errors.push(
          `ropeWikiId ${d.ropeWikiId} not found in current RopeWiki data`,
        );
        continue;
      }
      if (d.action === "skip") {
        skipped++;
        continue;
      }
      if (d.action === "create") {
        toCreateRows.push(fresh);
        continue;
      }
      // link
      const target = targetById.get(d.targetCanyonId!);
      if (!target) {
        errors.push(`Target canyon ${d.targetCanyonId} not owned by user`);
        continue;
      }
      if (target.ropeWikiId !== null) {
        errors.push(
          `Target canyon ${target.id} already linked to a RopeWiki page`,
        );
        continue;
      }
      updates.push(
        prisma.canyon.update({
          where: { id: target.id },
          data: {
            ...mergeFillNulls(target, fresh),
            ropeWikiSnapshot: snapshotFromCanyon(fresh),
          },
        }),
      );
      linked++;
    }

    if (toCreateRows.length > 0) {
      await prisma.canyon.createMany({
        data: toCreateRows.map((c) => ({
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
      created = toCreateRows.length;
    }

    for (let i = 0; i < updates.length; i += UPDATE_CHUNK_SIZE) {
      await prisma.$transaction(updates.slice(i, i + UPDATE_CHUNK_SIZE));
    }

    res.json({ linked, created, skipped, errors });
  },
);

// POST /ropewiki/refresh — re-fetch CSV and update non-edited canyons, add new ones
router.post(
  "/refresh",
  requireAuth,
  ropeWikiHeavyLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await loadUser(req.user!.sub);

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

    // Run dedupe on the "new from RopeWiki" rows against user's non-RW
    // canyons. Auto-link high confidence, return review tier, create the rest.
    let autoLinkedFromRefresh = 0;
    let review: ReviewCandidatePayload[] = [];
    if (toCreate.length > 0) {
      const candidatePool = await prisma.canyon.findMany({
        where: { ownerId: user.id, ropeWikiId: null },
      });
      const existingByCanyonId = new Map(candidatePool.map((c) => [c.id, c]));
      const proposals = buildProposals(toCreate, candidatePool);
      const result = await applyAutoLinkAndCreate(
        user.id,
        toCreate,
        proposals,
        existingByCanyonId,
      );
      autoLinkedFromRefresh = result.autoLinked;
      review = result.review;
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
      added: toCreate.length - autoLinkedFromRefresh - review.length,
      autoLinked: autoLinkedFromRefresh,
      review,
      updated: toUpdateAll.length,
      unchanged,
      userEdited: toUpdateSnapshotOnly.length,
      errors: parseErrors,
    });
  },
);

export default router;
