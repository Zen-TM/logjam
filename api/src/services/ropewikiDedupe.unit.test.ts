import { describe, it, expect } from "vitest";
import type { Canyon } from "@prisma/client";
import { buildProposals, mergeFillNulls } from "./ropewikiDedupe";
import type { RopeWikiCanyon } from "./ropewiki";

function canyon(overrides: Partial<Canyon> = {}): Canyon {
  return {
    id: "c1",
    name: "Test Canyon",
    altNames: [],
    latitude: -33.5,
    longitude: 150.3,
    numAbseils: null,
    longestAbseil: null,
    vGrade: null,
    aGrade: null,
    commitment: null,
    quality: null,
    hours: null,
    attributes: null,
    ...overrides,
  } as unknown as Canyon;
}

function rwCanyon(overrides: Partial<RopeWikiCanyon> = {}): RopeWikiCanyon {
  return {
    ropeWikiId: 100,
    name: "Test Canyon",
    latitude: -33.5,
    longitude: 150.3,
    numAbseils: 5,
    longestAbseil: 20,
    vGrade: 4,
    aGrade: 3,
    commitment: 3,
    quality: 4,
    hours: 6,
    attributes: { sources: [["RopeWiki", "http://rw/100"]] },
    ...overrides,
  };
}

describe("buildProposals", () => {
  it("auto-links an exact name match at the same location", () => {
    const [p] = buildProposals([rwCanyon()], [canyon()]);
    expect(p.tier).toBe("autoLink");
    expect(p.bestCanyonId).toBe("c1");
    expect(p.candidates[0].nameMatch).toBe(true);
    expect(p.candidates[0].distanceMeters).toBeLessThan(250);
  });

  it("returns the create tier when no existing canyon is nearby", () => {
    const far = canyon({ id: "far", latitude: -34.5, longitude: 151.5 });
    const [p] = buildProposals([rwCanyon()], [far]);
    expect(p.tier).toBe("create");
    expect(p.candidates).toEqual([]);
    expect(p.bestCanyonId).toBeNull();
  });

  it("reviews a near match with a different name", () => {
    const existing = canyon({ name: "Completely Different Place" });
    const [p] = buildProposals([rwCanyon()], [existing]);
    // Within auto-link distance but no name match → review, not autoLink.
    expect(p.tier).toBe("review");
    expect(p.bestCanyonId).toBeNull();
  });

  it("demotes the lower-scoring row when two rows auto-link the same canyon", () => {
    const target = canyon();
    const closer = rwCanyon({ ropeWikiId: 1, latitude: -33.5, longitude: 150.3 });
    const farther = rwCanyon({ ropeWikiId: 2, latitude: -33.5008, longitude: 150.3 });
    const proposals = buildProposals([closer, farther], [target]);
    const byId = Object.fromEntries(proposals.map((p) => [p.ropeWikiId, p]));
    // Exactly one keeps the auto-link to c1; the other is demoted to review.
    const autoLinked = proposals.filter((p) => p.tier === "autoLink");
    expect(autoLinked).toHaveLength(1);
    expect(autoLinked[0].ropeWikiId).toBe(1); // closest wins
    expect(byId[2].tier).toBe("review");
    expect(byId[2].bestCanyonId).toBeNull();
  });

  it("prefers an alt-name match", () => {
    const existing = canyon({ name: "Other", altNames: ["Test Canyon"] });
    const [p] = buildProposals([rwCanyon()], [existing]);
    expect(p.candidates[0].nameMatch).toBe(true);
  });
});

describe("mergeFillNulls", () => {
  it("fills only null scalar fields and preserves existing user data", () => {
    const existing = canyon({ vGrade: 2, numAbseils: null, hours: null });
    const merged = mergeFillNulls(existing, rwCanyon());
    expect(merged.vGrade).toBe(2); // user value preserved
    expect(merged.numAbseils).toBe(5); // null filled from RopeWiki
    expect(merged.hours).toBe(6);
    expect(merged.ropeWikiId).toBe(100);
  });

  it("reports exactly the fields RopeWiki contributed", () => {
    const existing = canyon({ vGrade: 2, quality: 5 }); // these two are non-null
    const merged = mergeFillNulls(existing, rwCanyon());
    expect(merged.ropeWikiOwnedFields).not.toContain("vGrade");
    expect(merged.ropeWikiOwnedFields).not.toContain("quality");
    expect(merged.ropeWikiOwnedFields).toContain("numAbseils");
    expect(merged.ropeWikiOwnedFields).toContain("hours");
  });

  it("unions sources by URL, preserving existing entries", () => {
    const existing = canyon({ attributes: { sources: [["OzUltimate", "http://oz/1"]] } });
    const merged = mergeFillNulls(existing, rwCanyon());
    const sources = (merged.attributes as { sources: [string, string][] }).sources;
    const urls = sources.map(([, u]) => u);
    expect(urls).toContain("http://oz/1");
    expect(urls).toContain("http://rw/100");
  });

  it("does not duplicate a source already present by URL", () => {
    const existing = canyon({ attributes: { sources: [["RopeWiki", "http://rw/100"]] } });
    const merged = mergeFillNulls(existing, rwCanyon());
    const sources = (merged.attributes as { sources: [string, string][] }).sources;
    expect(sources.filter(([, u]) => u === "http://rw/100")).toHaveLength(1);
  });
});
