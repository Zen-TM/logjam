import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchAndParseRopeWiki,
  snapshotFromCreate,
  snapshotFromLink,
  isRopeWikiOwned,
  snapshotsEqual,
  attributesSourcesEqual,
  type RopeWikiCanyon,
  type RopeWikiSnapshot,
} from "./ropewiki";

function mockFetchCsv(csv: string, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      status,
      text: async () => csv,
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// Use unicode prime (′) and double-prime (″) for minutes/seconds so the coords
// field carries no ASCII double-quote (parseDMS accepts both); the field still
// needs CSV quoting for its embedded comma.
const VALID_CSV = [
  "pageid,location,coords,quality,rating,longest,min time,number of rappels",
  '12345,Test Canyon,"33° 33′ 3.82″ S, 150° 24′ 6.13″ E",4,3B (v3a2 III),50 feet,4-6 hours,3-5',
  'notanum,Bad Page,"33° 1′ 1″ S, 150° 1′ 1″ E",3,,,,',
  "222,No Coords,,2,,,,",
].join("\n");

describe("fetchAndParseRopeWiki", () => {
  it("parses a valid row across every derived field", async () => {
    mockFetchCsv(VALID_CSV);
    const { canyons, errors } = await fetchAndParseRopeWiki();
    expect(canyons).toHaveLength(1);
    const c = canyons[0];
    expect(c.ropeWikiId).toBe(12345);
    expect(c.name).toBe("Test Canyon");
    // DMS → decimal degrees (S/negative lat, E/positive lon).
    expect(c.latitude).toBeCloseTo(-33.55106, 4);
    expect(c.longitude).toBeCloseTo(150.40170, 4);
    expect(c.vGrade).toBe(3);
    expect(c.aGrade).toBe(2);
    expect(c.commitment).toBe(3); // III
    expect(c.quality).toBe(4);
    expect(c.numAbseils).toBe(3); // first of "3-5"
    expect(c.longestAbseil).toBe(15.2); // 50 ft → m
    expect(c.hours).toBe(5); // mean of 4-6
    expect(c.attributes.sources?.[0][0]).toBe("RopeWiki");
  });

  it("accumulates a per-row error for an invalid pageid and missing coords", async () => {
    mockFetchCsv(VALID_CSV);
    const { errors } = await fetchAndParseRopeWiki();
    expect(errors).toHaveLength(2);
    expect(errors.some((e) => /invalid PAGEID/.test(e))).toBe(true);
    expect(errors.some((e) => /could not parse coordinates/.test(e))).toBe(true);
  });

  it("throws on a non-OK HTTP response", async () => {
    mockFetchCsv("", false, 503);
    await expect(fetchAndParseRopeWiki()).rejects.toThrow(/HTTP 503/);
  });

  it("throws when a required column is missing", async () => {
    mockFetchCsv("location,coords\nFoo,bar"); // no pageid column
    await expect(fetchAndParseRopeWiki()).rejects.toThrow(/missing required column/i);
  });
});

function sampleCanyon(overrides: Partial<RopeWikiCanyon> = {}): RopeWikiCanyon {
  return {
    ropeWikiId: 1,
    name: "Canyon",
    latitude: -33.5,
    longitude: 150.3,
    numAbseils: 5,
    longestAbseil: 20,
    vGrade: 4,
    aGrade: 3,
    commitment: 3,
    quality: 4,
    hours: 6,
    attributes: { sources: [["RopeWiki", "http://rw/1"]] },
    ...overrides,
  };
}

describe("snapshotFromCreate", () => {
  it("marks all fields as RopeWiki-owned", () => {
    const snap = snapshotFromCreate(sampleCanyon());
    expect(snap.ropeWikiOwnedFields).toBe("*");
    expect(snap.name).toBe("Canyon");
    expect(snap.numAbseils).toBe(5);
  });
});

describe("snapshotFromLink", () => {
  it("carries the supplied ownership mask", () => {
    const snap = snapshotFromLink(sampleCanyon(), ["vGrade", "hours"]);
    expect(snap.ropeWikiOwnedFields).toEqual(["vGrade", "hours"]);
  });
});

describe("isRopeWikiOwned", () => {
  it("returns true for any field when ownership is '*'", () => {
    const snap = snapshotFromCreate(sampleCanyon());
    expect(isRopeWikiOwned(snap, "vGrade")).toBe(true);
    expect(isRopeWikiOwned(snap, "hours")).toBe(true);
  });

  it("respects an explicit field list", () => {
    const snap = snapshotFromLink(sampleCanyon(), ["vGrade"]);
    expect(isRopeWikiOwned(snap, "vGrade")).toBe(true);
    expect(isRopeWikiOwned(snap, "hours")).toBe(false);
  });
});

describe("snapshotsEqual", () => {
  const base: RopeWikiSnapshot = snapshotFromCreate(sampleCanyon());

  it("is true for structurally identical snapshots regardless of source order", () => {
    const a = snapshotFromCreate(sampleCanyon({ attributes: { sources: [["A", "u1"], ["B", "u2"]] } }));
    const b = snapshotFromCreate(sampleCanyon({ attributes: { sources: [["B", "u2"], ["A", "u1"]] } }));
    expect(snapshotsEqual(a, b)).toBe(true);
  });

  it("is false when a scalar differs", () => {
    const other = snapshotFromCreate(sampleCanyon({ vGrade: 5 }));
    expect(snapshotsEqual(base, other)).toBe(false);
  });
});

describe("attributesSourcesEqual", () => {
  it("compares sources irrespective of order, treating missing as empty", () => {
    expect(attributesSourcesEqual({ sources: [["A", "u"]] }, { sources: [["A", "u"]] })).toBe(true);
    expect(attributesSourcesEqual(null, { sources: [] })).toBe(true);
    expect(attributesSourcesEqual({ sources: [["A", "u"]] }, { sources: [["A", "v"]] })).toBe(false);
  });
});
