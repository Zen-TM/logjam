import { describe, it, expect } from "vitest";
import {
  normalizeCanyonName,
  damerauLevenshtein,
  nameTier,
  matchCanyon,
  defaultsToMergeOnImport,
  MERGE_DEFAULT_DIST_M,
  type MatchCandidate,
  type ScoredCandidate,
} from "./canyonMatch.js";

// A reference point in the Blue Mountains; offsets keep candidates either very
// close (auto) or far (review) without hand-tuning real coords.
const BASE_LAT = -33.5;
const BASE_LNG = 150.3;
// ~50 m north — inside AUTO_LINK_DIST_M (250 m).
const NEAR_LAT = -33.49955;
const NEAR_LNG = 150.3;
// ~500 m north — beyond AUTO_LINK_DIST_M (250 m) but inside the wider
// EXACT_NAME_AUTO_DIST_M (2000 m). Models cross-dataset coord disagreement.
const MID_LAT = -33.4955;
const MID_LNG = 150.3;
// ~5.5 km north — beyond NAME_MATCH_DIST_M, well outside auto.
const FAR_LAT = -33.45;
const FAR_LNG = 150.3;

function candidate(
  id: string,
  name: string,
  latitude = BASE_LAT,
  longitude = BASE_LNG,
  altNames: string[] = [],
): MatchCandidate {
  return { id, name, altNames, latitude, longitude };
}

describe("normalizeCanyonName", () => {
  it("despaces and strips type words", () => {
    const n = normalizeCanyonName("Ball Race Canyon");
    expect(n.base).toBe("ball race");
    expect(n.baseDespaced).toBe("ballrace");
    expect(n.qualifiers.size).toBe(0);
  });

  it("strips noise words", () => {
    expect(normalizeCanyonName("Bell Creek Complete").base).toBe("bell");
  });

  it("extracts and relocates qualifiers, mapping abbreviations", () => {
    const a = normalizeCanyonName("Upper Deanes Creek");
    const b = normalizeCanyonName("Deanes Creek (Upper)");
    expect(a.base).toBe("deanes");
    expect(b.base).toBe("deanes");
    expect([...a.qualifiers]).toEqual(["upper"]);
    expect([...b.qualifiers]).toEqual(["upper"]);
  });

  it("converts number words to digits", () => {
    expect(normalizeCanyonName("Wollangambe One").base).toBe("wollangambe 1");
  });

  it("captures a non-qualifier parenthetical as a location hint", () => {
    const n = normalizeCanyonName("Tunnel (Newnes Plateau)");
    expect(n.base).toBe("tunnel");
    expect(n.locationHint).toBe("newnes plateau");
  });

  it("removes apostrophes and normalizes ampersand", () => {
    const n = normalizeCanyonName("Du Faur's & Co");
    expect(n.tokens).toContain("and");
    expect(n.base.includes("'")).toBe(false);
  });

  it("does not empty the base when every token is a type word", () => {
    expect(normalizeCanyonName("Tunnel").base).toBe("tunnel");
  });
});

describe("damerauLevenshtein", () => {
  it("is zero for identical strings", () => {
    expect(damerauLevenshtein("claustral", "claustral")).toBe(0);
  });
  it("counts a single substitution as 1", () => {
    expect(damerauLevenshtein("sassafrass", "sassafras")).toBe(1);
  });
  it("counts an adjacent transposition as 1", () => {
    expect(damerauLevenshtein("clasutral", "claustral")).toBe(1);
  });
  it("handles empty strings", () => {
    expect(damerauLevenshtein("", "abc")).toBe(3);
    expect(damerauLevenshtein("abc", "")).toBe(3);
  });
});

