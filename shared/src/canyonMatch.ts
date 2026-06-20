// Single deterministic canyon name + location matcher. Shared by CSV canyon
// import, trip-canyon matching, and RopeWiki dedup. Replaced the two divergent
// matchers (the retired token-Jaccard nameMatchScore, and the frontend
// exact->stripped->fuzzy chain). Rules are deterministic edit-distance
// + normalization; no machine learning.
//
// The 19 real-world failure examples the owner collected all reduce to a small
// set of normalization rules (despace, type-word/noise-word stripping,
// qualifier extraction + relocation, number-word<->digit, edit-distance typo
// tolerance) plus coordinate corroboration for confidence.

import { norm, stripWaterwaySuffix, WATERWAY_SUFFIXES } from "./canyonNameMatch.js";
import { haversineMeters, withinBbox } from "./canyonGeo.js";

// Distance thresholds (moved here from api/src/services/ropewikiDedupe.ts so
// every matching surface shares one source of truth; re-exported there).
export const AUTO_LINK_DIST_M = 250; // typo-tier auto-link radius (coords must corroborate a weak name signal)
// Exact-name auto-link radius. An exact normalized name is a strong signal on
// its own; the coordinate check only exists to rule out a far same-name twin.
// Independent datasets pin different reference points for the same canyon (a
// user's GPS vs RopeWiki's marker — car park vs first abseil vs wiki centroid),
// so cross-dataset coords routinely disagree by a few hundred metres. 250 m is
// calibrated for re-importing one's own coords; it is far too tight to
// reconcile against a foreign DB. Widen the radius only for exact names.
export const EXACT_NAME_AUTO_DIST_M = 2000;
export const REVIEW_DIST_M = 1000;
export const NAME_MATCH_DIST_M = 5000; // strong name match still wins beyond review radius
export const BBOX_DEG = 0.05; // ~5 km coarse prefilter; must exceed NAME_MATCH_DIST_M

const TOP_CANDIDATES = 3;

// Words that add no identifying information to a canyon name. Curated and
// extensible. "branch", "exit", "entry" describe a route variant of the same
// canyon; "complete"/"full" describe doing the whole thing.
const NOISE_WORDS = new Set(["complete", "full", "branch", "exit", "entry"]);

// Canonical position qualifiers and the abbreviations that map onto them.
const QUALIFIER_CANONICAL: Record<string, string> = {
  upper: "upper",
  upr: "upper",
  lower: "lower",
  lwr: "lower",
  middle: "middle",
  mid: "middle",
  north: "north",
  n: "north",
  nth: "north",
  south: "south",
  s: "south",
  sth: "south",
  east: "east",
  e: "east",
  west: "west",
  w: "west",
};

const TYPE_WORDS = new Set(WATERWAY_SUFFIXES);

const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
];

const NUMBER_WORD_TO_DIGIT = new Map<string, string>(
  NUMBER_WORDS.map((word, index) => [word, String(index)]),
);

function numberWordToDigit(token: string): string {
  return NUMBER_WORD_TO_DIGIT.get(token) ?? token;
}

export type NormalizedName = {
  base: string; // type-words + noise-words stripped, lowercased, apostrophes removed
  baseDespaced: string; // base with spaces/hyphens removed (run-together invariance)
  tokens: string[];
  qualifiers: Set<string>; // upper|lower|middle|north|south|east|west (abbrevs normalized)
  locationHint: string | null; // non-qualifier parenthetical, e.g. "newnes plateau"
};

function canonicalQualifier(token: string): string | null {
  return QUALIFIER_CANONICAL[token] ?? null;
}

