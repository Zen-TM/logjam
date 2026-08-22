import { describe, expect, it } from "vitest";
import {
  canyonDeleteTombstones,
  directShareRevokeTombstones,
  friendshipDeleteTombstones,
  mediaDeleteTombstones,
  routeDeleteTombstones,
  routeUnlinkTombstones,
  shareRevokeTombstones,
  tripDeleteTombstones,
  waypointDeleteTombstones,
  waypointRevokeTombstones,
  type TombstoneRow,
} from "./syncTombstones";

const has = (rows: TombstoneRow[], row: TombstoneRow) =>
  rows.some(
    (r) =>
      r.userId === row.userId &&
      r.entityType === row.entityType &&
      r.entityId === row.entityId,
  );

describe("tripDeleteTombstones", () => {
  it("emits owner tripLog + media rows, no fan-out", () => {
    const rows = tripDeleteTombstones({
      ownerId: "alice",
      tripId: "trip-1",
      mediaIds: ["m1", "m2"],
    });
    expect(rows).toHaveLength(3);
    expect(has(rows, { userId: "alice", entityType: "tripLog", entityId: "trip-1" })).toBe(true);
    expect(has(rows, { userId: "alice", entityType: "media", entityId: "m2" })).toBe(true);
    expect(rows.every((r) => r.userId === "alice")).toBe(true);
  });
});

describe("canyonDeleteTombstones", () => {
  it("fans out canyon + media to every sharee and share rows to the owner", () => {
    const rows = canyonDeleteTombstones({
      ownerId: "alice",
      canyonId: "c1",
      mediaIds: ["m1"],
      shares: [
        { id: "s-bob", sharedWithId: "bob" },
        { id: "s-carol", sharedWithId: "carol" },
      ],
    });
    // owner: canyon + 1 media + 2 canyonShare; each sharee: canyon + 1 media.
    expect(rows).toHaveLength(4 + 2 * 2);
    expect(has(rows, { userId: "alice", entityType: "canyonShare", entityId: "s-bob" })).toBe(true);
    expect(has(rows, { userId: "bob", entityType: "canyon", entityId: "c1" })).toBe(true);
    expect(has(rows, { userId: "bob", entityType: "media", entityId: "m1" })).toBe(true);
    expect(has(rows, { userId: "carol", entityType: "canyon", entityId: "c1" })).toBe(true);
    // Sharees never receive canyonShare tombstones for shares that aren't
    // theirs (a sharee cannot enumerate co-sharees — §4.6.1).
    expect(
      rows.filter((r) => r.entityType === "canyonShare").every((r) => r.userId === "alice"),
    ).toBe(true);
  });

  it("unshared canyon: owner rows only", () => {
    const rows = canyonDeleteTombstones({
      ownerId: "alice",
      canyonId: "c1",
      mediaIds: [],
      shares: [],
    });
    expect(rows).toEqual([
      { userId: "alice", entityType: "canyon", entityId: "c1" },
    ]);
  });
});

describe("mediaDeleteTombstones", () => {
  it("owner + sharees forget the media", () => {
    const rows = mediaDeleteTombstones({
      ownerId: "alice",
      mediaId: "m1",
      shareeIds: ["bob"],
    });
    expect(rows).toHaveLength(2);
    expect(has(rows, { userId: "bob", entityType: "media", entityId: "m1" })).toBe(true);
  });
});

describe("shareRevokeTombstones", () => {
  it("sharee loses canyon + canyon media; owner loses the share row", () => {
    const rows = shareRevokeTombstones({
      canyonOwnerId: "alice",
      shareeId: "bob",
      shareId: "s1",
      canyonId: "c1",
      canyonMediaIds: ["m1", "m2"],
    });
    expect(has(rows, { userId: "bob", entityType: "canyon", entityId: "c1" })).toBe(true);
    expect(has(rows, { userId: "bob", entityType: "media", entityId: "m1" })).toBe(true);
    expect(has(rows, { userId: "alice", entityType: "canyonShare", entityId: "s1" })).toBe(true);
    // The sharee's signal is indistinguishable from a canyon delete: exactly
    // one `canyon` tombstone, nothing owner-only rides along (§4.6.3).
    const shareeRows = rows.filter((r) => r.userId === "bob");
    expect(shareeRows.filter((r) => r.entityType === "canyon")).toHaveLength(1);
    expect(shareeRows.some((r) => r.entityType === "canyonShare")).toBe(false);
  });
});

describe("routeDeleteTombstones", () => {
  it("owner-only for an unlinked route", () => {
    const rows = routeDeleteTombstones({
      ownerId: "alice",
      routeId: "r1",
      shareeIds: [],
    });
    expect(rows).toEqual([
      { userId: "alice", entityType: "route", entityId: "r1" },
    ]);
  });

  it("fans out to every sharee of the linked canyon", () => {
    const rows = routeDeleteTombstones({
      ownerId: "alice",
      routeId: "r1",
      shareeIds: ["bob", "carol"],
    });
    expect(rows).toHaveLength(3);
    expect(has(rows, { userId: "bob", entityType: "route", entityId: "r1" })).toBe(true);
    expect(has(rows, { userId: "carol", entityType: "route", entityId: "r1" })).toBe(true);
  });
});

