import {
  asFieldValues,
  AUTO_LINK_DIST_M,
  fieldValue,
  SOURCES_FIELD_KEY,
  NAME_MATCH_DIST_M,
  REVIEW_DIST_M,
  BBOX_DEG,
  haversineMeters,
  matchPlace,
  withinBbox,
  type MatchCandidate,
} from "@logjam/shared";
import type { Place } from "@prisma/client";
import {
  ROPE_WIKI_FIELD_KEYS,
  ROPE_WIKI_OWNABLE_FIELDS,
  ropeWikiFieldValues,
  type RopeWikiCanyon,
  type RopeWikiOwnableField,
} from "./ropewiki";

const TOP_CANDIDATES = 3;

export type DedupeTier = "autoLink" | "review" | "create";

export type CandidateScore = {
  placeId: string;
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
  bestPlaceId: string | null; // populated when tier === "autoLink"
};

function toMatchCandidate(c: Place): MatchCandidate {
  return {
    id: c.id,
    name: c.name,
    altNames: c.altNames,
    latitude: c.latitude,
    longitude: c.longitude,
  };
}

// Existing places within the spatial review radius of an incoming RopeWiki
// row, regardless of name. This preserves the long-standing behaviour where a
// place sitting on top of an incoming one is surfaced for human review even
// when the names don't match at all — the shared name matcher deliberately
// discards non-name candidates, so the spatial signal is recovered here.
function spatialReviewCandidates(
  rw: RopeWikiCanyon,
  existing: Place[],
): CandidateScore[] {
  const nearby: CandidateScore[] = [];
  for (const c of existing) {
    if (!withinBbox(rw.latitude, rw.longitude, c.latitude, c.longitude, BBOX_DEG)) {
      continue;
    }
    const distanceMeters = haversineMeters(rw.latitude, rw.longitude, c.latitude, c.longitude);
    if (distanceMeters > REVIEW_DIST_M) continue;
    nearby.push({
      placeId: c.id,
      distanceMeters,
      nameMatch: false,
      combinedScore: -distanceMeters, // nearer ranks higher; below any name match
    });
  }
  return nearby.sort((a, b) => b.combinedScore - a.combinedScore).slice(0, TOP_CANDIDATES);
}

// Build dedupe proposals. Existing places that already have a ropeWikiId
// must be filtered out by the caller before invoking. The matcher ensures
// no existing place is auto-linked by more than one incoming RopeWiki row:
// if two rows top-score the same target, the lower-scoring one is downgraded
// to `review`.
//
// Name-tier classification (exact/typo) comes from the shared matchPlace; this
// module layers RopeWiki-specific spatial gating on top: far same-name twins
// (outside NAME_MATCH_DIST_M) are dropped to `create`, and close-but-different
// -name places are surfaced for `review` via spatialReviewCandidates.
export function buildProposals(
  incoming: RopeWikiCanyon[],
  existing: Place[],
): DedupeProposal[] {
  const matchCandidates = existing.map(toMatchCandidate);

  const proposals: DedupeProposal[] = incoming.map((rw) => {
    const result = matchPlace(
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
        placeId: s.candidate.id,
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
      bestPlaceId: tier === "autoLink" ? candidates[0].placeId : null,
    };
  });

  // Resolve auto-link collisions: if two proposals auto-link to the same
  // existing place, the higher combined score wins; the loser is demoted
  // to review.
  const claimed = new Map<string, { ropeWikiId: number; score: number }>();
  for (const p of proposals) {
    if (p.tier !== "autoLink" || !p.bestPlaceId) continue;
    const myScore = p.candidates[0]?.combinedScore ?? 0;
    const current = claimed.get(p.bestPlaceId);
    if (!current || myScore > current.score) {
      if (current) {
        const loser = proposals.find((q) => q.ropeWikiId === current.ropeWikiId);
        if (loser) {
          loser.tier = "review";
          loser.bestPlaceId = null;
        }
      }
      claimed.set(p.bestPlaceId, { ropeWikiId: p.ropeWikiId, score: myScore });
    } else {
      p.tier = "review";
      p.bestPlaceId = null;
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

// Merge policy: existing user data wins. RopeWiki values only fill fields the
// place has no value for. ropeWikiId and ropeWikiSnapshot are always set so
// subsequent /refresh calls work. sources are always unioned (additive).
// Returns the merged FIELD VALUES and the list of fields RopeWiki contributed
// (i.e. fields that were empty on the existing place).
//
// The seven scalars are `fieldValues` keys now rather than columns, so "is it
// null" became "is the key absent" — and those are the same question, because
// setFieldValues stores no nulls (a stored null would render as an empty field
// and count as a value here, letting RopeWiki think a field was user-owned when
// the user had never touched it).
export function mergeFillNulls(
  existing: Place,
  fresh: RopeWikiCanyon,
): {
  ropeWikiId: number;
  fieldValues: Record<string, unknown>;
  ropeWikiOwnedFields: RopeWikiOwnableField[];
} {
  const existingValues = asFieldValues(existing.fieldValues);
  const freshValues = ropeWikiFieldValues(fresh);

  const ropeWikiOwnedFields: RopeWikiOwnableField[] = [];
  const merged: Record<string, unknown> = { ...existingValues };
  for (const field of ROPE_WIKI_OWNABLE_FIELDS) {
    const key = ROPE_WIKI_FIELD_KEYS[field];
    if (fieldValue(existingValues, key) !== undefined) continue;
    ropeWikiOwnedFields.push(field);
    if (freshValues[key] !== undefined) merged[key] = freshValues[key];
  }

  const sources = mergeSources(
    existingValues[SOURCES_FIELD_KEY] as [string, string][] | undefined,
    freshValues[SOURCES_FIELD_KEY] as [string, string][] | undefined,
  );
  if (sources) merged[SOURCES_FIELD_KEY] = sources;
  else delete merged[SOURCES_FIELD_KEY];

  return {
    ropeWikiId: fresh.ropeWikiId,
    fieldValues: merged,
    ropeWikiOwnedFields,
  };
}