// 8-step normalization pipeline (see plan §5a).
export function normalizeCanyonName(raw: string): NormalizedName {
  // 1. lowercase, trim, remove apostrophes, normalize "&" -> "and".
  let working = norm(raw).replace(/&/g, " and ");

  const qualifiers = new Set<string>();
  let locationHint: string | null = null;

  // 2 + 3. Extract parentheticals; classify as qualifier or location hint;
  // strip them from the working string.
  working = working.replace(/\(([^)]*)\)/g, (_match, inner: string) => {
    const content = inner.trim();
    if (!content) return " ";
    const qualifier = canonicalQualifier(content);
    if (qualifier) {
      qualifiers.add(qualifier);
    } else {
      // A non-qualifier parenthetical is a location hint. Last one wins if
      // there are multiple; in practice there is at most one.
      locationHint = content;
    }
    return " ";
  });

  // 4. Tokenize on whitespace / hyphen / slash / underscore.
  let tokens = working.split(/[\s\-_/]+/).filter((token) => token.length > 0);

  // 5. Move qualifier tokens into the qualifier set (mapping abbreviations to
  // canonical). Any standalone qualifier token is relocated, not just leading
  // ones, so "Upper Deanes Creek" and "Deanes Creek (Upper)" converge.
  const afterQualifierExtraction: string[] = [];
  for (const token of tokens) {
    const qualifier = canonicalQualifier(token);
    if (qualifier) {
      qualifiers.add(qualifier);
    } else {
      afterQualifierExtraction.push(token);
    }
  }
  tokens = afterQualifierExtraction;

  // 6. Drop type-words and noise-words anywhere in the token list. Guard
  // against emptying the base entirely (e.g. a canyon literally named
  // "Tunnel"): if every remaining token is a type/noise word, keep them.
  const afterStripping = tokens.filter(
    (token) => !TYPE_WORDS.has(token) && !NOISE_WORDS.has(token),
  );
  tokens = afterStripping.length > 0 ? afterStripping : tokens;

  // 7. Number-word <-> digit on remaining tokens.
  tokens = tokens.map((token) => numberWordToDigit(token));

  // 8. base = tokens joined by space; baseDespaced = tokens joined by "".
  const base = tokens.join(" ");
  const baseDespaced = tokens.join("");

  return { base, baseDespaced, tokens, qualifiers, locationHint };
}

function qualifierSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

// Damerau-Levenshtein edit distance (optimal string alignment variant), which
// counts a transposition of two adjacent characters as a single edit. Pure.
// Needed for cases like "Clasutral" -> "Claustral" (one transposition).
export function damerauLevenshtein(a: string, b: string): number {
  const lengthA = a.length;
  const lengthB = b.length;
  if (lengthA === 0) return lengthB;
  if (lengthB === 0) return lengthA;

  // distance[i][j] = edit distance between a[0..i) and b[0..j).
  const distance: number[][] = Array.from({ length: lengthA + 1 }, () =>
    new Array<number>(lengthB + 1).fill(0),
  );
  for (let i = 0; i <= lengthA; i++) distance[i][0] = i;
  for (let j = 0; j <= lengthB; j++) distance[0][j] = j;

  for (let i = 1; i <= lengthA; i++) {
    for (let j = 1; j <= lengthB; j++) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      distance[i][j] = Math.min(
        distance[i - 1][j] + 1, // deletion
        distance[i][j - 1] + 1, // insertion
        distance[i - 1][j - 1] + substitutionCost, // substitution
      );
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        distance[i][j] = Math.min(
          distance[i][j],
          distance[i - 2][j - 2] + 1, // transposition
        );
      }
    }
  }

  return distance[lengthA][lengthB];
}

export type NameTier = "exact" | "typo" | "qualifier-mismatch" | "none";

// Pairwise name comparison between two already-normalized names.
export function nameTier(a: NormalizedName, b: NormalizedName): NameTier {
  const qualifiersEqual = qualifierSetsEqual(a.qualifiers, b.qualifiers);

  // Empty bases never match — fail loudly rather than treating "" === "".
  if (!a.baseDespaced || !b.baseDespaced) return "none";

  if (a.baseDespaced === b.baseDespaced) {
    return qualifiersEqual ? "exact" : "qualifier-mismatch";
  }

  // Typo tolerance: bases close under edit distance and qualifiers agree.
  // Threshold scales with the (shorter) base length: short names get 1 edit,
  // longer names get 2, so a one-letter name can't typo-match an unrelated
  // one-letter name.
  const threshold = Math.min(a.base.length, b.base.length) <= 8 ? 1 : 2;
  if (qualifiersEqual && damerauLevenshtein(a.base, b.base) <= threshold) {
    return "typo";
  }

  // Bases that despace-match but disagree on qualifiers were caught above. If
  // bases are within typo distance but qualifiers differ, that is a deliberate
  // non-match (Bowens Creek South vs North).
  if (
    !qualifiersEqual &&
    damerauLevenshtein(a.base, b.base) <= threshold
  ) {
    return "qualifier-mismatch";
  }

  return "none";
}

export type MatchCandidate = {
  id: string;
  name: string;
  altNames: string[];
  latitude: number;
  longitude: number;
};

export type MatchInput = {
  name: string;
  altNames?: string[];
  latitude?: number | null;
  longitude?: number | null;
};

export type ScoredCandidate = {
  candidate: MatchCandidate;
  tier: "exact" | "typo";
  distanceMeters: number | null;
};

