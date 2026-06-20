import { describe, it, expect } from "vitest";
import {
  canyonImportKey,
  tripContentHash,
  tripImportKey,
  assignTripImportKeys,
  stableJson,
} from "./importKeys";

describe("canyonImportKey", () => {
  it("produces a deterministic key from name + coords", () => {
    const key1 = canyonImportKey("Claustral Creek", -33.5, 150.3);
    const key2 = canyonImportKey("Claustral Creek", -33.5, 150.3);
    expect(key1).toBe(key2);
    expect(key1).toMatch(/^csv:[a-f0-9]{64}$/);
  });

  it("normalizes canyon names so formatting noise does not change the key", () => {
    // "Claustral Creek" vs "claustral creek" — normalization strips case and
    // type-words, so both reduce to the same base.
    const key1 = canyonImportKey("Claustral Creek", -33.5, 150.3);
    const key2 = canyonImportKey("claustral creek", -33.5, 150.3);
    expect(key1).toBe(key2);
  });

  it("is stable across trivial lat/lng precision differences", () => {
    // toFixed(5) rounds both to the same string.
    const key1 = canyonImportKey("Test Canyon", -33.500001, 150.300009);
    const key2 = canyonImportKey("Test Canyon", -33.500002, 150.300009);
    // These differ in the 6th decimal — toFixed(5) should collapse them.
    expect(key1).toBe(key2);
  });

  it("differs for meaningfully different coordinates", () => {
    const key1 = canyonImportKey("Test Canyon", -33.5, 150.3);
    const key2 = canyonImportKey("Test Canyon", -34.5, 151.3);
    expect(key1).not.toBe(key2);
  });

  it("differs for different canyon names", () => {
    const key1 = canyonImportKey("Claustral", -33.5, 150.3);
    const key2 = canyonImportKey("Kanangra", -33.5, 150.3);
    expect(key1).not.toBe(key2);
  });

  it("strips type-words so 'Bell Creek' and 'Bell' produce the same key", () => {
    const key1 = canyonImportKey("Bell Creek", -33.5, 150.3);
    const key2 = canyonImportKey("Bell", -33.5, 150.3);
    expect(key1).toBe(key2);
  });
});

describe("stableJson", () => {
  it("sorts object keys recursively", () => {
    const a = stableJson({ b: 1, a: 2 });
    const b = stableJson({ a: 2, b: 1 });
    expect(a).toBe(b);
  });

  it("handles nested objects", () => {
    const a = stableJson({ x: { b: 1, a: 2 }, y: 3 });
    const b = stableJson({ y: 3, x: { a: 2, b: 1 } });
    expect(a).toBe(b);
  });

  it("preserves array order", () => {
    const a = stableJson([1, 2, 3]);
    const b = stableJson([3, 2, 1]);
    expect(a).not.toBe(b);
  });

  it("returns empty string for null/undefined", () => {
    expect(stableJson(null)).toBe("");
    expect(stableJson(undefined)).toBe("");
  });
});

