import { describe, expect, it } from "vitest";
import {
  accountDeleteTombstones,
  placeDeleteTombstones,
  directShareRevokeTombstones,
  friendshipDeleteTombstones,
  mediaDeleteTombstones,
  mediaUnlinkTombstones,
  routeDeleteTombstones,
  routeUnlinkTombstones,
  shareRevokeTombstones,
  tripDeleteTombstones,
  placeLinkDeleteTombstones,
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

describe("placeDeleteTombstones", () => {
  it("fans out place + media to every sharee and share rows to the owner", () => {
    const rows = placeDeleteTombstones({
      ownerId: "alice",
      placeId: "c1",
      mediaIds: ["m1"],
      shares: [
        { id: "s-bob", sharedWithId: "bob" },
        { id: "s-carol", sharedWithId: "carol" },
      ],
    });
    // owner: place + 1 media + 2 placeShare; each sharee: place + 1 media.
    expect(rows).toHaveLength(4 + 2 * 2);
    expect(has(rows, { userId: "alice", entityType: "placeShare", entityId: "s-bob" })).toBe(true);
    expect(has(rows, { userId: "bob", entityType: "place", entityId: "c1" })).toBe(true);
    expect(has(rows, { userId: "bob", entityType: "media", entityId: "m1" })).toBe(true);
    expect(has(rows, { userId: "carol", entityType: "place", entityId: "c1" })).toBe(true);
    // Sharees never receive placeShare tombstones for shares that aren't
    // theirs (a sharee cannot enumerate co-sharees — §4.6.1).
    expect(
      rows.filter((r) => r.entityType === "placeShare").every((r) => r.userId === "alice"),
    ).toBe(true);
  });

  it("unshared place: owner rows only", () => {
    const rows = placeDeleteTombstones({
      ownerId: "alice",
      placeId: "c1",
      mediaIds: [],
      shares: [],
    });
    expect(rows).toEqual([
      { userId: "alice", entityType: "place", entityId: "c1" },
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
  it("sharee loses place + place media; owner loses the share row", () => {
    const rows = shareRevokeTombstones({
      placeOwnerId: "alice",
      shareeId: "bob",
      shareId: "s1",
      placeId: "c1",
      placeMediaIds: ["m1", "m2"],
    });
    expect(has(rows, { userId: "bob", entityType: "place", entityId: "c1" })).toBe(true);
    expect(has(rows, { userId: "bob", entityType: "media", entityId: "m1" })).toBe(true);
    expect(has(rows, { userId: "alice", entityType: "placeShare", entityId: "s1" })).toBe(true);
    // The sharee's signal is indistinguishable from a place delete: exactly
    // one `place` tombstone, nothing owner-only rides along (§4.6.3).
    const shareeRows = rows.filter((r) => r.userId === "bob");
    expect(shareeRows.filter((r) => r.entityType === "place")).toHaveLength(1);
    expect(shareeRows.some((r) => r.entityType === "placeShare")).toBe(false);
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

  it("fans out to every sharee of the linked place", () => {
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

  it("is empty when the place had no sharees", () => {
    expect(routeUnlinkTombstones({ routeId: "r1", shareeIds: [] })).toEqual([]);
  });
});

describe("standalone files linked as a place's way", () => {
  it("place delete revokes an unlinked file from sharees but not the owner", () => {
    // The file is the user's own import/recording and survives the place it
    // was attached to, exactly as a linked route does. An owner tombstone here
    // would make every one of their devices delete their own file.
    const rows = placeDeleteTombstones({
      ownerId: "alice",
      placeId: "c1",
      mediaIds: [],
      shares: [{ id: "s1", sharedWithId: "bob" }],
      unlinkedMediaIds: ["import-1"],
    });
    expect(has(rows, { userId: "bob", entityType: "media", entityId: "import-1" })).toBe(
      true,
    );
    expect(
      has(rows, { userId: "alice", entityType: "media", entityId: "import-1" }),
    ).toBe(false);
  });

  it("still destroys the place's own attachments for both parties", () => {
    const rows = placeDeleteTombstones({
      ownerId: "alice",
      placeId: "c1",
      mediaIds: ["photo-1"],
      shares: [{ id: "s1", sharedWithId: "bob" }],
      unlinkedMediaIds: ["import-1"],
    });
    expect(has(rows, { userId: "alice", entityType: "media", entityId: "photo-1" })).toBe(
      true,
    );
    expect(has(rows, { userId: "bob", entityType: "media", entityId: "photo-1" })).toBe(
      true,
    );
  });

  it("omitting unlinkedMediaIds emits nothing extra", () => {
    const rows = placeDeleteTombstones({
      ownerId: "alice",
      placeId: "c1",
      mediaIds: [],
      shares: [{ id: "s1", sharedWithId: "bob" }],
    });
    expect(rows.some((r) => r.entityType === "media")).toBe(false);
  });
});

describe("mediaUnlinkTombstones", () => {
  it("tells only the sharees to forget it — the owner keeps the file", () => {
    const rows = mediaUnlinkTombstones({
      mediaId: "import-1",
      shareeIds: ["bob", "carol"],
    });
    expect(rows).toEqual([
      { userId: "bob", entityType: "media", entityId: "import-1" },
      { userId: "carol", entityType: "media", entityId: "import-1" },
    ]);
  });

  it("emits nothing when the place was not shared", () => {
    expect(mediaUnlinkTombstones({ mediaId: "import-1", shareeIds: [] })).toEqual([]);
  });
});

describe("linked routes in place-delete and share-revoke", () => {
  it("place delete revokes the route from sharees but not the owner", () => {
    // Route.placeId is SetNull: the route SURVIVES a place delete as a
    // standalone route, so the owner must NOT be told to forget it.
    const rows = placeDeleteTombstones({
      ownerId: "alice",
      placeId: "c1",
      mediaIds: [],
      shares: [{ id: "s1", sharedWithId: "bob" }],
      routeId: "r1",
    });
    expect(has(rows, { userId: "bob", entityType: "route", entityId: "r1" })).toBe(true);
    expect(has(rows, { userId: "alice", entityType: "route", entityId: "r1" })).toBe(false);
  });

  it("emits no route rows when the place had none", () => {
    const rows = placeDeleteTombstones({
      ownerId: "alice",
      placeId: "c1",
      mediaIds: [],
      shares: [{ id: "s1", sharedWithId: "bob" }],
      routeId: null,
    });
    expect(rows.some((r) => r.entityType === "route")).toBe(false);
  });

  it("share revoke takes the linked route with the place record", () => {
    const rows = shareRevokeTombstones({
      placeOwnerId: "alice",
      shareeId: "bob",
      shareId: "s1",
      placeId: "c1",
      placeMediaIds: [],
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

describe("placeLinkDeleteTombstones", () => {
  it("is owner-only — a link grants no visibility, so no sharee holds one", () => {
    expect(
      placeLinkDeleteTombstones({ ownerId: "alice", linkIds: ["l1", "l2"] }),
    ).toEqual([
      { userId: "alice", entityType: "placeLink", entityId: "l1" },
      { userId: "alice", entityType: "placeLink", entityId: "l2" },
    ]);
  });

  it("is empty for a place that was linked to nothing", () => {
    expect(placeLinkDeleteTombstones({ ownerId: "alice", linkIds: [] })).toEqual(
      [],
    );
  });
});

// Direct sharing's revocation fan-out. The trap this guards: revoking a direct
// share deletes NOTHING the owner can see, so without these rows the
// recipient's mirror keeps the route forever.
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

// DELETE /users/me is a delete site like any other. The direct-share arm is the
// one a Postgres cascade silently drops: Share rows vanish with the user, but a
// cascade writes no tombstone, so a recipient's mirror would keep the item.
describe("accountDeleteTombstones", () => {
  const base = {
    userId: "me",
    mediaIdsByPlace: new Map<string, string[]>(),
    placeSharesOut: [],
    placeSharesIn: [],
    friendships: [],
    directSharesOut: [],
    placeInheritedOut: [],
  };

  it("tombstones direct recipients of my routes", () => {
    const rows = accountDeleteTombstones({
      ...base,
      directSharesOut: [
        { entityType: "route" as const, entityId: "rt-1", sharedWithId: "bob" },
        { entityType: "route" as const, entityId: "rt-2", sharedWithId: "carol" },
      ],
    });
    expect(has(rows, { userId: "bob", entityType: "route", entityId: "rt-1" })).toBe(true);
    expect(has(rows, { userId: "carol", entityType: "route", entityId: "rt-2" })).toBe(true);
  });

  it("never tombstones the departing user — their own log goes with them", () => {
    const rows = accountDeleteTombstones({
      ...base,
      placeSharesOut: [{ placeId: "c-1", sharedWithId: "bob" }],
      friendships: [{ id: "f-1", requesterId: "me", addresseeId: "bob" }],
      directSharesOut: [
        { entityType: "route" as const, entityId: "rt-1", sharedWithId: "bob" },
      ],
    });
    expect(rows.some((r) => r.userId === "me")).toBe(false);
  });

  it("fans place sharees out to the place AND its place-level media", () => {
    const rows = accountDeleteTombstones({
      ...base,
      mediaIdsByPlace: new Map([["c-1", ["m-1", "m-2"]]]),
      placeSharesOut: [{ placeId: "c-1", sharedWithId: "bob" }],
    });
    expect(has(rows, { userId: "bob", entityType: "place", entityId: "c-1" })).toBe(true);
    expect(has(rows, { userId: "bob", entityType: "media", entityId: "m-1" })).toBe(true);
    expect(has(rows, { userId: "bob", entityType: "media", entityId: "m-2" })).toBe(true);
  });

  it("gives the friendship edge to the OTHER party, whichever side I was on", () => {
    const asRequester = accountDeleteTombstones({
      ...base,
      friendships: [{ id: "f-1", requesterId: "me", addresseeId: "bob" }],
    });
    const asAddressee = accountDeleteTombstones({
      ...base,
      friendships: [{ id: "f-2", requesterId: "bob", addresseeId: "me" }],
    });
    expect(asRequester).toEqual([
      { userId: "bob", entityType: "friendship", entityId: "f-1" },
    ]);
    expect(asAddressee).toEqual([
      { userId: "bob", entityType: "friendship", entityId: "f-2" },
    ]);
  });

  // PRIV-107: the place tombstone does NOT imply the ROUTES a sharee could
  // reach through that place (via Route.placeId — a foreign key, which is why
  // it survived the waypoint fold). Account delete hard-deletes them, so every
  // current viewer must be told — the single-place delete path fans these out
  // explicitly and this one has to match.
  it("tombstones place sharees for routes they saw through the place", () => {
    const rows = accountDeleteTombstones({
      ...base,
      placeSharesOut: [{ placeId: "c-1", sharedWithId: "bob" }],
      placeInheritedOut: [
        { entityType: "route" as const, entityId: "rt-1", userIds: ["bob", "carol"] },
      ],
    });
    expect(has(rows, { userId: "bob", entityType: "route", entityId: "rt-1" })).toBe(true);
    expect(has(rows, { userId: "carol", entityType: "route", entityId: "rt-1" })).toBe(true);
    // Still never the departing user.
    expect(rows.some((r) => r.userId === "me")).toBe(false);
  });

  it("emits no place-inherited rows for an entity nobody could see", () => {
    expect(
      accountDeleteTombstones({
        ...base,
        placeInheritedOut: [
          { entityType: "route" as const, entityId: "rt-1", userIds: [] },
        ],
      }),
    ).toEqual([]);
  });

  it("is empty for an account nobody shared anything with", () => {
    expect(accountDeleteTombstones(base)).toEqual([]);
  });
});
