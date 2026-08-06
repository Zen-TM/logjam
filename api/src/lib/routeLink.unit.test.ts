// The linking rule: a canyon holds at most one route, and claiming an
// occupied slot DISPLACES the incumbent by unlinking it — never deleting it.
// These tests pin both halves: the survival of the displaced route, and the
// tombstone fan-out that revokes sharee visibility when a route leaves a
// canyon (the leg with no delete behind it, so nothing else would catch it).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/prisma", () => ({ default: {} }));

import { applyRouteCanyonLink } from "./routeLink";

type Row = { id: string; name: string; ownerId: string };

/** Minimal in-memory stand-in for the Prisma transaction client. */
function makeTx(opts: {
  /** canyonId → the route currently occupying that slot. */
  occupants?: Record<string, Row>;
  /** canyonId → sharee user ids. */
  sharees?: Record<string, string[]>;
}) {
  const occupants = opts.occupants ?? {};
  const sharees = opts.sharees ?? {};
  const updates: { id: string; canyonId: string | null }[] = [];
  const tombstones: { userId: string; entityType: string; entityId: string }[] = [];

  const tx = {
    canyonShare: {
      findMany: async ({ where }: { where: { canyonId: string } }) =>
        (sharees[where.canyonId] ?? []).map((sharedWithId) => ({ sharedWithId })),
    },
    route: {
      findUnique: async ({ where }: { where: { canyonId: string } }) =>
        occupants[where.canyonId] ?? null,
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { canyonId: string | null };
      }) => {
        updates.push({ id: where.id, canyonId: data.canyonId });
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

describe("applyRouteCanyonLink", () => {
  it("is a no-op when the canyon is unchanged", async () => {
    const { tx, updates, tombstones } = makeTx({});
    const result = await applyRouteCanyonLink(tx, {
      routeId: "r1",
      canyonId: "c1",
      currentCanyonId: "c1",
    });
    expect(result.displacedRoute).toBeNull();
    expect(updates).toEqual([]);
    expect(tombstones).toEqual([]);
  });

  it("links into an empty slot without displacing anything", async () => {
    const { tx, updates, tombstones } = makeTx({ sharees: { c1: [] } });
    const result = await applyRouteCanyonLink(tx, {
      routeId: "r1",
      canyonId: "c1",
      currentCanyonId: null,
    });
    expect(result.displacedRoute).toBeNull();
    expect(updates).toEqual([{ id: "r1", canyonId: "c1" }]);
    expect(tombstones).toEqual([]);
  });

  it("displaces the incumbent by UNLINKING it, never deleting it", async () => {
    const { tx, updates } = makeTx({
      occupants: { c1: { id: "r-old", name: "Original approach", ownerId: "alice" } },
    });
    const result = await applyRouteCanyonLink(tx, {
      routeId: "r-new",
      canyonId: "c1",
      currentCanyonId: null,
    });
    // The caller needs the name to warn the user which route moved.
    expect(result.displacedRoute).toEqual({ id: "r-old", name: "Original approach" });
    // The incumbent is unlinked (canyonId → null), NOT removed.
    expect(updates).toEqual([
      { id: "r-old", canyonId: null },
      { id: "r-new", canyonId: "c1" },
    ]);
  });

  it("revokes the displaced route from the canyon's sharees", async () => {
    const { tx, tombstones } = makeTx({
      occupants: { c1: { id: "r-old", name: "Original", ownerId: "alice" } },
      sharees: { c1: ["bob", "carol"] },
    });
    await applyRouteCanyonLink(tx, {
      routeId: "r-new",
      canyonId: "c1",
      currentCanyonId: null,
    });
    expect(tombstones).toEqual([
      { userId: "bob", entityType: "route", entityId: "r-old" },
      { userId: "carol", entityType: "route", entityId: "r-old" },
    ]);
    // The owner keeps it — it is still their route, just standalone now.
    expect(tombstones.some((t) => t.userId === "alice")).toBe(false);
  });

  it("revokes from the OLD canyon's sharees when a route moves between canyons", async () => {
    const { tx, updates, tombstones } = makeTx({
      sharees: { c1: ["bob"], c2: ["carol"] },
    });
    await applyRouteCanyonLink(tx, {
      routeId: "r1",
      canyonId: "c2",
      currentCanyonId: "c1",
    });
    // bob loses it (route left c1); carol gains it via the normal delta pull,
    // which needs no tombstone.
    expect(tombstones).toEqual([
      { userId: "bob", entityType: "route", entityId: "r1" },
    ]);
    expect(updates).toEqual([{ id: "r1", canyonId: "c2" }]);
  });

  it("revokes from sharees on a plain unlink", async () => {
    const { tx, updates, tombstones } = makeTx({ sharees: { c1: ["bob"] } });
    await applyRouteCanyonLink(tx, {
      routeId: "r1",
      canyonId: null,
      currentCanyonId: "c1",
    });
    expect(tombstones).toEqual([
      { userId: "bob", entityType: "route", entityId: "r1" },
    ]);
    expect(updates).toEqual([{ id: "r1", canyonId: null }]);
  });

  it("does not displace itself when re-linked to the canyon it already holds", async () => {
    // Guards the unique-index ordering: finding yourself in the slot must not
    // unlink you a moment before you claim it.
    const { tx, updates } = makeTx({
      occupants: { c1: { id: "r1", name: "Mine", ownerId: "alice" } },
      sharees: { c1: [] },
    });
    const result = await applyRouteCanyonLink(tx, {
      routeId: "r1",
      canyonId: "c1",
      currentCanyonId: null,
    });
    expect(result.displacedRoute).toBeNull();
    expect(updates).toEqual([{ id: "r1", canyonId: "c1" }]);
  });
});
