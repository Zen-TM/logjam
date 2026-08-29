import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../services/prisma", () => ({
  default: {
    share: { findUnique: vi.fn() },
    canyonShare: { findFirst: vi.fn() },
    canyonWaypoint: { findFirst: vi.fn() },
    route: { findFirst: vi.fn() },
  },
}));

import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import {
  deleteSharesFor,
  directShareeIds,
  getJobRole,
  getRouteRole,
  getWaypointRole,
  hasCanyonInheritedAccess,
  parseSharableEntityType,
  requireShareAccess,
  requireShareOwner,
  revokeAllSharesBetween,
} from "./shareAccess";

const mocked = prisma as unknown as {
  share: { findUnique: Mock };
  canyonShare: { findFirst: Mock };
  canyonWaypoint: { findFirst: Mock };
  route: { findFirst: Mock };
};

const OWNER = "user-owner";
const OTHER = "user-other";

beforeEach(() => {
  mocked.share.findUnique.mockReset().mockResolvedValue(null);
  mocked.canyonShare.findFirst.mockReset().mockResolvedValue(null);
  mocked.canyonWaypoint.findFirst.mockReset().mockResolvedValue(null);
  mocked.route.findFirst.mockReset().mockResolvedValue(null);
});

// The reason this file exists: after direct sharing there are TWO independent
// reasons a waypoint or route can be visible (a Share row, or a shared canyon
// it is linked to). Every test below pins one arm while the other is absent,
// so a change that quietly drops an arm fails here rather than in the field.
describe("getWaypointRole", () => {
  const waypoint = { id: "wp-1", ownerId: OWNER };

  it("calls the owner owner without touching either share table", async () => {
    expect(await getWaypointRole(OWNER, waypoint)).toBe("owner");
    expect(mocked.share.findUnique).not.toHaveBeenCalled();
    expect(mocked.canyonWaypoint.findFirst).not.toHaveBeenCalled();
  });

  it("grants 'shared' on a direct share with no canyon link at all", async () => {
    mocked.share.findUnique.mockResolvedValue({ id: "share-1" });
    expect(await getWaypointRole(OTHER, waypoint)).toBe("shared");
  });

  it("grants 'shared' through a shared canyon with no direct share", async () => {
    mocked.canyonWaypoint.findFirst.mockResolvedValue({ waypointId: "wp-1" });
    expect(await getWaypointRole(OTHER, waypoint)).toBe("shared");
  });

  it("returns 'none' when neither arm matches", async () => {
    expect(await getWaypointRole(OTHER, waypoint)).toBe("none");
  });
});

describe("getRouteRole", () => {
  it("grants 'shared' on a direct share of an UNLINKED route", async () => {
    mocked.share.findUnique.mockResolvedValue({ id: "share-1" });
    const role = await getRouteRole(OTHER, {
      id: "rt-1",
      ownerId: OWNER,
      canyonId: null,
    });
    expect(role).toBe("shared");
  });

  it("grants 'shared' through the linked canyon's share", async () => {
    mocked.route.findFirst.mockResolvedValue({ id: "rt-1" });
    const role = await getRouteRole(OTHER, {
      id: "rt-1",
      ownerId: OWNER,
      canyonId: "canyon-1",
    });
    expect(role).toBe("shared");
  });

  it("is 'none' on a route whose canyon (if any) is not shared", async () => {
    const role = await getRouteRole(OTHER, {
      id: "rt-1",
      ownerId: OWNER,
      canyonId: null,
    });
    expect(role).toBe("none");
  });
});

// The revoke path asks this directly: a direct revoke must not tombstone a
// recipient who keeps the canyon arm (finding 2).
describe("hasCanyonInheritedAccess", () => {
  it("is true for a waypoint linked to a canyon shared with the user", async () => {
    mocked.canyonWaypoint.findFirst.mockResolvedValue({ waypointId: "wp-1" });
    expect(await hasCanyonInheritedAccess(OTHER, "waypoint", "wp-1")).toBe(true);
  });

  it("is false for a waypoint with no shared-canyon link", async () => {
    expect(await hasCanyonInheritedAccess(OTHER, "waypoint", "wp-1")).toBe(false);
  });

  it("is true for a route whose canyon is shared with the user", async () => {
    mocked.route.findFirst.mockResolvedValue({ id: "rt-1" });
    expect(await hasCanyonInheritedAccess(OTHER, "route", "rt-1")).toBe(true);
  });

  it("is false for a route with no shared-canyon link", async () => {
    expect(await hasCanyonInheritedAccess(OTHER, "route", "rt-1")).toBe(false);
  });
});

