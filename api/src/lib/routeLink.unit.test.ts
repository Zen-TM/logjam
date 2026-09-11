// The linking rule: a place holds at most one route, and claiming an
// occupied slot DISPLACES the incumbent by unlinking it — never deleting it.
// These tests pin both halves: the survival of the displaced route, and the
// tombstone fan-out that revokes sharee visibility when a route leaves a
// place (the leg with no delete behind it, so nothing else would catch it).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/prisma", () => ({ default: {} }));

import { applyRoutePlaceLink } from "./routeLink";

type Row = { id: string; name: string; ownerId: string };

/** Minimal in-memory stand-in for the Prisma transaction client. */
function makeTx(opts: {
  /** placeId → the route currently occupying that slot. */
  occupants?: Record<string, Row>;
  /** placeId → sharee user ids. */
  sharees?: Record<string, string[]>;
}) {
  const occupants = opts.occupants ?? {};
  const sharees = opts.sharees ?? {};
  const updates: { id: string; placeId: string | null }[] = [];
  const tombstones: { userId: string; entityType: string; entityId: string }[] = [];

  const tx = {
    placeShare: {
      findMany: async ({ where }: { where: { placeId: string } }) =>
        (sharees[where.placeId] ?? []).map((sharedWithId) => ({ sharedWithId })),
    },
    route: {
      findUnique: async ({ where }: { where: { placeId: string } }) =>
        occupants[where.placeId] ?? null,
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { placeId: string | null };
      }) => {
        updates.push({ id: where.id, placeId: data.placeId });
        return { id: where.id };
      },
    },
    syncTombstone: {
      createMany: async ({ data }: { data: typeof tombstones }) => {
        tombstones.push(...data);
        return { count: data.length };
      },
    },
  };
  return { tx: tx as never, updates, tombstones };
}

describe("applyRoutePlaceLink", () => {
  it("is a no-op when the place is unchanged", async () => {
    const { tx, updates, tombstones } = makeTx({});
    const result = await applyRoutePlaceLink(tx, {
      routeId: "r1",
      placeId: "c1",
      currentPlaceId: "c1",
    });
    expect(result.displacedRoute).toBeNull();
    expect(updates).toEqual([]);
    expect(tombstones).toEqual([]);
  });

  it("links into an empty slot without displacing anything", async () => {
    const { tx, updates, tombstones } = makeTx({ sharees: { c1: [] } });
    const result = await applyRoutePlaceLink(tx, {
      routeId: "r1",
      placeId: "c1",
      currentPlaceId: null,
    });
    expect(result.displacedRoute).toBeNull();
    expect(updates).toEqual([{ id: "r1", placeId: "c1" }]);
    expect(tombstones).toEqual([]);
  });

  it("displaces the incumbent by UNLINKING it, never deleting it", async () => {
    const { tx, updates } = makeTx({
      occupants: { c1: { id: "r-old", name: "Original approach", ownerId: "alice" } },
    });
    const result = await applyRoutePlaceLink(tx, {
      routeId: "r-new",
      placeId: "c1",
      currentPlaceId: null,
    });
    // The caller needs the name to warn the user which route moved.
    expect(result.displacedRoute).toEqual({ id: "r-old", name: "Original approach" });
    // The incumbent is unlinked (placeId → null), NOT removed.
    expect(updates).toEqual([
      { id: "r-old", placeId: null },
      { id: "r-new", placeId: "c1" },
    ]);
  });

  it("revokes the displaced route from the place's sharees", async () => {
    const { tx, tombstones } = makeTx({
      occupants: { c1: { id: "r-old", name: "Original", ownerId: "alice" } },
      sharees: { c1: ["bob", "carol"] },
    });
    await applyRoutePlaceLink(tx, {
      routeId: "r-new",
      placeId: "c1",
      currentPlaceId: null,
    });
    expect(tombstones).toEqual([
      { userId: "bob", entityType: "route", entityId: "r-old" },
      { userId: "carol", entityType: "route", entityId: "r-old" },
    ]);
    // The owner keeps it — it is still their route, just standalone now.
    expect(tombstones.some((t) => t.userId === "alice")).toBe(false);
  });

  it("revokes from the OLD place's sharees when a route moves between places", async () => {
    const { tx, updates, tombstones } = makeTx({
      sharees: { c1: ["bob"], c2: ["carol"] },
    });
    await applyRoutePlaceLink(tx, {
      routeId: "r1",
      placeId: "c2",
      currentPlaceId: "c1",
    });
    // bob loses it (route left c1); carol gains it via the normal delta pull,
    // which needs no tombstone.
    expect(tombstones).toEqual([
      { userId: "bob", entityType: "route", entityId: "r1" },
    ]);
    expect(updates).toEqual([{ id: "r1", placeId: "c2" }]);
  });

  it("revokes from sharees on a plain unlink", async () => {
    const { tx, updates, tombstones } = makeTx({ sharees: { c1: ["bob"] } });
    await applyRoutePlaceLink(tx, {
      routeId: "r1",
      placeId: null,
      currentPlaceId: "c1",
    });
    expect(tombstones).toEqual([
      { userId: "bob", entityType: "route", entityId: "r1" },
    ]);
    expect(updates).toEqual([{ id: "r1", placeId: null }]);
  });

  it("does not displace itself when re-linked to the place it already holds", async () => {
    // Guards the unique-index ordering: finding yourself in the slot must not
    // unlink you a moment before you claim it.
    const { tx, updates } = makeTx({
      occupants: { c1: { id: "r1", name: "Mine", ownerId: "alice" } },
      sharees: { c1: [] },
    });
    const result = await applyRoutePlaceLink(tx, {
      routeId: "r1",
      placeId: "c1",
      currentPlaceId: null,
    });
    expect(result.displacedRoute).toBeNull();
    expect(updates).toEqual([{ id: "r1", placeId: "c1" }]);
  });
});
