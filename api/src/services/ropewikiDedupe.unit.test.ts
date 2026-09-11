import { describe, it, expect } from "vitest";
import type { Place } from "@prisma/client";
import { buildProposals, mergeFillNulls } from "./ropewikiDedupe";
import type { RopeWikiCanyon } from "./ropewiki";

function place(overrides: Partial<Place> = {}): Place {
  return {
    id: "c1",
    name: "Test Place",
    altNames: [],
    latitude: -33.5,
    longitude: 150.3,
    fieldValues: {},
    ...overrides,
  } as unknown as Place;
}

/** A place carrying the given field values. The seven scalars are keys now, so
 *  "is it null" became "is the key absent" — the same question, because no
 *  write path stores a null. */
function placeWith(values: Record<string, unknown>): Place {
  return place({ fieldValues: values } as Partial<Place>);
}

function rwCanyon(overrides: Partial<RopeWikiCanyon> = {}): RopeWikiCanyon {
  return {
    ropeWikiId: 100,
    name: "Test Place",
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
    const [p] = buildProposals([rwCanyon()], [place()]);
    expect(p.tier).toBe("autoLink");
    expect(p.bestPlaceId).toBe("c1");
    expect(p.candidates[0].nameMatch).toBe(true);
    expect(p.candidates[0].distanceMeters).toBeLessThan(250);
  });

  it("returns the create tier when no existing place is nearby", () => {
    const far = place({ id: "far", latitude: -34.5, longitude: 151.5 });
    const [p] = buildProposals([rwCanyon()], [far]);
    expect(p.tier).toBe("create");
    expect(p.candidates).toEqual([]);
    expect(p.bestPlaceId).toBeNull();
  });

  it("reviews a near match with a different name", () => {
    const existing = place({ name: "Completely Different Place" });
    const [p] = buildProposals([rwCanyon()], [existing]);
    // Within auto-link distance but no name match → review, not autoLink.
    expect(p.tier).toBe("review");
    expect(p.bestPlaceId).toBeNull();
  });

  it("demotes the lower-scoring row when two rows auto-link the same place", () => {
    const target = place();
    const closer = rwCanyon({ ropeWikiId: 1, latitude: -33.5, longitude: 150.3 });
    const farther = rwCanyon({ ropeWikiId: 2, latitude: -33.5008, longitude: 150.3 });
    const proposals = buildProposals([closer, farther], [target]);
    const byId = Object.fromEntries(proposals.map((p) => [p.ropeWikiId, p]));
    // Exactly one keeps the auto-link to c1; the other is demoted to review.
    const autoLinked = proposals.filter((p) => p.tier === "autoLink");
    expect(autoLinked).toHaveLength(1);
    expect(autoLinked[0].ropeWikiId).toBe(1); // closest wins
    expect(byId[2].tier).toBe("review");
    expect(byId[2].bestPlaceId).toBeNull();
  });

  it("prefers an alt-name match", () => {
    const existing = place({ name: "Other", altNames: ["Test Place"] });
    const [p] = buildProposals([rwCanyon()], [existing]);
    expect(p.candidates[0].nameMatch).toBe(true);
  });
});

describe("mergeFillNulls", () => {
  it("fills only empty fields and preserves existing user data", () => {
    const existing = placeWith({ v_grade: 2 });
    const merged = mergeFillNulls(existing, rwCanyon());
    expect(merged.fieldValues.v_grade).toBe(2); // user value preserved
    expect(merged.fieldValues.num_abseils).toBe(5); // filled from RopeWiki
    expect(merged.fieldValues.hours).toBe(6);
    expect(merged.ropeWikiId).toBe(100);
  });

  // The RopeWiki DTO and its stored snapshot keep camelCase names; the place
  // side speaks reserved field keys. This asserts the translation happens.
  it("writes RopeWiki's values under the reserved field keys", () => {
    const merged = mergeFillNulls(place(), rwCanyon());
    expect(Object.keys(merged.fieldValues).sort()).toContain("num_abseils");
    expect(merged.fieldValues).not.toHaveProperty("numAbseils");
  });

  it("reports exactly the fields RopeWiki contributed", () => {
    const existing = placeWith({ v_grade: 2, quality: 5 });
    const merged = mergeFillNulls(existing, rwCanyon());
    expect(merged.ropeWikiOwnedFields).not.toContain("vGrade");
    expect(merged.ropeWikiOwnedFields).not.toContain("quality");
    expect(merged.ropeWikiOwnedFields).toContain("numAbseils");
    expect(merged.ropeWikiOwnedFields).toContain("hours");
  });

  it("unions sources by URL, preserving existing entries", () => {
    const existing = placeWith({ _sources: [["OzUltimate", "http://oz/1"]] });
    const merged = mergeFillNulls(existing, rwCanyon());
    const sources = merged.fieldValues._sources as [string, string][];
    const urls = sources.map(([, u]) => u);
    expect(urls).toContain("http://oz/1");
    expect(urls).toContain("http://rw/100");
  });

  it("does not duplicate a source already present by URL", () => {
    const existing = placeWith({ _sources: [["RopeWiki", "http://rw/100"]] });
    const merged = mergeFillNulls(existing, rwCanyon());
    const sources = merged.fieldValues._sources as [string, string][];
    expect(sources.filter(([, u]) => u === "http://rw/100")).toHaveLength(1);
  });
});