describe("getJobRole", () => {
  it("is owner-or-direct-share only: jobs have no canyon inheritance", async () => {
    const job = { id: "job-1", userId: OWNER };
    expect(await getJobRole(OWNER, "topoJob", job)).toBe("owner");
    expect(await getJobRole(OTHER, "topoJob", job)).toBe("none");
    mocked.share.findUnique.mockResolvedValue({ id: "share-1" });
    expect(await getJobRole(OTHER, "geoPdfJob", job)).toBe("shared");
  });
});

// The anti-oracle rule from root CLAUDE.md, in executable form: a caller with
// no access must not be able to tell "exists but not mine" from "absent".
describe("404-not-403 anti-oracle", () => {
  it("requireShareAccess throws 404 on no access", () => {
    expect(() => requireShareAccess("none", "route")).toThrow(AppError);
    try {
      requireShareAccess("none", "route");
    } catch (error) {
      expect((error as AppError).statusCode).toBe(404);
    }
  });

  it("requireShareAccess passes owner and sharee through", () => {
    expect(requireShareAccess("owner", "route")).toBe("owner");
    expect(requireShareAccess("shared", "route")).toBe("shared");
  });

  it("requireShareOwner gives a stranger 404 but a sharee 403", () => {
    try {
      requireShareOwner("none", "waypoint", "Only the owner can do this");
      throw new Error("expected throw");
    } catch (error) {
      expect((error as AppError).statusCode).toBe(404);
    }
    try {
      requireShareOwner("shared", "waypoint", "Only the owner can do this");
      throw new Error("expected throw");
    } catch (error) {
      // A sharee legitimately sees this row, so its existence is not a secret
      // from them — lying with a 404 here would be the confusing answer.
      expect((error as AppError).statusCode).toBe(403);
    }
  });

  it("requireShareOwner is silent for the owner", () => {
    expect(() =>
      requireShareOwner("owner", "waypoint", "Only the owner can do this"),
    ).not.toThrow();
  });
});

// Share.entityId is polymorphic, so Postgres cannot cascade: a delete site that
// forgets this call leaves rows granting access to a dead id.
describe("deleteSharesFor", () => {
  it("deletes every share row for the given entities", async () => {
    const tx = { share: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) } };
    await deleteSharesFor(tx as never, "route", ["rt-1", "rt-2"]);
    expect(tx.share.deleteMany).toHaveBeenCalledWith({
      where: { entityType: "route", entityId: { in: ["rt-1", "rt-2"] } },
    });
  });

  it("issues no query for an empty id list", async () => {
    const tx = { share: { deleteMany: vi.fn() } };
    await deleteSharesFor(tx as never, "route", []);
    expect(tx.share.deleteMany).not.toHaveBeenCalled();
  });
});

describe("directShareeIds", () => {
  it("returns the recipients a delete must fan tombstones out to", async () => {
    const tx = {
      share: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ sharedWithId: "u1" }, { sharedWithId: "u2" }]),
      },
    };
    expect(await directShareeIds(tx as never, "waypoint", "wp-1")).toEqual([
      "u1",
      "u2",
    ]);
  });
});

describe("parseSharableEntityType", () => {
  it("accepts the four sharable types", () => {
    for (const type of ["waypoint", "route", "topoJob", "geoPdfJob"] as const) {
      expect(parseSharableEntityType(type)).toBe(type);
    }
  });

  it("rejects canyon — canyons share through CanyonShare, not here", () => {
    expect(() => parseSharableEntityType("canyon")).toThrow(AppError);
  });

  it("rejects unknown and non-string input with 400", () => {
    for (const bad of ["tripLog", "", null, 7, {}]) {
      try {
        parseSharableEntityType(bad);
        throw new Error(`expected throw for ${String(bad)}`);
      } catch (error) {
        expect((error as AppError).statusCode).toBe(400);
      }
    }
  });
});

