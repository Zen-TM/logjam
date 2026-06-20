import {
  AUTO_LINK_DIST_M,
  NAME_MATCH_DIST_M,
  REVIEW_DIST_M,
  BBOX_DEG,
  haversineMeters,
  matchCanyon,
  withinBbox,
  type MatchCandidate,
} from "@logjam/shared";
import type { Canyon } from "@prisma/client";
import type { RopeWikiCanyon, RopeWikiOwnableField } from "./ropewiki";

const TOP_CANDIDATES = 3;

export type DedupeTier = "autoLink" | "review" | "create";

export type CandidateScore = {
  canyonId: string;
  distanceMeters: number;
  nameMatch: boolean;
  // Internal sort key (higher = better): name tier dominates, nearer wins
  // within a tier. Used only for ranking + auto-link collision resolution.
  combinedScore: number;
};

export type DedupeProposal = {
  ropeWikiId: number;
  tier: DedupeTier;
  candidates: CandidateScore[]; // empty for `create` tier
  bestCanyonId: string | null; // populated when tier === "autoLink"
};

function toMatchCandidate(c: Canyon): MatchCandidate {
  return {
    id: c.id,
    name: c.name,
    altNames: c.altNames,
    latitude: c.latitude,
    longitude: c.longitude,
  };
}

// Existing canyons within the spatial review radius of an incoming RopeWiki
// row, regardless of name. This preserves the long-standing behaviour where a
// canyon sitting on top of an incoming one is surfaced for human review even
// when the names don't match at all — the shared name matcher deliberately
// discards non-name candidates, so the spatial signal is recovered here.
function spatialReviewCandidates(
  rw: RopeWikiCanyon,
  existing: Canyon[],
): CandidateScore[] {
  const nearby: CandidateScore[] = [];
  for (const c of existing) {
    if (!withinBbox(rw.latitude, rw.longitude, c.latitude, c.longitude, BBOX_DEG)) {
      continue;
    }
    const distanceMeters = haversineMeters(rw.latitude, rw.longitude, c.latitude, c.longitude);
    if (distanceMeters > REVIEW_DIST_M) continue;
    nearby.push({
      canyonId: c.id,
      distanceMeters,
      nameMatch: false,
      combinedScore: -distanceMeters, // nearer ranks higher; below any name match
    });
  }
  return nearby.sort((a, b) => b.combinedScore - a.combinedScore).slice(0, TOP_CANDIDATES);
}

// Build dedupe proposals. Existing canyons that already have a ropeWikiId
// must be filtered out by the caller before invoking. The matcher ensures
// no existing canyon is auto-linked by more than one incoming RopeWiki row:
// if two rows top-score the same target, the lower-scoring one is downgraded
// to `review`.
//
// Name-tier classification (exact/typo) comes from the shared matchCanyon; this
// module layers RopeWiki-specific spatial gating on top: far same-name twins
// (outside NAME_MATCH_DIST_M) are dropped to `create`, and close-but-different
// -name canyons are surfaced for `review` via spatialReviewCandidates.
export function buildProposals(
  incoming: RopeWikiCanyon[],
  existing: Canyon[],
): DedupeProposal[] {
  const matchCandidates = existing.map(toMatchCandidate);

  const proposals: DedupeProposal[] = incoming.map((rw) => {
    const result = matchCanyon(
      { name: rw.name, latitude: rw.latitude, longitude: rw.longitude },
      matchCandidates,
    );

    // Name-matched candidates, dropping far same-name twins (cross-region
    // name collisions like "Waterfall Creek" must create, not link/review).
    const nameScored: CandidateScore[] = result.candidates
      .filter(
        (s) =>
          s.distanceMeters !== null &&
          Number.isFinite(s.distanceMeters) &&
          s.distanceMeters <= NAME_MATCH_DIST_M,
      )
      .map((s) => ({
        canyonId: s.candidate.id,
        distanceMeters: s.distanceMeters as number,
        nameMatch: true,
        // exact ranks above typo; nearer wins within a tier.
        combinedScore:
          (s.tier === "exact" ? 2e7 : 1e7) - (s.distanceMeters as number),
      }));

    const autoBest =
      result.confidence === "auto" && nameScored[0]
        ? nameScored[0]
        : undefined;

    let tier: DedupeTier;
    let candidates: CandidateScore[];
    if (autoBest && autoBest.distanceMeters <= AUTO_LINK_DIST_M) {
      tier = "autoLink";
      candidates = nameScored;
    } else if (nameScored.length > 0) {
      tier = "review";
      candidates = nameScored;
    } else {
      const nearby = spatialReviewCandidates(rw, existing);
      if (nearby.length > 0) {
        tier = "review";
        candidates = nearby;
      } else {
        tier = "create";
        candidates = [];
      }
    }

    return {
      ropeWikiId: rw.ropeWikiId,
      tier,
      candidates,
      bestCanyonId: tier === "autoLink" ? candidates[0].canyonId : null,
    };
  });

  // Resolve auto-link collisions: if two proposals auto-link to the same
  // existing canyon, the higher combined score wins; the loser is demoted
  // to review.
  const claimed = new Map<string, { ropeWikiId: number; score: number }>();
  for (const p of proposals) {
    if (p.tier !== "autoLink" || !p.bestCanyonId) continue;
    const myScore = p.candidates[0]?.combinedScore ?? 0;
    const current = claimed.get(p.bestCanyonId);
    if (!current || myScore > current.score) {
      if (current) {
        const loser = proposals.find((q) => q.ropeWikiId === current.ropeWikiId);
        if (loser) {
          loser.tier = "review";
          loser.bestCanyonId = null;
        }
      }
      claimed.set(p.bestCanyonId, { ropeWikiId: p.ropeWikiId, score: myScore });
    } else {
      p.tier = "review";
      p.bestCanyonId = null;
    }
  }

  return proposals;
}