describe("nameTier", () => {
  it("exact when despaced bases and qualifiers match", () => {
    expect(
      nameTier(
        normalizeCanyonName("Bubble-Bath"),
        normalizeCanyonName("Bubble Bath"),
      ),
    ).toBe("exact");
  });
  it("typo within edit distance with equal qualifiers", () => {
    expect(
      nameTier(
        normalizeCanyonName("Sassafrass"),
        normalizeCanyonName("Sassafras"),
      ),
    ).toBe("typo");
  });
  it("qualifier-mismatch when bases match but qualifiers differ", () => {
    expect(
      nameTier(
        normalizeCanyonName("Bowens Creek South"),
        normalizeCanyonName("Bowens Creek North"),
      ),
    ).toBe("qualifier-mismatch");
  });
  it("none for unrelated names", () => {
    expect(
      nameTier(
        normalizeCanyonName("Claustral"),
        normalizeCanyonName("Glow Worm"),
      ),
    ).toBe("none");
  });

  // Numbers are identity, not spelling. Without the number-token rule these
  // bases ("wollangambe 1" / "wollangambe 2") are one edit apart and read as a
  // typo, silently merging two different canyons.
  it("none when number tokens differ", () => {
    expect(
      nameTier(
        normalizeCanyonName("Wollangambe Two"),
        normalizeCanyonName("Wollangambe One"),
      ),
    ).toBe("none");
  });
  it("none when a number word and a digit disagree", () => {
    expect(
      nameTier(
        normalizeCanyonName("Wollangambe Two"),
        normalizeCanyonName("Wollangambe 1"),
      ),
    ).toBe("none");
  });
  it("none when only one side carries a number", () => {
    expect(
      nameTier(
        normalizeCanyonName("Wollangambe Complete"),
        normalizeCanyonName("Wollangambe One"),
      ),
    ).toBe("none");
  });
  it("none for a bare name against a numbered one", () => {
    expect(
      nameTier(
        normalizeCanyonName("Wollangambe"),
        normalizeCanyonName("Wollangambe Two"),
      ),
    ).toBe("none");
  });
  it("exact when a number word and its digit agree", () => {
    expect(
      nameTier(
        normalizeCanyonName("Wollangambe One"),
        normalizeCanyonName("Wollangambe 1"),
      ),
    ).toBe("exact");
  });
  it("still tolerates a genuine typo alongside matching numbers", () => {
    expect(
      nameTier(
        normalizeCanyonName("Wollangambe Two"),
        normalizeCanyonName("Wollangambee Two"),
      ),
    ).toBe("typo");
  });
  it("still tolerates a genuine typo when neither name has a number", () => {
    expect(
      nameTier(
        normalizeCanyonName("Clasutral"),
        normalizeCanyonName("Claustral Canyon"),
      ),
    ).toBe("typo");
  });
});

// The 19 positive corpus pairs (plan §5a). CSV/canyon imports carry coords, so
// every one resolves to "auto".
describe("matchCanyon — 19 positive corpus pairs (with coords)", () => {
  const cases: Array<{ input: string; candidates: MatchCandidate[] }> = [
    { input: "Ballrace", candidates: [candidate("c", "Ball Race Canyon")] },
    { input: "Bell Creek Complete", candidates: [candidate("c", "Bell Creek")] },
    {
      input: "Bowens Creek South Complete",
      candidates: [candidate("c", "Bowens Creek South")],
    },
    {
      input: "Box Creek",
      candidates: [
        candidate("c", "Box Creek Canyon"),
        candidate("far", "Box (Coorongooba)", FAR_LAT, FAR_LNG),
      ],
    },
    { input: "Bubble-Bath", candidates: [candidate("c", "Bubble Bath")] },
    {
      input: "Bungleboori South Branch (Upper)",
      candidates: [candidate("c", "Bungleboori South (Upper)")],
    },
    { input: "Carrols", candidates: [candidate("c", "Carrolls Creek")] },
    { input: "Clasutral", candidates: [candidate("c", "Claustral Creek")] },
    { input: "Hand Over Hand", candidates: [candidate("c", "Hand-over-Hand")] },
    {
      input: "Hole-in-the-Wall",
      candidates: [candidate("c", "Hole in the Wall")],
    },
    { input: "Looking-Glass", candidates: [candidate("c", "Looking Glass")] },
    { input: "Sassafrass", candidates: [candidate("c", "Sassafras")] },
    {
      input: "Tunnel",
      candidates: [candidate("c", "Tunnel (Newnes Plateau)")],
    },
    {
      input: "Upper Deanes Creek",
      candidates: [candidate("c", "Deanes Creek (Upper)")],
    },
    {
      input: "Upper Wollangambe",
      candidates: [candidate("c", "Wollangambe (Upper)")],
    },
    {
      input: "Waterfall Creek",
      candidates: [
        candidate("c", "Waterfall Creek"),
        candidate("far1", "Waterfall Creek", FAR_LAT, FAR_LNG),
      ],
    },
    { input: "Wollangambe One", candidates: [candidate("c", "Wollangambe 1")] },
    {
      input: "Middle Chistys Creek",
      candidates: [candidate("c", "Christys Creek (Middle)")],
    },
    { input: "Honey Comb", candidates: [candidate("c", "Honeycomb Canyon")] },
  ];

  for (const { input, candidates } of cases) {
    it(`${input} -> auto`, () => {
      const result = matchCanyon(
        { name: input, latitude: NEAR_LAT, longitude: NEAR_LNG },
        candidates,
      );
      expect(result.confidence).toBe("auto");
      expect(result.best?.candidate.id).toBe("c");
    });
  }
});

