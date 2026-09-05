import { describe, it, expect, vi } from "vitest";

// The route module imports the Prisma singleton at load; mock it so importing
// the pure helper under test doesn't require a DB connection.
vi.mock("../services/prisma", () => ({
  default: {
    tripLog: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    place: { count: vi.fn() },
    media: { findMany: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { resolvePatchedTripTypes } from "./tripLogsGlobal";
import { CANYONING_TRIP_TYPE, MAX_TRIP_TYPES_PER_TRIP } from "@logjam/shared";

// PATCH /trips/:id has two independently-optional fields (types, placeIds) →
// four combinations. enforceCanyoningTag itself is exhaustively unit-tested in
// shared/src/tripName.test.ts; this covers the resolution of each field to its
// post-PATCH value, which is where the tag gets silently stripped if the stored
// link state isn't consulted.
describe("resolvePatchedTripTypes — the four PATCH combinations", () => {
  describe("types set, placeIds set", () => {
    it("tags from the incoming types and the incoming link set", () => {
      const { types, changed } = resolvePatchedTripTypes({
        parsedTypes: [],
        storedTypes: [],
        resolvedPlaceIds: ["place-1"],
        storedHasLinkedPlace: false,
      });
      expect(types).toEqual([CANYONING_TRIP_TYPE]);
      expect(changed).toBe(true);
    });

    it("does not tag when the incoming link set is empty (unlink + retype)", () => {
      const { types, changed } = resolvePatchedTripTypes({
        parsedTypes: ["bushwalking"],
        storedTypes: [CANYONING_TRIP_TYPE],
        resolvedPlaceIds: [],
        storedHasLinkedPlace: true,
      });
      expect(types).toEqual(["bushwalking"]);
      expect(changed).toBe(true);
    });
  });

  describe("types set, placeIds absent — the trap", () => {
    it("PATCHing types: [] on a place-linked trip keeps the tag", () => {
      // The request omits placeIds, so the trip's STORED link state decides.
      const { types, changed } = resolvePatchedTripTypes({
        parsedTypes: [],
        storedTypes: [CANYONING_TRIP_TYPE],
        resolvedPlaceIds: undefined,
        storedHasLinkedPlace: true,
      });
      expect(types).toEqual([CANYONING_TRIP_TYPE]);
      expect(changed).toBe(true);
    });

    it("PATCHing unrelated types on a place-linked trip appends the tag", () => {
      const { types } = resolvePatchedTripTypes({
        parsedTypes: ["bushwalking"],
        storedTypes: [],
        resolvedPlaceIds: undefined,
        storedHasLinkedPlace: true,
      });
      expect(types).toEqual(["bushwalking", CANYONING_TRIP_TYPE]);
    });

    it("PATCHing types: [] on a place-less trip really does clear them", () => {
      const { types, changed } = resolvePatchedTripTypes({
        parsedTypes: [],
        storedTypes: ["bushwalking"],
        resolvedPlaceIds: undefined,
        storedHasLinkedPlace: false,
      });
      expect(types).toEqual([]);
      expect(changed).toBe(true);
    });

    it("respects a case variant in the incoming types", () => {
      const { types } = resolvePatchedTripTypes({
        parsedTypes: ["Canyoning"],
        storedTypes: [],
        resolvedPlaceIds: undefined,
        storedHasLinkedPlace: true,
      });
      expect(types).toEqual(["Canyoning"]);
    });
  });

  describe("types absent, placeIds set", () => {
    it("linking a place to an untagged trip tags it", () => {
      const { types, changed } = resolvePatchedTripTypes({
        parsedTypes: undefined,
        storedTypes: [],
        resolvedPlaceIds: ["place-1"],
        storedHasLinkedPlace: false,
      });
      expect(types).toEqual([CANYONING_TRIP_TYPE]);
      expect(changed).toBe(true);
    });

    it("unlinking the last place never force-removes the tag", () => {
      const { types, changed } = resolvePatchedTripTypes({
        parsedTypes: undefined,
        storedTypes: [CANYONING_TRIP_TYPE],
        resolvedPlaceIds: [],
        storedHasLinkedPlace: true,
      });
      // The place-less canyoning trip ("I did a place that isn't in my
      // library") is legitimate — and nothing needs writing.
      expect(types).toEqual([CANYONING_TRIP_TYPE]);
      expect(changed).toBe(false);
    });
  });

  describe("types absent, placeIds absent", () => {
    it("is a no-op on an already-tagged place-linked trip", () => {
      const { types, changed } = resolvePatchedTripTypes({
        parsedTypes: undefined,
        storedTypes: [CANYONING_TRIP_TYPE],
        resolvedPlaceIds: undefined,
        storedHasLinkedPlace: true,
      });
      expect(types).toEqual([CANYONING_TRIP_TYPE]);
      expect(changed).toBe(false);
    });

    it("is a no-op on a place-less untagged trip", () => {
      const { changed } = resolvePatchedTripTypes({
        parsedTypes: undefined,
        storedTypes: [],
        resolvedPlaceIds: undefined,
        storedHasLinkedPlace: false,
      });
      expect(changed).toBe(false);
    });

    it("repairs a place-linked trip that predates enforcement", () => {
      // e.g. PATCHing only `notes` on one of the 115 pre-existing trips.
      const { types, changed } = resolvePatchedTripTypes({
        parsedTypes: undefined,
        storedTypes: [],
        resolvedPlaceIds: undefined,
        storedHasLinkedPlace: true,
      });
      expect(types).toEqual([CANYONING_TRIP_TYPE]);
      expect(changed).toBe(true);
    });
  });

  describe("at the type cap", () => {
    const atCap = Array.from({ length: MAX_TRIP_TYPES_PER_TRIP }, (_, i) => `t${i}`);

    it("skips the tag rather than storing an 11th type the validator rejects", () => {
      const { types } = resolvePatchedTripTypes({
        parsedTypes: atCap,
        storedTypes: [],
        resolvedPlaceIds: ["place-1"],
        storedHasLinkedPlace: false,
      });
      expect(types).toHaveLength(MAX_TRIP_TYPES_PER_TRIP);
      expect(types).not.toContain(CANYONING_TRIP_TYPE);
    });

    it("round-trips a stored at-cap place-linked trip without growing it", () => {
      // Reopen → save: the dialog PATCHes the stored array straight back.
      const { types } = resolvePatchedTripTypes({
        parsedTypes: atCap,
        storedTypes: atCap,
        resolvedPlaceIds: ["place-1"],
        storedHasLinkedPlace: true,
      });
      expect(types).toHaveLength(MAX_TRIP_TYPES_PER_TRIP);
    });
  });
});