// sources are unioned by URL so linking always preserves existing entries
// (e.g. OzUltimate) while adding the RopeWiki source.
function mergeSources(
  existing: [string, string][] | undefined,
  fresh: [string, string][] | undefined,
): [string, string][] | undefined {
  if (!fresh?.length) return existing;
  const merged = [...(existing ?? [])];
  for (const [label, url] of fresh) {
    if (!merged.some(([, u]) => u === url)) {
      merged.push([label, url]);
    }
  }
  return merged.length ? merged : undefined;
}

// Merge policy: existing user data wins. RopeWiki values only fill nulls on
// scalar fields. ropeWikiId and ropeWikiSnapshot are always set so subsequent
// /refresh calls work. sources are always unioned (additive).
// Returns the merged data AND the list of fields RopeWiki contributed
// (i.e. fields that were null on the existing canyon).
export function mergeFillNulls(
  existing: Canyon,
  fresh: RopeWikiCanyon,
): {
  ropeWikiId: number;
  numAbseils: number | null;
  longestAbseil: number | null;
  vGrade: number | null;
  aGrade: number | null;
  commitment: number | null;
  quality: number | null;
  hours: number | null;
  attributes: object;
  ropeWikiOwnedFields: RopeWikiOwnableField[];
} {
  const fill = <T>(current: T | null, incoming: T | null): T | null =>
    current === null || current === undefined ? incoming : current;
  const mergedAttrs: { sources?: [string, string][] } & object = {
    ...(fresh.attributes ?? {}),
    ...((existing.attributes as object) ?? {}),
  };
  const sources = mergeSources(
    (existing.attributes as { sources?: [string, string][] } | null)?.sources,
    fresh.attributes?.sources,
  );
  if (sources) mergedAttrs.sources = sources;
  else delete (mergedAttrs as { sources?: unknown }).sources;

  const ropeWikiOwnedFields: RopeWikiOwnableField[] = [];
  if (existing.numAbseils === null || existing.numAbseils === undefined) ropeWikiOwnedFields.push("numAbseils");
  if (existing.longestAbseil === null || existing.longestAbseil === undefined) ropeWikiOwnedFields.push("longestAbseil");
  if (existing.vGrade === null || existing.vGrade === undefined) ropeWikiOwnedFields.push("vGrade");
  if (existing.aGrade === null || existing.aGrade === undefined) ropeWikiOwnedFields.push("aGrade");
  if (existing.commitment === null || existing.commitment === undefined) ropeWikiOwnedFields.push("commitment");
  if (existing.quality === null || existing.quality === undefined) ropeWikiOwnedFields.push("quality");
  if (existing.hours === null || existing.hours === undefined) ropeWikiOwnedFields.push("hours");

  return {
    ropeWikiId: fresh.ropeWikiId,
    numAbseils: fill(existing.numAbseils, fresh.numAbseils),
    longestAbseil: fill(existing.longestAbseil, fresh.longestAbseil),
    vGrade: fill(existing.vGrade, fresh.vGrade),
    aGrade: fill(existing.aGrade, fresh.aGrade),
    commitment: fill(existing.commitment, fresh.commitment),
    quality: fill(existing.quality, fresh.quality),
    hours: fill(existing.hours, fresh.hours),
    attributes: mergedAttrs,
    ropeWikiOwnedFields,
  };
}