export type MatchResult = {
  confidence: "auto" | "review" | "none";
  best: ScoredCandidate | null;
  candidates: ScoredCandidate[]; // ranked, top 3, for the review UI
};

function hasCoords(value: number | null | undefined): value is number {
  return typeof value === "number" && !Number.isNaN(value);
}

// Best name tier of an input against a candidate considering the candidate's
// name and all its alt-names. exact beats typo; qualifier-mismatch and none are
// discarded by the caller.
function bestNameTier(
  inputNorm: NormalizedName,
  candidate: MatchCandidate,
): NameTier {
  const names = [candidate.name, ...candidate.altNames];
  let best: NameTier = "none";
  for (const name of names) {
    const tier = nameTier(inputNorm, normalizeCanyonName(name));
    if (tier === "exact") return "exact";
    if (tier === "typo") best = "typo";
    else if (tier === "qualifier-mismatch" && best === "none") {
      best = "qualifier-mismatch";
    }
  }
  return best;
}

// Match an incoming canyon/trip name (optionally with coords) against a list of
// existing canyons. See plan §5a for the decision procedure.
export function matchCanyon(
  input: MatchInput,
  candidates: MatchCandidate[],
): MatchResult {
  const inputNorm = normalizeCanyonName(input.name);
  const inputHasCoords = hasCoords(input.latitude) && hasCoords(input.longitude);

  const scored: ScoredCandidate[] = [];
  for (const candidate of candidates) {
    const tier = bestNameTier(inputNorm, candidate);
    if (tier !== "exact" && tier !== "typo") continue; // discard mismatch/none

    let distanceMeters: number | null = null;
    if (inputHasCoords) {
      const latitude = input.latitude as number;
      const longitude = input.longitude as number;
      if (
        withinBbox(
          latitude,
          longitude,
          candidate.latitude,
          candidate.longitude,
          BBOX_DEG,
        )
      ) {
        distanceMeters = haversineMeters(
          latitude,
          longitude,
          candidate.latitude,
          candidate.longitude,
        );
      } else {
        // Outside the coarse prefilter -> treat as far. A real far-away
        // name-twin must not auto-link, so represent it as a large distance.
        distanceMeters = Number.POSITIVE_INFINITY;
      }
    }

    scored.push({ candidate, tier, distanceMeters });
  }

  // Rank: exact before typo; within a tier, nearest first. With no coords,
  // stable input order (sort is stable in modern engines).
  const tierRank = (tier: "exact" | "typo") => (tier === "exact" ? 0 : 1);
  scored.sort((a, b) => {
    const byTier = tierRank(a.tier) - tierRank(b.tier);
    if (byTier !== 0) return byTier;
    const da = a.distanceMeters ?? Number.POSITIVE_INFINITY;
    const db = b.distanceMeters ?? Number.POSITIVE_INFINITY;
    return da - db;
  });

  const ranked = scored.slice(0, TOP_CANDIDATES);
  const best = ranked[0] ?? null;

  if (!best) {
    return { confidence: "none", best: null, candidates: [] };
  }

  const confidence = decideConfidence(best, ranked, inputHasCoords);
  return { confidence, best, candidates: ranked };
}

function decideConfidence(
  best: ScoredCandidate,
  ranked: ScoredCandidate[],
  inputHasCoords: boolean,
): "auto" | "review" {
  const distance = best.distanceMeters;

  if (best.tier === "exact") {
    if (!inputHasCoords) {
      // Auto only if it is the single exact candidate; multiple exact names
      // with no coords to disambiguate -> review.
      const exactCount = ranked.filter((c) => c.tier === "exact").length;
      return exactCount === 1 ? "auto" : "review";
    }
    // Coords present: an exact name auto-links within the wide
    // EXACT_NAME_AUTO_DIST_M radius (tolerates cross-dataset coord
    // disagreement), unless a second exact candidate is also within that radius
    // (a genuine ambiguity the user must resolve).
    if (distance !== null && distance <= EXACT_NAME_AUTO_DIST_M) {
      const otherClose = ranked.some(
        (c) =>
          c !== best &&
          c.tier === "exact" &&
          c.distanceMeters !== null &&
          c.distanceMeters <= EXACT_NAME_AUTO_DIST_M,
      );
      return otherClose ? "review" : "auto";
    }
    // Exact name but coords far -> review (could be a different canyon of the
    // same name elsewhere).
    return "review";
  }

  // typo tier: only auto when coords corroborate the typo.
  if (inputHasCoords && distance !== null && distance <= AUTO_LINK_DIST_M) {
    return "auto";
  }
  return "review";
}
