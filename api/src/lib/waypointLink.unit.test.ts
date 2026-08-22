import { beforeEach, describe, expect, it, vi } from "vitest";

// resolveWaypointCanyonIds reaches the prisma singleton at module scope; the
// visibility logic under test never does — it works on the caller's tx.
vi.mock("../services/prisma", () => ({ default: {} }));

import {
  applyWaypointCanyonLinks,
  serializeWaypointFor,
  snapshotCanyonWaypointVisibility,
  snapshotWaypointVisibility,
  writeWaypointVisibilityLoss,
} from "./waypointLink";
import type { Prisma } from "@prisma/client";

/**
 * The smallest fake that can answer the only question this file exists to
 * answer: after a link change, who can still reach the waypoint?
 *
 * Two tables, and the three calls the helpers make against them. A real DB is
 * not needed to prove the DIFF is right, and mocked-Prisma is the house rule
 * for unit tests anyway.
 */
function fakeTx(
  links: { canyonId: string; waypointId: string }[],
  shares: { canyonId: string; sharedWithId: string }[],
) {
  const tombstones: { userId: string; entityType: string; entityId: string }[] =
    [];
  const matches = (
    link: { canyonId: string; waypointId: string },
    where: Record<string, unknown>,
  ): boolean => {
    const byWaypoint = where.waypointId as
      | string
      | { in?: string[]; notIn?: string[] }
      | undefined;
    const byCanyon = where.canyonId as
      | string
      | { in?: string[]; notIn?: string[] }
      | undefined;
    const test = (
      value: string,
      clause: string | { in?: string[]; notIn?: string[] } | undefined,
    ): boolean => {
      if (clause === undefined) return true;
      if (typeof clause === "string") return value === clause;
      if (clause.in) return clause.in.includes(value);
      if (clause.notIn) return !clause.notIn.includes(value);
      return true;
    };
    return test(link.waypointId, byWaypoint) && test(link.canyonId, byCanyon);
  };

  const tx = {
    canyonWaypoint: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        links
          .filter((link) => matches(link, where))
          .map((link) => ({
            waypointId: link.waypointId,
            canyonId: link.canyonId,
            canyon: {
              shares: shares
                .filter((share) => share.canyonId === link.canyonId)
                .map((share) => ({ sharedWithId: share.sharedWithId })),
            },
          })),
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        for (let i = links.length - 1; i >= 0; i -= 1) {
          if (matches(links[i], where)) links.splice(i, 1);
        }
        return { count: 0 };
      },
      createMany: async ({
        data,
      }: {
        data: { canyonId: string; waypointId: string }[];
      }) => {
        for (const row of data) {
          const exists = links.some(
            (link) =>
              link.canyonId === row.canyonId &&
              link.waypointId === row.waypointId,
          );
          if (!exists) links.push({ ...row });
        }
        return { count: data.length };
      },
    },
    syncTombstone: {
      createMany: async ({ data }: { data: typeof tombstones }) => {
        tombstones.push(...data);
        return { count: data.length };
      },
    },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, tombstones, links };
}

const revokedUsers = (
  tombstones: { userId: string; entityType: string; entityId: string }[],
  waypointId: string,
): string[] =>
  tombstones
    .filter((row) => row.entityType === "waypoint" && row.entityId === waypointId)
    .map((row) => row.userId);

describe("snapshotWaypointVisibility", () => {
  it("collects every sharee that any linked canyon grants", async () => {
    const { tx } = fakeTx(
      [
        { canyonId: "canyonA", waypointId: "carpark" },
        { canyonId: "canyonB", waypointId: "carpark" },
      ],
      [
        { canyonId: "canyonA", sharedWithId: "bob" },
        { canyonId: "canyonB", sharedWithId: "carol" },
      ],
    );
    const snapshot = await snapshotWaypointVisibility(tx, ["carpark"]);
    expect([...snapshot.get("carpark")!].sort()).toEqual(["bob", "carol"]);
  });

  it("gives an unlinked waypoint an empty viewer set, not a missing key", async () => {
    const { tx } = fakeTx([], []);
    const snapshot = await snapshotWaypointVisibility(tx, ["private"]);
    expect(snapshot.get("private")).toEqual(new Set());
  });
});