// APIR-007 / decision D2: unfriending revokes EVERY share type, in both
// directions — not just the canyon shares the unfriend handler already
// deleted. The distinction that is easy to get wrong is FileSend: a pending
// send is still live access, an accepted one is a copy the recipient holds.
describe("revokeAllSharesBetween", () => {
  const ME = "me";
  const EX = "ex-friend";

  function makeTx(
    shares: {
      id: string;
      entityType: string;
      entityId: string;
      sharedWithId: string;
    }[],
    pendingSends: { id: string; userId: string; fileSendId: string }[] = [],
  ) {
    return {
      share: {
        findMany: vi.fn().mockResolvedValue(shares),
        deleteMany: vi.fn().mockResolvedValue({ count: shares.length }),
      },
      fileSendRecipient: {
        findMany: vi.fn().mockResolvedValue(pendingSends),
        deleteMany: vi.fn().mockResolvedValue({ count: pendingSends.length }),
      },
      notification: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      syncTombstone: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
  }

  it("reads and deletes shares in BOTH directions", async () => {
    const tx = makeTx([]);
    await revokeAllSharesBetween(tx as never, ME, EX);
    const where = tx.share.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { sharedById: ME, sharedWithId: EX },
      { sharedById: EX, sharedWithId: ME },
    ]);
  });

  it("deletes every share type but tombstones only the delta-synced ones", async () => {
    const tx = makeTx([
      { id: "s1", entityType: "waypoint", entityId: "wp-1", sharedWithId: EX },
      { id: "s2", entityType: "route", entityId: "rt-1", sharedWithId: ME },
      { id: "s3", entityType: "topoJob", entityId: "tj-1", sharedWithId: EX },
      { id: "s4", entityType: "geoPdfJob", entityId: "gp-1", sharedWithId: EX },
    ]);
    await revokeAllSharesBetween(tx as never, ME, EX);

    // All four Share rows go — a job share is revoked as hard as a waypoint.
    expect(tx.share.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["s1", "s2", "s3", "s4"] } },
    });
    // Jobs are not delta-synced, so they get no tombstone (they reconcile on
    // the next list fetch); waypoint/route do, one per losing recipient.
    expect(tx.syncTombstone.createMany).toHaveBeenCalledWith({
      data: [
        { userId: EX, entityType: "waypoint", entityId: "wp-1" },
        { userId: ME, entityType: "route", entityId: "rt-1" },
      ],
    });
  });

  it("purges each recipient's item_shared notification", async () => {
    const tx = makeTx([
      { id: "s1", entityType: "waypoint", entityId: "wp-1", sharedWithId: EX },
    ]);
    await revokeAllSharesBetween(tx as never, ME, EX);
    expect(tx.notification.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: EX,
        type: "item_shared",
        payload: { path: ["entityId"], equals: "wp-1" },
      },
    });
  });

  it("revokes PENDING file sends only, in both directions", async () => {
    const tx = makeTx([], [{ id: "r1", userId: EX, fileSendId: "fs-1" }]);
    await revokeAllSharesBetween(tx as never, ME, EX);

    const where = tx.fileSendRecipient.findMany.mock.calls[0][0].where;
    // The status filter IS the accepted-is-a-copy rule (D2). If this ever
    // widens, accepted recipients start losing files they already own.
    expect(where.status).toBe("pending");
    expect(where.OR).toEqual([
      { userId: EX, fileSend: { senderId: ME } },
      { userId: ME, fileSend: { senderId: EX } },
    ]);
    expect(tx.fileSendRecipient.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["r1"] } },
    });
    expect(tx.notification.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: EX,
        type: "file_sent",
        payload: { path: ["fileSendId"], equals: "fs-1" },
      },
    });
  });

  it("writes nothing when the pair shared nothing", async () => {
    const tx = makeTx([]);
    await revokeAllSharesBetween(tx as never, ME, EX);
    expect(tx.share.deleteMany).not.toHaveBeenCalled();
    expect(tx.fileSendRecipient.deleteMany).not.toHaveBeenCalled();
    expect(tx.syncTombstone.createMany).not.toHaveBeenCalled();
    expect(tx.notification.deleteMany).not.toHaveBeenCalled();
  });
});