describe("tripContentHash", () => {
  it("is deterministic for the same inputs", () => {
    const h1 = tripContentHash("Claustral", "2024-01-15", "Great trip", { party: 3 });
    const h2 = tripContentHash("Claustral", "2024-01-15", "Great trip", { party: 3 });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("differs for different notes", () => {
    const h1 = tripContentHash("Claustral", "2024-01-15", "Great trip", null);
    const h2 = tripContentHash("Claustral", "2024-01-15", "Bad trip", null);
    expect(h1).not.toBe(h2);
  });

  it("treats null notes and empty string the same way", () => {
    // Both produce (notes ?? "") which is ""
    const h1 = tripContentHash("Claustral", "2024-01-15", null, null);
    const h2 = tripContentHash("Claustral", "2024-01-15", "", null);
    expect(h1).toBe(h2);
  });

  it("is stable across customFields key reordering", () => {
    const h1 = tripContentHash("Claustral", "2024-01-15", null, { party: 3, rating: 5 });
    const h2 = tripContentHash("Claustral", "2024-01-15", null, { rating: 5, party: 3 });
    expect(h1).toBe(h2);
  });

  it("differs for different sourceCanyonName", () => {
    const h1 = tripContentHash("Claustral", "2024-01-15", null, null);
    const h2 = tripContentHash("Kanangra", "2024-01-15", null, null);
    expect(h1).not.toBe(h2);
  });
});

describe("tripImportKey", () => {
  it("includes content hash and occurrence", () => {
    const key = tripImportKey("abc123", 0);
    expect(key).toBe("trip:abc123:0");
  });

  it("differs for different occurrences", () => {
    const key0 = tripImportKey("abc123", 0);
    const key1 = tripImportKey("abc123", 1);
    expect(key0).not.toBe(key1);
  });
});

describe("assignTripImportKeys", () => {
  it("assigns occurrence 0 to a single trip", () => {
    const trips = [
      { sourceCanyonName: "Claustral", date: "2024-01-15", notes: null, customFields: null },
    ];
    const keys = assignTripImportKeys(trips);
    expect(keys).toHaveLength(1);
    expect(keys[0].occurrence).toBe(0);
    expect(keys[0].importKey).toMatch(/^trip:[a-f0-9]{64}:0$/);
  });

  it("increments occurrence for same-content trips (same canyon, same day)", () => {
    const trips = [
      { sourceCanyonName: "Claustral", date: "2024-01-15", notes: null, customFields: null },
      { sourceCanyonName: "Claustral", date: "2024-01-15", notes: null, customFields: null },
      { sourceCanyonName: "Claustral", date: "2024-01-15", notes: null, customFields: null },
    ];
    const keys = assignTripImportKeys(trips);
    expect(keys[0].occurrence).toBe(0);
    expect(keys[1].occurrence).toBe(1);
    expect(keys[2].occurrence).toBe(2);
    // All have the same contentHash but different importKeys.
    expect(keys[0].contentHash).toBe(keys[1].contentHash);
    expect(keys[0].importKey).not.toBe(keys[1].importKey);
    expect(keys[1].importKey).not.toBe(keys[2].importKey);
  });

  it("does not increment occurrence for different-content trips", () => {
    const trips = [
      { sourceCanyonName: "Claustral", date: "2024-01-15", notes: null, customFields: null },
      { sourceCanyonName: "Kanangra", date: "2024-01-15", notes: null, customFields: null },
    ];
    const keys = assignTripImportKeys(trips);
    expect(keys[0].occurrence).toBe(0);
    expect(keys[1].occurrence).toBe(0);
    expect(keys[0].contentHash).not.toBe(keys[1].contentHash);
  });

  it("re-import of same file produces identical keys", () => {
    const trips = [
      { sourceCanyonName: "Claustral", date: "2024-01-15", notes: "Good", customFields: { party: 3 } },
      { sourceCanyonName: "Claustral", date: "2024-01-15", notes: "Good", customFields: { party: 3 } },
      { sourceCanyonName: "Kanangra", date: "2024-02-01", notes: null, customFields: null },
    ];
    const keys1 = assignTripImportKeys(trips);
    const keys2 = assignTripImportKeys(trips);
    expect(keys1).toEqual(keys2);
  });

  it("different notes produce different content hashes", () => {
    const trips = [
      { sourceCanyonName: "Claustral", date: "2024-01-15", notes: "Trip 1", customFields: null },
      { sourceCanyonName: "Claustral", date: "2024-01-15", notes: "Trip 2", customFields: null },
    ];
    const keys = assignTripImportKeys(trips);
    // Different notes = different contentHash = both occurrence 0.
    expect(keys[0].occurrence).toBe(0);
    expect(keys[1].occurrence).toBe(0);
    expect(keys[0].contentHash).not.toBe(keys[1].contentHash);
  });
});