describe("matchCanyon — negative and ambiguity cases", () => {
  it("qualifier-mismatch (South vs North) -> none", () => {
    const result = matchCanyon(
      { name: "Bowens Creek South", latitude: NEAR_LAT, longitude: NEAR_LNG },
      [candidate("c", "Bowens Creek North")],
    );
    expect(result.confidence).toBe("none");
    expect(result.best).toBeNull();
  });

  it("name match with coords >5km apart -> review, never auto", () => {
    const result = matchCanyon(
      { name: "Tunnel", latitude: BASE_LAT, longitude: BASE_LNG },
      [candidate("c", "Tunnel", FAR_LAT, FAR_LNG)],
    );
    expect(result.confidence).toBe("review");
  });

  it("ambiguous no-coords (three Waterfall Creeks) -> review", () => {
    const result = matchCanyon({ name: "Waterfall Creek" }, [
      candidate("a", "Waterfall Creek"),
      candidate("b", "Waterfall Creek"),
      candidate("c", "Waterfall Creek"),
    ]);
    expect(result.confidence).toBe("review");
    expect(result.candidates.length).toBe(3);
  });

  it("single exact name with no coords -> auto", () => {
    const result = matchCanyon({ name: "Claustral" }, [
      candidate("c", "Claustral Creek"),
    ]);
    expect(result.confidence).toBe("auto");
  });

  it("typo with no coords -> review (no corroboration)", () => {
    const result = matchCanyon({ name: "Sassafrass" }, [
      candidate("c", "Sassafras"),
    ]);
    expect(result.confidence).toBe("review");
  });

  it("no candidate -> none", () => {
    const result = matchCanyon(
      { name: "Nonexistent", latitude: NEAR_LAT, longitude: NEAR_LNG },
      [candidate("c", "Claustral")],
    );
    expect(result.confidence).toBe("none");
  });

  it("Box Creek prefers the near exact over the far same-stem", () => {
    const result = matchCanyon(
      { name: "Box Creek", latitude: NEAR_LAT, longitude: NEAR_LNG },
      [
        candidate("near", "Box Creek Canyon"),
        candidate("far", "Box Creek", FAR_LAT, FAR_LNG),
      ],
    );
    // Two exact candidates but only one is close -> auto on the near one.
    expect(result.confidence).toBe("auto");
    expect(result.best?.candidate.id).toBe("near");
  });

  it("exact name with coords ~500m apart -> auto (tolerates cross-dataset coord drift)", () => {
    // The canyons.csv/RopeWiki scenario: identical name, coords a few hundred
    // metres apart because the two datasets pin different reference points.
    const result = matchCanyon(
      { name: "Constance Gorge", latitude: BASE_LAT, longitude: BASE_LNG },
      [candidate("c", "Constance Gorge", MID_LAT, MID_LNG)],
    );
    expect(result.confidence).toBe("auto");
    expect(result.best?.candidate.id).toBe("c");
  });

  it("two exact names both within the wide radius -> review (genuine ambiguity)", () => {
    const result = matchCanyon(
      { name: "Twin", latitude: BASE_LAT, longitude: BASE_LNG },
      [
        candidate("a", "Twin", NEAR_LAT, NEAR_LNG),
        candidate("b", "Twin", MID_LAT, MID_LNG),
      ],
    );
    expect(result.confidence).toBe("review");
  });

  it("typo tier still requires the tight 250m radius (no widening)", () => {
    // "Sassafrass" -> "Sassafras" is a typo, not exact. At ~500m it must stay
    // review — only exact names get the wide auto radius.
    const result = matchCanyon(
      { name: "Sassafrass", latitude: BASE_LAT, longitude: BASE_LNG },
      [candidate("c", "Sassafras", MID_LAT, MID_LNG)],
    );
    expect(result.confidence).toBe("review");
  });
});

