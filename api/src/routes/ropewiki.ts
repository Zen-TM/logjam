import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { ropeWikiHeavyLimiter } from "../middleware/rateLimit";
import { resolveUser as loadUser } from "../lib/resolveUser";
import {
  snapshotFromCreate,
  snapshotFromLink,
  snapshotsEqual,
  isRopeWikiOwned,
  attributesSourcesEqual,
  ROPE_WIKI_FIELD_KEYS,
  ROPE_WIKI_OWNABLE_FIELDS,
  ropeWikiFieldValues,
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
import {
  asFieldValues,
  fieldValue,
  matchOzUltimateUrl,
  SOURCES_FIELD_KEY,
  SYSTEM_PLACE_TYPE_IDS,
} from "@logjam/shared";
import { Prisma } from "@prisma/client";

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
    placeId: string;
    name: string;
    latitude: number;
    longitude: number;
    distanceMeters: number;
    nameMatch: boolean;
  }[];
};

async function applyAutoLinkAndCreate(
  ownerId: string,
  parsed: RopeWikiCanyon[],
  proposals: DedupeProposal[],
  existingByPlaceId: Map<string, import("@prisma/client").Place>,
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
    await prisma.place.createMany({
      data: toCreate.map((p) => {
        const c = withOzUltimate(parsedByRwId.get(p.ropeWikiId)!);
        return {
          ownerId,
          // RopeWiki is a CANYON source, hardwired to the system Canyon type.
          // It stays canyon-specific through the places rework (plan §5.2) —
          // there is no generic form of a V grade.
          placeTypeId: SYSTEM_PLACE_TYPE_IDS.canyon,
          name: c.name,
          latitude: c.latitude,
          longitude: c.longitude,
          fieldValues: ropeWikiFieldValues(c) as Prisma.InputJsonValue,
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
        throw new AppError(500, `Missing parsed RopeWiki place for id ${p.ropeWikiId}`);
      if (!p.bestPlaceId)
        throw new AppError(500, `Auto-link proposal for RopeWiki id ${p.ropeWikiId} has no bestPlaceId`);
      const existing = existingByPlaceId.get(p.bestPlaceId);
      if (!existing)
        throw new AppError(500, `Missing existing place for id ${p.bestPlaceId}`);
      const fresh = withOzUltimate(rawFresh, existing.altNames);
      const merged = mergeFillNulls(existing, fresh);
      const { ropeWikiOwnedFields, fieldValues, ropeWikiId } = merged;
      return prisma.place.update({
        where: { id: existing.id },
        data: {
          ropeWikiId,
          fieldValues: fieldValues as Prisma.InputJsonValue,
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
      throw new AppError(500, `Missing parsed RopeWiki place for id ${p.ropeWikiId}`);
    return {
      ropeWikiId: p.ropeWikiId,
      rw,
      candidates: p.candidates.map((s) => {
        const existing = existingByPlaceId.get(s.placeId);
        if (!existing)
          throw new AppError(500, `Missing existing place for id ${s.placeId}`);
        return {
          placeId: existing.id,
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
// matches against the user's existing places, inserts no-match rows, and
// returns mid-confidence rows for client-side review (no mutation for
// those). Already-linked RopeWiki rows are skipped.
router.post(
  "/import",
  requireAuth,
  ropeWikiHeavyLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await loadUser(req.user!.sub);

    const fresh = req.query.fresh === "true";
    const {
      places: parsed,
      errors: parseErrors,
      sourceUpdatedAt,
    } = await getRopeWikiCanyons(fresh);

    const allUserPlaces = await prisma.place.findMany({
      where: { ownerId: user.id },
    });
    const linkedRwIds = new Set(
      allUserPlaces
        .filter((c) => c.ropeWikiId !== null)
        .map((c) => c.ropeWikiId!),
    );
    const candidatePool = allUserPlaces.filter((c) => c.ropeWikiId === null);
    const existingByPlaceId = new Map(candidatePool.map((c) => [c.id, c]));

    const toProcess = parsed.filter((c) => !linkedRwIds.has(c.ropeWikiId));
    const skipped = parsed.length - toProcess.length;

    const proposals = buildProposals(toProcess, candidatePool);
    const result = await applyAutoLinkAndCreate(
      user.id,
      toProcess,
      proposals,
      existingByPlaceId,
    );

    res.json({
      imported: result.imported,
      autoLinked: result.autoLinked,
      skipped,
      review: result.review,
      errors: parseErrors,
      sourceUpdatedAt,
    });
  },
);

type ApplyDecision = {
  ropeWikiId: number;
  action: "link" | "create" | "skip";
  targetPlaceId?: string;
};

// Cap decisions per request: each one does a target lookup plus a chunked
// update write, so an unbounded array turns one call into thousands of writes.
// Same both-ends contract as the other bulk endpoints (0 → 400, over cap → 413,
// SEC-001); the RopeWiki corpus is far smaller than this.
const APPLY_DECISION_LIMIT = 2000;

// POST /ropewiki/import/apply — resolve review-tier decisions returned from
// /import. Each decision either links the RopeWiki place onto an existing
// user place (fill-nulls merge), creates a new place, or skips.
router.post(
  "/import/apply",
  requireAuth,
  ropeWikiHeavyLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await loadUser(req.user!.sub);

    const decisions = req.body?.decisions;
    if (!Array.isArray(decisions) || decisions.length === 0) {
      throw new AppError(400, "decisions must be a non-empty array");
    }
    if (decisions.length > APPLY_DECISION_LIMIT) {
      throw new AppError(
        413,
        `Cannot apply more than ${APPLY_DECISION_LIMIT} decisions at once`,
      );
    }
    const normalized: ApplyDecision[] = decisions.map((d, i) => {
      if (
        typeof d?.ropeWikiId !== "number" ||
        !["link", "create", "skip"].includes(d?.action)
      ) {
        throw new AppError(400, `Invalid decision at index ${i}`);
      }
      if (d.action === "link" && typeof d.targetPlaceId !== "string") {
        throw new AppError(
          400,
          `link decision at index ${i} missing targetPlaceId`,
        );
      }
      return {
        ropeWikiId: d.ropeWikiId,
        action: d.action,
        targetPlaceId: d.targetPlaceId,
      };
    });

    const {
      places: parsed,
      errors: parseErrors,
      sourceUpdatedAt,
    } = await getRopeWikiCanyons(false);
    const parsedByRwId = new Map(parsed.map((c) => [c.ropeWikiId, c]));

    const targetIds = normalized
      .filter((d) => d.action === "link" && d.targetPlaceId)
      .map((d) => d.targetPlaceId!);
    const targets = targetIds.length
      ? await prisma.place.findMany({
          where: { id: { in: targetIds }, ownerId: user.id },
        })
      : [];
    const targetById = new Map(targets.map((t) => [t.id, t]));

    let linked = 0;
    let created = 0;
    let skipped = 0;
    const errors: string[] = [...parseErrors];

    const toCreateRows: RopeWikiCanyon[] = [];
    const updates: ReturnType<typeof prisma.place.update>[] = [];

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
      const target = targetById.get(d.targetPlaceId!);
      if (!target) {
        errors.push(`Target place ${d.targetPlaceId} not owned by user`);
        continue;
      }
      if (target.ropeWikiId !== null) {
        errors.push(
          `Target place ${target.id} already linked to a RopeWiki page`,
        );
        continue;
      }
      const freshWithOz = withOzUltimate(fresh, target.altNames);
      const merged = mergeFillNulls(target, freshWithOz);
      const { ropeWikiOwnedFields, fieldValues, ropeWikiId } = merged;
      updates.push(
        prisma.place.update({
          where: { id: target.id },
          data: {
            ropeWikiId,
            fieldValues: fieldValues as Prisma.InputJsonValue,
            ropeWikiSnapshot: snapshotFromLink(freshWithOz, ropeWikiOwnedFields),
          },
        }),
      );
      linked++;
    }

    if (toCreateRows.length > 0) {
      await prisma.place.createMany({
        data: toCreateRows.map((rawC) => {
          const c = withOzUltimate(rawC);
          return {
            ownerId: user.id,
            // RopeWiki is a CANYON source, hardwired to the system Canyon type.
            // It stays canyon-specific through the places rework (plan §5.2) —
            // there is no generic form of a V grade.
            placeTypeId: SYSTEM_PLACE_TYPE_IDS.canyon,
            name: c.name,
            latitude: c.latitude,
            longitude: c.longitude,
            fieldValues: ropeWikiFieldValues(c) as Prisma.InputJsonValue,
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

    res.json({ linked, created, skipped, errors, sourceUpdatedAt });
  },
);

// POST /ropewiki/refresh — re-fetch CSV and update non-edited places, add new ones
router.post(
  "/refresh",
  requireAuth,
  ropeWikiHeavyLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await loadUser(req.user!.sub);

    const fresh = req.query.fresh === "true";
    const {
      places: parsed,
      errors: parseErrors,
      sourceUpdatedAt,
    } = await getRopeWikiCanyons(fresh);

    // Load all existing RopeWiki-sourced places for this user
    const existingPlaces = await prisma.place.findMany({
      where: { ownerId: user.id, ropeWikiId: { not: null } },
    });
    const existingByRwId = new Map(
      existingPlaces.map((c) => [c.ropeWikiId!, c]),
    );

    type RefreshUpdate = {
      id: string;
      previousUpdatedAt: Date;
      placeData: Partial<{
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
      placeDataChanged: boolean;
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
          placeData: {},
          newSnapshot: legacySnapshot,
          placeDataChanged: false,
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
      const placeData: Record<string, unknown> = {};
      const newOwnedFields: RopeWikiOwnableField[] =
        effectiveOwnership === "*" ? [...ROPE_WIKI_OWNABLE_FIELDS] : [...effectiveOwnership];

      // The snapshot keeps RopeWiki's own camelCase names — it is persisted and
      // compared field by field on every refresh, so renaming its keys would
      // make every existing snapshot look like a user edit and freeze RopeWiki
      // out of every field it owns. The place side speaks field KEYS, so the
      // comparison translates one to the other rather than moving either.
      const existingValues = asFieldValues(existing.fieldValues);
      const nextValues: Record<string, unknown> = { ...existingValues };
      let valuesChanged = false;

      for (const field of ROPE_WIKI_OWNABLE_FIELDS) {
        const key = ROPE_WIKI_FIELD_KEYS[field];
        const existingVal = fieldValue(existingValues, key) ?? null;
        const snapshotVal = effectiveSnapshot[field];
        const freshVal = freshWithOz[field];

        if (isRopeWikiOwned(effectiveSnapshot, field)) {
          if (existingVal !== snapshotVal) {
            // User edited this field — drop from ownership mask, don't overwrite.
            const idx = newOwnedFields.indexOf(field);
            if (idx !== -1) newOwnedFields.splice(idx, 1);
          } else if (freshVal !== snapshotVal) {
            // RopeWiki changed this field and user hasn't touched it — update.
            if (freshVal === null || freshVal === undefined) delete nextValues[key];
            else nextValues[key] = freshVal;
            valuesChanged = true;
          }
        }
        // user-owned fields: never overwrite.
      }

      // Sources: always union (no ownership semantics).
      const existingSources =
        (existingValues[SOURCES_FIELD_KEY] as [string, string][] | undefined) ?? [];
      const freshSources = freshWithOz.attributes?.sources ?? [];
      const mergedSources = [...existingSources];
      for (const [label, url] of freshSources) {
        if (!mergedSources.some(([, u]) => u === url)) mergedSources.push([label, url]);
      }
      const sourcesChanged = !attributesSourcesEqual(
        { sources: existingSources.length ? existingSources : undefined },
        { sources: mergedSources.length ? mergedSources : undefined },
      );
      if (sourcesChanged) {
        if (mergedSources.length) nextValues[SOURCES_FIELD_KEY] = mergedSources;
        else delete nextValues[SOURCES_FIELD_KEY];
        valuesChanged = true;
      }

      if (valuesChanged) placeData["fieldValues"] = nextValues;

      const newSnapshot: RopeWikiSnapshot = {
        ...freshSnapshot,
        ropeWikiOwnedFields: newOwnedFields,
      };

      const placeDataChanged = Object.keys(placeData).length > 0;
      const ownershipChanged =
        effectiveOwnership === "*"
          ? newOwnedFields.length !== ROPE_WIKI_OWNABLE_FIELDS.length
          : JSON.stringify([...newOwnedFields].sort()) !==
            JSON.stringify([...effectiveOwnership].sort());
      const snapshotValuesChanged = !snapshotsEqual(
        { ...freshSnapshot, ropeWikiOwnedFields: newOwnedFields },
        effectiveSnapshot,
      );

      if (!placeDataChanged && !ownershipChanged && !snapshotValuesChanged) {
        unchanged++;
        continue;
      }

      toUpdate.push({
        id: existing.id,
        previousUpdatedAt: existing.updatedAt,
        placeData,
        newSnapshot,
        placeDataChanged,
      });
    }

    // Run dedupe on the "new from RopeWiki" rows against user's non-RW
    // places. Auto-link high confidence, return review tier, create the rest.
    let autoLinkedFromRefresh = 0;
    let review: ReviewCandidatePayload[] = [];
    if (toCreate.length > 0) {
      const candidatePool = await prisma.place.findMany({
        where: { ownerId: user.id, ropeWikiId: null },
      });
      const existingByPlaceId = new Map(candidatePool.map((c) => [c.id, c]));
      const proposals = buildProposals(toCreate, candidatePool);
      const result = await applyAutoLinkAndCreate(
        user.id,
        toCreate,
        proposals,
        existingByPlaceId,
      );
      autoLinkedFromRefresh = result.autoLinked;
      review = result.review;
    }

    const updated = toUpdate.filter((u) => u.placeDataChanged).length;

    // Chunked transaction updates (different data per row → can't updateMany)
    const allUpdates = toUpdate.map((u) =>
      prisma.place.update({
        where: { id: u.id },
        data: {
          ...u.placeData,
          ropeWikiSnapshot: u.newSnapshot,
          // Don't bump updatedAt if only snapshot/ownership changed (no user-visible data changed).
          ...(u.placeDataChanged ? {} : { updatedAt: u.previousUpdatedAt }),
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
      userEdited: toUpdate.filter((u) => !u.placeDataChanged).length,
      errors: parseErrors,
      sourceUpdatedAt,
    });
  },
);

export default router;
