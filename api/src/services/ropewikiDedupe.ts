import { haversineMeters, nameMatchScore, withinBbox } from "@logjam/shared";
import type { Canyon } from "@prisma/client";
import type { RopeWikiCanyon, RopeWikiOwnableField } from "./ropewiki";

const AUTO_LINK_DIST_M = 250;
const REVIEW_DIST_M = 1000;
const NAME_MATCH_DIST_M = 5000; // strong name match still wins beyond review radius
const BBOX_DEG = 0.05; // ~5 km coarse prefilter; must exceed NAME_MATCH_DIST_M

const TOP_CANDIDATES = 3;

export type DedupeTier = "autoLink" | "review" | "create";

export type CandidateScore = {
  canyonId: string;
  distanceMeters: number;
  nameMatch: boolean;
  tokenJaccard: number;
  combinedScore: number;
};

export type DedupeProposal = {
  ropeWikiId: number;
  tier: DedupeTier;
  candidates: CandidateScore[]; // empty for `create` tier
  bestCanyonId: string | null; // populated when tier === "autoLink"
};

function score(
  rw: { latitude: number; longitude: number; name: string; altNames?: string[] },
  existing: Canyon,
): CandidateScore | null {
  if (
    !withinBbox(
      rw.latitude,
      rw.longitude,
      existing.latitude,
      existing.longitude,
      BBOX_DEG,
    )
  ) {
    return null;
  }
  const distanceMeters = haversineMeters(
    rw.latitude,
    rw.longitude,
    existing.latitude,
    existing.longitude,
  );
  let best = nameMatchScore(rw.name, existing.name);
  for (const alt of existing.altNames) {
    const s = nameMatchScore(rw.name, alt);
    if (s.tokenJaccard > best.tokenJaccard || (s.match && !best.match)) {
      best = s;
    }
  }
  const combinedScore =
    1000 / (distanceMeters + 1) + (best.match ? 1 : 0) + best.tokenJaccard * 0.1;
  return {
    canyonId: existing.id,
    distanceMeters,
    nameMatch: best.match,
    tokenJaccard: best.tokenJaccard,
    combinedScore,
  };
}

function tierFor(top: CandidateScore | undefined): DedupeTier {
  if (!top) return "create";
  const { distanceMeters, nameMatch, tokenJaccard } = top;
  if (distanceMeters <= AUTO_LINK_DIST_M && nameMatch) return "autoLink";
  if (
    (distanceMeters <= REVIEW_DIST_M && tokenJaccard > 0) ||
    (distanceMeters <= AUTO_LINK_DIST_M && !nameMatch) ||
    (nameMatch && distanceMeters <= NAME_MATCH_DIST_M)
  ) {
    return "review";
  }
  return "create";
}

// Build dedupe proposals. Existing canyons that already have a ropeWikiId
// must be filtered out by the caller before invoking. The matcher ensures
// no existing canyon is auto-linked by more than one incoming RopeWiki row:
// if two rows top-score the same target, the lower-scoring one is downgraded
// to `review`.
export function buildProposals(
  incoming: RopeWikiCanyon[],
  existing: Canyon[],
): DedupeProposal[] {
  const proposals: DedupeProposal[] = incoming.map((rw) => {
    const scored = existing
      .map((c) => score(rw, c))
      .filter((s): s is CandidateScore => s !== null)
      .sort((a, b) => b.combinedScore - a.combinedScore)
      .slice(0, TOP_CANDIDATES);
    const top = scored[0];
    const tier = tierFor(top);
    return {
      ropeWikiId: rw.ropeWikiId,
      tier,
      candidates: scored,
      bestCanyonId: tier === "autoLink" && top ? top.canyonId : null,
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
