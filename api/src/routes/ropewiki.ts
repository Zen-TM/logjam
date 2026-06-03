import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { ropeWikiHeavyLimiter } from "../middleware/rateLimit";
import {
  snapshotFromCreate,
  snapshotFromLink,
  snapshotsEqual,
  isRopeWikiOwned,
  attributesSourcesEqual,
  ROPE_WIKI_OWNABLE_FIELDS,
  type RopeWikiCanyon,
  type RopeWikiSnapshot,
  type RopeWikiOwnableField,
} from "../services/ropewiki";
import { getRopeWikiCanyons } from "../services/ropeWikiCache";
import {
  buildProposals,
  mergeFillNulls,
  type DedupeProposal,
} from "../services/ropewikiDedupe";
import { matchOzUltimateUrl } from "@logjam/shared";

const router = Router();

const UPDATE_CHUNK_SIZE = 200;

// Returns a copy of rw with OzUltimate source unioned into attributes.sources.
function withOzUltimate(rw: RopeWikiCanyon, altNames: string[] = []): RopeWikiCanyon {
  const ozUrl = matchOzUltimateUrl(rw.name, altNames);
  if (!ozUrl) return rw;
  const existing = rw.attributes?.sources ?? [];
  if (existing.some(([, u]) => u === ozUrl)) return rw;
  return {
    ...rw,
    attributes: {
      ...rw.attributes,
      sources: [...existing, ["OzUltimate", ozUrl] as [string, string]],
    },
  };
}

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
        const c = withOzUltimate(parsedByRwId.get(p.ropeWikiId)!);
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
          ropeWikiSnapshot: snapshotFromCreate(c),
        };
      }),
      skipDuplicates: true,
    });
  }

  if (toAutoLink.length > 0) {
    const updates = toAutoLink.map((p) => {
      const rawFresh = parsedByRwId.get(p.ropeWikiId);
      if (!rawFresh)
        throw new AppError(500, `Missing parsed RopeWiki canyon for id ${p.ropeWikiId}`);
      if (!p.bestCanyonId)
        throw new AppError(500, `Auto-link proposal for RopeWiki id ${p.ropeWikiId} has no bestCanyonId`);
      const existing = existingByCanyonId.get(p.bestCanyonId);
      if (!existing)
        throw new AppError(500, `Missing existing canyon for id ${p.bestCanyonId}`);
      const fresh = withOzUltimate(rawFresh, existing.altNames);
      const merged = mergeFillNulls(existing, fresh);
      const { ropeWikiOwnedFields, ...mergedFields } = merged;
      return prisma.canyon.update({
        where: { id: existing.id },
        data: {
          ...mergedFields,
          ropeWikiSnapshot: snapshotFromLink(fresh, ropeWikiOwnedFields),
        },
      });
    });
    for (let i = 0; i < updates.length; i += UPDATE_CHUNK_SIZE) {
      await prisma.$transaction(updates.slice(i, i + UPDATE_CHUNK_SIZE));
    }
  }

  const review: ReviewCandidatePayload[] = toReview.map((p) => {
    const rw = parsedByRwId.get(p.ropeWikiId);
    if (!rw)
      throw new AppError(500, `Missing parsed RopeWiki canyon for id ${p.ropeWikiId}`);
    return {
      ropeWikiId: p.ropeWikiId,
      rw,
      candidates: p.candidates.map((s) => {
        const existing = existingByCanyonId.get(s.canyonId);
        if (!existing)
          throw new AppError(500, `Missing existing canyon for id ${s.canyonId}`);
        return {
          canyonId: existing.id,
          name: existing.name,
          latitude: existing.latitude,
          longitude: existing.longitude,
          distanceMeters: Math.round(s.distanceMeters),
          nameMatch: s.nameMatch,
        };
      }),
    };
  });

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
      const freshWithOz = withOzUltimate(fresh, target.altNames);
      const merged = mergeFillNulls(target, freshWithOz);
      const { ropeWikiOwnedFields, ...mergedFields } = merged;
      updates.push(
        prisma.canyon.update({
          where: { id: target.id },
          data: {
            ...mergedFields,
            ropeWikiSnapshot: snapshotFromLink(freshWithOz, ropeWikiOwnedFields),
          },
        }),
      );
      linked++;
    }

    if (toCreateRows.length > 0) {
      await prisma.canyon.createMany({
        data: toCreateRows.map((rawC) => {
          const c = withOzUltimate(rawC);
          return {
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
            ropeWikiSnapshot: snapshotFromCreate(c),
          };
        }),
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

    type RefreshUpdate = {
      id: string;
      previousUpdatedAt: Date;
      canyonData: Partial<{
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
      }>;
      newSnapshot: RopeWikiSnapshot;
      canyonDataChanged: boolean;
    };

    const toCreate: typeof parsed = [];
    const toUpdate: RefreshUpdate[] = [];
    let unchanged = 0;

    for (const freshC of parsed) {
      const existing = existingByRwId.get(freshC.ropeWikiId);

      if (!existing) {
        toCreate.push(freshC);
        continue;
      }

      const rawSnapshot = existing.ropeWikiSnapshot as RopeWikiSnapshot | null;
      const freshWithOz = withOzUltimate(freshC, existing.altNames);
      const freshSnapshot = {
        name: freshWithOz.name,
        latitude: freshWithOz.latitude,
        longitude: freshWithOz.longitude,
        numAbseils: freshWithOz.numAbseils,
        longestAbseil: freshWithOz.longestAbseil,
        vGrade: freshWithOz.vGrade,
        aGrade: freshWithOz.aGrade,
        commitment: freshWithOz.commitment,
        quality: freshWithOz.quality,
        hours: freshWithOz.hours,
        attributes: { ...freshWithOz.attributes },
      };

      if (!rawSnapshot) {
        // Legacy import without snapshot — treat all fields as RopeWiki-owned,
        // auto-heal by storing a snapshot with "*" ownership on next refresh.
        const legacySnapshot: RopeWikiSnapshot = {
          ...freshSnapshot,
          ropeWikiOwnedFields: "*",
        };
        toUpdate.push({
          id: existing.id,
          previousUpdatedAt: existing.updatedAt,
          canyonData: {},
          newSnapshot: legacySnapshot,
          canyonDataChanged: false,
        });
        continue;
      }

      // Treat missing ropeWikiOwnedFields as "*" (legacy snapshot shape).
      const effectiveOwnership: RopeWikiOwnableField[] | "*" =
        rawSnapshot.ropeWikiOwnedFields ?? "*";
      const effectiveSnapshot: RopeWikiSnapshot = {
        ...rawSnapshot,
        ropeWikiOwnedFields: effectiveOwnership,
      };

      // Per-field: check user edits and RopeWiki upstream changes.
      const canyonData: Record<string, unknown> = {};
      const newOwnedFields: RopeWikiOwnableField[] =
        effectiveOwnership === "*" ? [...ROPE_WIKI_OWNABLE_FIELDS] : [...effectiveOwnership];

      for (const field of ROPE_WIKI_OWNABLE_FIELDS) {
        const existingVal = existing[field];
        const snapshotVal = effectiveSnapshot[field];
        const freshVal = freshWithOz[field];

        if (isRopeWikiOwned(effectiveSnapshot, field)) {
          if (existingVal !== snapshotVal) {
            // User edited this field — drop from ownership mask, don't overwrite.
            const idx = newOwnedFields.indexOf(field);
            if (idx !== -1) newOwnedFields.splice(idx, 1);
          } else if (freshVal !== snapshotVal) {
            // RopeWiki changed this field and user hasn't touched it — update.
            canyonData[field] = freshVal;
          }
        }
        // user-owned fields: never overwrite.
      }

      // Sources: always union (no ownership semantics).
      const existingAttrs = existing.attributes as { sources?: [string, string][] } | null;
      const existingSources = existingAttrs?.sources ?? [];
      const freshSources = freshWithOz.attributes?.sources ?? [];
      const mergedSources = [...existingSources];
      for (const [label, url] of freshSources) {
        if (!mergedSources.some(([, u]) => u === url)) mergedSources.push([label, url]);
      }
      const sourcesChanged = !attributesSourcesEqual(existingAttrs, { sources: mergedSources.length ? mergedSources : undefined });
      if (sourcesChanged) {
        canyonData["attributes"] = {
          ...(existing.attributes as object ?? {}),
          sources: mergedSources.length ? mergedSources : undefined,
        };
      }

      const newSnapshot: RopeWikiSnapshot = {
        ...freshSnapshot,
        ropeWikiOwnedFields: newOwnedFields,
      };

      const canyonDataChanged = Object.keys(canyonData).length > 0;
      const ownershipChanged =
        effectiveOwnership === "*"
          ? newOwnedFields.length !== ROPE_WIKI_OWNABLE_FIELDS.length
          : JSON.stringify([...newOwnedFields].sort()) !==
            JSON.stringify([...effectiveOwnership].sort());
      const snapshotValuesChanged = !snapshotsEqual(
        { ...freshSnapshot, ropeWikiOwnedFields: newOwnedFields },
        effectiveSnapshot,
      );

      if (!canyonDataChanged && !ownershipChanged && !snapshotValuesChanged) {
        unchanged++;
        continue;
      }

      toUpdate.push({
        id: existing.id,
        previousUpdatedAt: existing.updatedAt,
        canyonData,
        newSnapshot,
        canyonDataChanged,
      });
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

    const updated = toUpdate.filter((u) => u.canyonDataChanged).length;

    // Chunked transaction updates (different data per row → can't updateMany)
    const allUpdates = toUpdate.map((u) =>
      prisma.canyon.update({
        where: { id: u.id },
        data: {
          ...u.canyonData,
          ropeWikiSnapshot: u.newSnapshot,
          // Don't bump updatedAt if only snapshot/ownership changed (no user-visible data changed).
          ...(u.canyonDataChanged ? {} : { updatedAt: u.previousUpdatedAt }),
        },
      }),
    );
    for (let i = 0; i < allUpdates.length; i += UPDATE_CHUNK_SIZE) {
      await prisma.$transaction(allUpdates.slice(i, i + UPDATE_CHUNK_SIZE));
    }

    res.json({
      added: toCreate.length - autoLinkedFromRefresh - review.length,
      autoLinked: autoLinkedFromRefresh,
      review,
      updated,
      unchanged,
      userEdited: toUpdate.filter((u) => !u.canyonDataChanged).length,
      errors: parseErrors,
    });
  },
);

export default router;
