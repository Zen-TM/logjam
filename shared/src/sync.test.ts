import { describe, expect, it } from "vitest";
import {
  decodeSyncCursor,
  encodeSyncCursor,
  isUuidV4,
  parseSyncDeltaCanyonRow,
  parseSyncDeltaTombstone,
  parseSyncDeltaTripRow,
  parseSyncDeltaWaypointRow,
  SYNC_ENTITY_TYPES,
  SyncRowError,
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
  it("covers the eight synced entities", () => {
    expect(SYNC_ENTITY_TYPES).toEqual([
      "canyon",
      "tripLog",
      "media",
      "canyonShare",
      "friendship",
      "waypoint",
      "route",
      "customFieldDef",
    ]);
  });
});

// A tombstone naming an entity this build has never heard of is a NEWER
// SERVER, not corruption. Validating `type` against SYNC_ENTITY_TYPES made
// every addition to that list a breaking change for phones already in the
// field: adding `customFieldDef` made a 0.1.0 build report "dropped 12
// unreadable row(s) from a delta page" — a data-loss warning about rows it
// correctly had nothing to do with. Caught on-device, not by this suite, which
// is why the test exists now.
describe("parseSyncDeltaTombstone", () => {
  it("accepts every known entity type", () => {
    for (const type of SYNC_ENTITY_TYPES) {
      expect(parseSyncDeltaTombstone({ type, id: "x" })).toEqual({ type, id: "x" });
    }
  });

  it("accepts an entity type this build does not know", () => {
    expect(parseSyncDeltaTombstone({ type: "placeType", id: "x" })).toEqual({
      type: "placeType",
      id: "x",
    });
  });

  it("still rejects a malformed SHAPE", () => {
    expect(() => parseSyncDeltaTombstone({ type: "canyon" })).toThrow(SyncRowError);
    expect(() => parseSyncDeltaTombstone({ type: 7, id: "x" })).toThrow(SyncRowError);
    expect(() => parseSyncDeltaTombstone(null)).toThrow(SyncRowError);
  });
});

describe("delta row parsers", () => {
  const canyon = {
    id: "c1",
    ownerId: "u1",
    syncRole: "owner",
    name: "Claustral",
    altNames: [],
    latitude: -33.5,
    longitude: 150.4,
    numAbseils: 6,
    longestAbseil: null,
    vGrade: 4,
    aGrade: 3,
    commitment: 3,
    quality: null,
    hours: 7,
    notes: null,
    attributes: {},
    ropeWikiId: null,
    forkedFromId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  };
  const trip = {
    id: "t1",
    userId: "u1",
    date: "2026-01-01T00:00:00.000Z",
    displayName: null,
    types: ["canyon"],
    notes: null,
    customFields: {},
    canyons: [{ id: "c1", name: "Claustral" }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const waypoint = {
    id: "w1",
    ownerId: "u1",
    syncRole: "shared",
    canyonIds: ["c1"],
    name: "Carpark",
    latitude: -33.5,
    longitude: 150.4,
    elevation: null,
    symbol: null,
    notes: null,
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("accepts well-formed rows and preserves unknown extra keys", () => {
    expect(parseSyncDeltaCanyonRow({ ...canyon, futureField: 1 })).toMatchObject({
      id: "c1",
      futureField: 1,
    });
    expect(parseSyncDeltaTripRow(trip).id).toBe("t1");
    expect(parseSyncDeltaWaypointRow(waypoint).id).toBe("w1");
  });

  it("rejects non-objects", () => {
    for (const value of [null, undefined, 7, "row", []]) {
      expect(() => parseSyncDeltaCanyonRow(value)).toThrow(SyncRowError);
    }
  });

  it("rejects a missing or wrongly-typed field, naming it", () => {
    expect(() =>
      parseSyncDeltaCanyonRow({ ...canyon, latitude: "-33.5" }),
    ).toThrow(/latitude/);
    const { name: _dropped, ...noName } = canyon;
    expect(() => parseSyncDeltaCanyonRow(noName)).toThrow(/name/);
    // Required-but-nullable stays required: undefined is not null.
    expect(() => parseSyncDeltaCanyonRow({ ...canyon, notes: undefined })).toThrow(
      /notes/,
    );
    expect(() => parseSyncDeltaTripRow({ ...trip, canyons: [{ id: "c1" }] })).toThrow(
      /canyons/,
    );
    expect(() =>
      parseSyncDeltaWaypointRow({ ...waypoint, syncRole: "editor" }),
    ).toThrow(/syncRole/);
    expect(() => parseSyncDeltaWaypointRow({ ...waypoint, tags: [1] })).toThrow(
      /tags/,
    );
  });

  it("never puts field VALUES in the message (they are names and coords)", () => {
    try {
      parseSyncDeltaCanyonRow({ ...canyon, latitude: "-33.5", name: 7 });
      throw new Error("expected a throw");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain("latitude");
      expect(message).not.toContain("-33.5");
      expect(message).not.toContain("Claustral");
    }
  });
});
