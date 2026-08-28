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
