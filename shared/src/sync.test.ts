import { describe, expect, it } from "vitest";
import {
  decodeSyncCursor,
  encodeSyncCursor,
  isUuidV4,
  SYNC_ENTITY_TYPES,
} from "./sync";

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

describe("sync cursor codec", () => {
  it("round-trips a plain watermark cursor", () => {
    const cursor = { v: 1, ts: "2026-07-24T01:00:00.000Z" };
    expect(decodeSyncCursor(encodeSyncCursor(cursor))).toEqual(cursor);
  });

  it("round-trips mid-pagination keysets", () => {
    const cursor = {
      v: 1,
      ts: "2026-07-24T01:00:00.000Z",
      k: {
        tripLogs: [
          "2026-07-24T00:59:12.345Z",
          "a2f6f30c-1f9d-4c07-8b3e-2f5d6a7b8c9d",
        ] as [string, string],
        tombstones: ["2026-07-24T00:58:00.000Z", "12345"] as [string, string],
      },
    };
    expect(decodeSyncCursor(encodeSyncCursor(cursor))).toEqual(cursor);
  });

  it("output is base64url-safe (no +, /, =)", () => {
    const encoded = encodeSyncCursor({
      v: 1,
      ts: "2026-07-24T01:00:00.000Z",
      k: { canyons: ["2026-07-24T00:00:00.000Z", "x".repeat(37)] },
    });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("returns null (→ resetRequired) on any malformation", () => {
    expect(decodeSyncCursor("not base64url!!")).toBeNull();
    expect(decodeSyncCursor(base64ish("[1,2,3]"))).toBeNull();
    expect(decodeSyncCursor(base64ish('{"v":"1","ts":"2026-01-01"}'))).toBeNull();
    expect(decodeSyncCursor(base64ish('{"v":1,"ts":"garbage"}'))).toBeNull();
    expect(decodeSyncCursor(base64ish('{"v":1}'))).toBeNull();
    expect(
      decodeSyncCursor(base64ish('{"v":1,"ts":"2026-01-01","k":{"a":["x"]}}')),
    ).toBeNull();
    expect(
      decodeSyncCursor(
        base64ish('{"v":1,"ts":"2026-01-01","k":{"a":["garbage","id"]}}'),
      ),
    ).toBeNull();
  });

  // Encode arbitrary JSON through the same alphabet the codec uses, without
  // exporting the private helper: round-trip a valid cursor to steal nothing —
  // just re-encode with Buffer in this Node-only test.
  function base64ish(json: string): string {
    return Buffer.from(json, "ascii")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }
});

describe("SYNC_ENTITY_TYPES", () => {
  it("covers the seven synced entities", () => {
    expect(SYNC_ENTITY_TYPES).toEqual([
      "canyon",
      "tripLog",
      "media",
      "canyonShare",
      "friendship",
      "waypoint",
      "route",
    ]);
  });
});