describe("writeWaypointVisibilityLoss (the many-to-many guard)", () => {
  it("does NOT revoke when a second shared canyon still reaches it", async () => {
    // Bob is shared on BOTH canyons the carpark is linked to. Unlinking one of
    // them costs him nothing — the naive "sharees of the canyon we just left"
    // rule would have deleted the carpark from his mirror.
    const { tx, tombstones } = fakeTx(
      [
        { canyonId: "canyonA", waypointId: "carpark" },
        { canyonId: "canyonB", waypointId: "carpark" },
      ],
      [
        { canyonId: "canyonA", sharedWithId: "bob" },
        { canyonId: "canyonB", sharedWithId: "bob" },
      ],
    );

    await applyWaypointCanyonLinks(tx, {
      waypointId: "carpark",
      canyonIds: ["canyonB"],
    });

    expect(revokedUsers(tombstones, "carpark")).toEqual([]);
  });

  it("revokes when the unlinked canyon was the last path", async () => {
    const { tx, tombstones } = fakeTx(
      [
        { canyonId: "canyonA", waypointId: "carpark" },
        { canyonId: "canyonB", waypointId: "carpark" },
      ],
      [
        { canyonId: "canyonA", sharedWithId: "bob" },
        { canyonId: "canyonB", sharedWithId: "carol" },
      ],
    );

    await applyWaypointCanyonLinks(tx, {
      waypointId: "carpark",
      canyonIds: ["canyonB"],
    });

    // Bob loses his only path; Carol still holds canyonB.
    expect(revokedUsers(tombstones, "carpark")).toEqual(["bob"]);
  });

  it("revokes every viewer when the last link goes", async () => {
    const { tx, tombstones, links } = fakeTx(
      [
        { canyonId: "canyonA", waypointId: "carpark" },
        { canyonId: "canyonB", waypointId: "carpark" },
      ],
      [
        { canyonId: "canyonA", sharedWithId: "bob" },
        { canyonId: "canyonB", sharedWithId: "carol" },
      ],
    );

    // Empty list is the "unlink everything" path — the one an empty `notIn`
    // would silently turn into a no-op.
    await applyWaypointCanyonLinks(tx, { waypointId: "carpark", canyonIds: [] });

    expect(links).toEqual([]);
    expect(revokedUsers(tombstones, "carpark").sort()).toEqual(["bob", "carol"]);
  });

  it("writes nothing when a link is ADDED", async () => {
    const { tx, tombstones } = fakeTx(
      [{ canyonId: "canyonA", waypointId: "carpark" }],
      [
        { canyonId: "canyonA", sharedWithId: "bob" },
        { canyonId: "canyonB", sharedWithId: "carol" },
      ],
    );

    await applyWaypointCanyonLinks(tx, {
      waypointId: "carpark",
      canyonIds: ["canyonA", "canyonB"],
    });

    expect(revokedUsers(tombstones, "carpark")).toEqual([]);
  });

  it("ignores waypoints nobody could see, so an unshared edit is silent", async () => {
    const { tx, tombstones } = fakeTx(
      [{ canyonId: "canyonA", waypointId: "secret" }],
      [],
    );

    await applyWaypointCanyonLinks(tx, {
      waypointId: "secret",
      canyonIds: [],
    });

    expect(tombstones).toEqual([]);
  });
});

describe("snapshotCanyonWaypointVisibility", () => {
  let fixture: ReturnType<typeof fakeTx>;

  beforeEach(() => {
    fixture = fakeTx(
      [
        { canyonId: "canyonA", waypointId: "carpark" },
        { canyonId: "canyonB", waypointId: "carpark" },
        { canyonId: "canyonA", waypointId: "exit" },
      ],
      [
        { canyonId: "canyonA", sharedWithId: "bob" },
        { canyonId: "canyonB", sharedWithId: "bob" },
      ],
    );
  });

  it("covers every waypoint the canyon carries", async () => {
    const snapshot = await snapshotCanyonWaypointVisibility(
      fixture.tx,
      "canyonA",
    );
    expect([...snapshot.keys()].sort()).toEqual(["carpark", "exit"]);
  });

  it("survives a canyon delete: only the waypoint that loses its last path is revoked", async () => {
    // Exactly the shape of the canyon-delete site — snapshot, cascade the link
    // rows away, then diff.
    const before = await snapshotCanyonWaypointVisibility(fixture.tx, "canyonA");
    await fixture.tx.canyonWaypoint.deleteMany({
      where: { canyonId: "canyonA" },
    });
    await writeWaypointVisibilityLoss(fixture.tx, before);

    // The carpark survives in Bob's mirror via canyonB; the exit does not.
    expect(revokedUsers(fixture.tombstones, "carpark")).toEqual([]);
    expect(revokedUsers(fixture.tombstones, "exit")).toEqual(["bob"]);
  });
});

// Root CLAUDE.md: "Owner-private extends to derived cardinality, not just the
// rows." The share fan-out is named there explicitly, and the warning attached
// to it is that a test asserting the LIST is withheld still passes while the
// COUNT leaks. So these assert the count's absence directly.
describe("serializeWaypointFor sharedCount (owner-private cardinality)", () => {
  const OWNER = "user-owner";
  const SHAREE = "user-sharee";
  const waypoint = {
    id: "wp-1",
    ownerId: OWNER,
    name: "Carpark",
    canyonId: null,
    canyonLinks: [{ canyonId: "canyon-1" }],
  } as unknown as Parameters<typeof serializeWaypointFor>[0];

  it("gives the owner the count of people they shared it with", () => {
    const row = serializeWaypointFor(
      waypoint,
      OWNER,
      new Set(),
      new Map([["wp-1", 3]]),
    );
    expect(row).toMatchObject({ syncRole: "owner", sharedCount: 3 });
  });

  it("reports 0 for an owned waypoint absent from the count map", () => {
    const row = serializeWaypointFor(waypoint, OWNER, new Set(), new Map());
    expect(row).toMatchObject({ sharedCount: 0 });
  });

  it("NEVER sends sharedCount to a recipient, even when a count exists", () => {
    const row = serializeWaypointFor(
      waypoint,
      SHAREE,
      new Set(["canyon-1"]),
      new Map([["wp-1", 3]]),
    );
    expect(row.syncRole).toBe("shared");
    // How many OTHER people hold this waypoint is the owner's business.
    expect(row).not.toHaveProperty("sharedCount");
  });

  it("OMITS the field entirely when no map is supplied, rather than faking 0", () => {
    // The write paths have no map to consult. A fabricated 0 would tell the
    // client a waypoint with three recipients has none; absent means
    // "unchanged" and only the delta is authoritative.
    const row = serializeWaypointFor(waypoint, OWNER, new Set());
    expect(row).not.toHaveProperty("sharedCount");
  });
});
