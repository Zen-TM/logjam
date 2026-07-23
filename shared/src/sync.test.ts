import { describe, expect, it } from "vitest";
import { isUuidV4, SYNC_ENTITY_TYPES } from "./sync";

describe("isUuidV4", () => {
  it("accepts canonical v4 UUIDs", () => {
    expect(isUuidV4("a2f6f30c-1f9d-4c07-8b3e-2f5d6a7b8c9d")).toBe(true);
    // Uppercase accepted (case-insensitive per RFC 4122 §3).
    expect(isUuidV4("A2F6F30C-1F9D-4C07-8B3E-2F5D6A7B8C9D")).toBe(true);
    // All four variant nibbles.
    for (const variant of ["8", "9", "a", "b"]) {
      expect(isUuidV4(`a2f6f30c-1f9d-4c07-${variant}b3e-2f5d6a7b8c9d`)).toBe(true);
    }
  });

  it("rejects non-v4 and malformed values", () => {
    expect(isUuidV4(undefined)).toBe(false);
    expect(isUuidV4(42)).toBe(false);
    expect(isUuidV4("")).toBe(false);
    expect(isUuidV4("not-a-uuid")).toBe(false);
    // v1 version nibble
    expect(isUuidV4("a2f6f30c-1f9d-1c07-8b3e-2f5d6a7b8c9d")).toBe(false);
    // bad variant nibble
    expect(isUuidV4("a2f6f30c-1f9d-4c07-7b3e-2f5d6a7b8c9d")).toBe(false);
    // wrong length
    expect(isUuidV4("a2f6f30c-1f9d-4c07-8b3e-2f5d6a7b8c9")).toBe(false);
    // no injection through anchoring gaps
    expect(isUuidV4("a2f6f30c-1f9d-4c07-8b3e-2f5d6a7b8c9d\n")).toBe(false);
  });
});

describe("SYNC_ENTITY_TYPES", () => {
  it("covers the six synced entities", () => {
    expect(SYNC_ENTITY_TYPES).toEqual([
      "canyon",
      "tripLog",
      "media",
      "canyonShare",
      "friendship",
      "waypoint",
    ]);
  });
});