describe("defaultsToMergeOnImport", () => {
  function scored(
    distanceMeters: number | null,
    tier: "exact" | "typo" = "typo",
  ): ScoredCandidate {
    return { candidate: candidate("c", "Whatever"), tier, distanceMeters };
  }

  it("defaults to merge just inside the threshold", () => {
    expect(defaultsToMergeOnImport(scored(MERGE_DEFAULT_DIST_M - 1))).toBe(true);
  });

  it("defaults to merge exactly at the threshold (inclusive)", () => {
    expect(defaultsToMergeOnImport(scored(MERGE_DEFAULT_DIST_M))).toBe(true);
  });

  it("defaults to create-as-new just beyond the threshold", () => {
    expect(defaultsToMergeOnImport(scored(MERGE_DEFAULT_DIST_M + 1))).toBe(false);
  });

  // The reported harm: a name-similar canyon 1.8 km away arrived pre-checked to
  // merge. It stays on the review list as a tickable option; it just no longer
  // starts selected.
  it("defaults to create-as-new for a name-similar match 1.8 km away", () => {
    expect(defaultsToMergeOnImport(scored(1800))).toBe(false);
  });

  it("defaults to create-as-new when the candidate is beyond the coarse bbox", () => {
    expect(defaultsToMergeOnImport(scored(Number.POSITIVE_INFINITY))).toBe(false);
  });

  // No coords is not corroboration. Distance is never null on the canyon-import
  // path (rows require lat/lng), but the rule must not read "unknown" as "near".
  it("defaults to create-as-new when there is no distance to corroborate with", () => {
    expect(defaultsToMergeOnImport(scored(null))).toBe(false);
  });

  it("defaults to create-as-new when there is no match at all", () => {
    expect(defaultsToMergeOnImport(null)).toBe(false);
  });

  it("applies to exact-tier matches too, not just typo-tier", () => {
    expect(defaultsToMergeOnImport(scored(1800, "exact"))).toBe(false);
    expect(defaultsToMergeOnImport(scored(100, "exact"))).toBe(true);
  });

  // End-to-end through the matcher: a surfaced (review) row far from its only
  // name match must not arrive pre-selected to merge.
  it("a review-tier match ~500 m out defaults to create-as-new", () => {
    const result = matchCanyon(
      { name: "Sassafrass", latitude: BASE_LAT, longitude: BASE_LNG },
      [candidate("c", "Sassafras", MID_LAT, MID_LNG)],
    );
    expect(result.confidence).toBe("review");
    expect(defaultsToMergeOnImport(result.best)).toBe(false);
  });

  it("a review-tier match ~50 m out still defaults to merge", () => {
    // Two typo candidates: one near, one far -> review (no auto), but the best
    // is close enough that pre-selecting the merge is still the right default.
    const result = matchCanyon(
      { name: "Sassafrass", latitude: BASE_LAT, longitude: BASE_LNG },
      [
        candidate("near", "Sassafras", NEAR_LAT, NEAR_LNG),
        candidate("far", "Sassafras", FAR_LAT, FAR_LNG),
      ],
    );
    expect(result.best?.candidate.id).toBe("near");
    expect(defaultsToMergeOnImport(result.best)).toBe(true);
  });
});