describe("routeUnlinkTombstones", () => {
  // The trap this guards: unlinking revokes sharee visibility with NO delete
  // anywhere, so without these rows a sharee's mirror keeps the route forever.
  it("revokes from sharees but NOT from the owner, who keeps it standalone", () => {
    const rows = routeUnlinkTombstones({ routeId: "r1", shareeIds: ["bob", "carol"] });
    expect(rows).toHaveLength(2);
    expect(has(rows, { userId: "bob", entityType: "route", entityId: "r1" })).toBe(true);
    expect(rows.some((r) => r.userId === "alice")).toBe(false);
  });

  it("is empty when the canyon had no sharees", () => {
    expect(routeUnlinkTombstones({ routeId: "r1", shareeIds: [] })).toEqual([]);
  });
});

describe("linked routes in canyon-delete and share-revoke", () => {
  it("canyon delete revokes the route from sharees but not the owner", () => {
    // Route.canyonId is SetNull: the route SURVIVES a canyon delete as a
    // standalone route, so the owner must NOT be told to forget it.
    const rows = canyonDeleteTombstones({
      ownerId: "alice",
      canyonId: "c1",
      mediaIds: [],
      shares: [{ id: "s1", sharedWithId: "bob" }],
      routeId: "r1",
    });
    expect(has(rows, { userId: "bob", entityType: "route", entityId: "r1" })).toBe(true);
    expect(has(rows, { userId: "alice", entityType: "route", entityId: "r1" })).toBe(false);
  });

  it("emits no route rows when the canyon had none", () => {
    const rows = canyonDeleteTombstones({
      ownerId: "alice",
      canyonId: "c1",
      mediaIds: [],
      shares: [{ id: "s1", sharedWithId: "bob" }],
      routeId: null,
    });
    expect(rows.some((r) => r.entityType === "route")).toBe(false);
  });

  it("share revoke takes the linked route with the canyon record", () => {
    const rows = shareRevokeTombstones({
      canyonOwnerId: "alice",
      shareeId: "bob",
      shareId: "s1",
      canyonId: "c1",
      canyonMediaIds: [],
      routeId: "r1",
    });
    expect(has(rows, { userId: "bob", entityType: "route", entityId: "r1" })).toBe(true);
    expect(has(rows, { userId: "alice", entityType: "route", entityId: "r1" })).toBe(false);
  });
});

describe("friendshipDeleteTombstones", () => {
  it("both parties forget the edge", () => {
    const rows = friendshipDeleteTombstones({
      friendshipId: "f1",
      userIds: ["alice", "bob"],
    });
    expect(rows).toEqual([
      { userId: "alice", entityType: "friendship", entityId: "f1" },
      { userId: "bob", entityType: "friendship", entityId: "f1" },
    ]);
  });
});

describe("waypointDeleteTombstones", () => {
  it("owner-only for an unlinked waypoint", () => {
    expect(
      waypointDeleteTombstones({
        ownerId: "alice",
        waypointId: "w1",
        shareeIds: [],
      }),
    ).toEqual([{ userId: "alice", entityType: "waypoint", entityId: "w1" }]);
  });

  it("fans out to everyone who saw it through a canyon share", () => {
    expect(
      waypointDeleteTombstones({
        ownerId: "alice",
        waypointId: "w1",
        shareeIds: ["bob", "carol"],
      }),
    ).toEqual([
      { userId: "alice", entityType: "waypoint", entityId: "w1" },
      { userId: "bob", entityType: "waypoint", entityId: "w1" },
      { userId: "carol", entityType: "waypoint", entityId: "w1" },
    ]);
  });
});

describe("waypointRevokeTombstones", () => {
  it("names only the losers — never the owner", () => {
    expect(
      waypointRevokeTombstones({ waypointId: "w1", userIds: ["bob"] }),
    ).toEqual([{ userId: "bob", entityType: "waypoint", entityId: "w1" }]);
  });

  it("is empty when the change cost nobody their last path", () => {
    expect(waypointRevokeTombstones({ waypointId: "w1", userIds: [] })).toEqual(
      [],
    );
  });
});

// Direct sharing's revocation fan-out. The trap this guards: revoking a direct
// share deletes NOTHING the owner can see, so without these rows the
// recipient's mirror keeps the waypoint/route forever.
describe("directShareRevokeTombstones", () => {
  it("tombstones each losing user, and never the owner", () => {
    expect(
      directShareRevokeTombstones({
        entityType: "route",
        entityId: "rt-1",
        userIds: ["u1", "u2"],
      }),
    ).toEqual([
      { userId: "u1", entityType: "route", entityId: "rt-1" },
      { userId: "u2", entityType: "route", entityId: "rt-1" },
    ]);
  });

  it("carries the entity type through, so a waypoint isn't tombstoned as a route", () => {
    expect(
      directShareRevokeTombstones({
        entityType: "waypoint",
        entityId: "wp-1",
        userIds: ["u1"],
      }),
    ).toEqual([{ userId: "u1", entityType: "waypoint", entityId: "wp-1" }]);
  });

  it("is empty when nothing was shared — no rows, no writeTombstones call", () => {
    expect(
      directShareRevokeTombstones({
        entityType: "route",
        entityId: "rt-1",
        userIds: [],
      }),
    ).toEqual([]);
  });
});
