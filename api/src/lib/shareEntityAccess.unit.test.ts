import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../services/prisma", () => ({
  default: {
    share: { findUnique: vi.fn(), findMany: vi.fn() },
    canyonShare: { findFirst: vi.fn() },
    canyonWaypoint: { findFirst: vi.fn() },
    waypoint: { findUnique: vi.fn() },
    route: { findUnique: vi.fn(), findFirst: vi.fn() },
    topoJob: { findUnique: vi.fn() },
    geoPdfJob: { findUnique: vi.fn() },
  },
}));

import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import {
  directlySharedIds,
  loadEntityRole,
  requireEntityOwner,
} from "./shareAccess";

const mocked = prisma as unknown as {
  share: { findUnique: Mock; findMany: Mock };
  canyonShare: { findFirst: Mock };
  canyonWaypoint: { findFirst: Mock };
  waypoint: { findUnique: Mock };
  route: { findUnique: Mock; findFirst: Mock };
  topoJob: { findUnique: Mock };
  geoPdfJob: { findUnique: Mock };
};

const OWNER = "user-owner";
const SHAREE = "user-sharee";

/** Every endpoint reaches its decision through this dispatcher, so the status
 *  a stranger sees is decided here — once, for all four entity types. */
const ALL_TYPES = ["waypoint", "route", "topoJob", "geoPdfJob"] as const;

beforeEach(() => {
  mocked.share.findUnique.mockReset().mockResolvedValue(null);
  mocked.share.findMany.mockReset().mockResolvedValue([]);
  mocked.canyonShare.findFirst.mockReset().mockResolvedValue(null);
  mocked.canyonWaypoint.findFirst.mockReset().mockResolvedValue(null);
  mocked.waypoint.findUnique
    .mockReset()
    .mockResolvedValue({ id: "wp-1", ownerId: OWNER });
  mocked.route.findUnique
    .mockReset()
    .mockResolvedValue({ id: "rt-1", ownerId: OWNER, canyonId: null });
  mocked.route.findFirst.mockReset().mockResolvedValue(null);
  mocked.topoJob.findUnique
    .mockReset()
    .mockResolvedValue({ id: "job-1", userId: OWNER });
  mocked.geoPdfJob.findUnique
    .mockReset()
    .mockResolvedValue({ id: "pdf-1", userId: OWNER });
});

describe("loadEntityRole — one dispatcher, four tables", () => {
  it("reads the owner column each type actually uses", async () => {
    // TopoJob/GeoPdfJob name it `userId`, Waypoint/Route name it `ownerId`.
    // Getting this wrong would make every job look unowned.
    for (const entityType of ALL_TYPES) {
      const loaded = await loadEntityRole(OWNER, entityType, "id-1");
      expect(loaded).toEqual({ ownerId: OWNER, role: "owner" });
    }
  });

  it("returns null for a missing row, of every type", async () => {
    mocked.waypoint.findUnique.mockResolvedValue(null);
    mocked.route.findUnique.mockResolvedValue(null);
    mocked.topoJob.findUnique.mockResolvedValue(null);
    mocked.geoPdfJob.findUnique.mockResolvedValue(null);
    for (const entityType of ALL_TYPES) {
      expect(await loadEntityRole(OWNER, entityType, "id-1")).toBeNull();
    }
  });

  it("resolves 'shared' from a direct Share row, of every type", async () => {
    mocked.share.findUnique.mockResolvedValue({ id: "share-1" });
    for (const entityType of ALL_TYPES) {
      const loaded = await loadEntityRole(SHAREE, entityType, "id-1");
      expect(loaded).toEqual({ ownerId: OWNER, role: "shared" });
    }
  });

  it("resolves 'none' for a stranger, of every type", async () => {
    for (const entityType of ALL_TYPES) {
      const loaded = await loadEntityRole(SHAREE, entityType, "id-1");
      expect(loaded?.role).toBe("none");
    }
  });
});

// The anti-oracle rule, at the layer every owner-only action goes through.
describe("requireEntityOwner", () => {
  it("passes the owner through with the owner id", async () => {
    await expect(
      requireEntityOwner(OWNER, "route", "rt-1", "nope"),
    ).resolves.toEqual({ ownerId: OWNER });
  });

  it("gives a STRANGER 404 — never 403, which would confirm the id exists", async () => {
    for (const entityType of ALL_TYPES) {
      await expect(
        requireEntityOwner(SHAREE, entityType, "id-1", "nope"),
      ).rejects.toMatchObject({ statusCode: 404 });
    }
  });

  it("gives a SHAREE 403 — they can see it, they just may not re-share it", async () => {
    mocked.share.findUnique.mockResolvedValue({ id: "share-1" });
    for (const entityType of ALL_TYPES) {
      await expect(
        requireEntityOwner(SHAREE, entityType, "id-1", "nope"),
      ).rejects.toMatchObject({ statusCode: 403 });
    }
  });

  it("gives a MISSING id the same 404 a hidden one gets", async () => {
    mocked.route.findUnique.mockResolvedValue(null);
    const missing = requireEntityOwner(OWNER, "route", "rt-gone", "nope");
    await expect(missing).rejects.toBeInstanceOf(AppError);
    await expect(missing).rejects.toMatchObject({ statusCode: 404 });
  });
});

// The list/delta queries consume this as the direct-share arm of their OR.
// Share.entityId is polymorphic, so it cannot be a relation filter.
describe("directlySharedIds", () => {
  it("returns the ids shared with this user, scoped to the type asked for", async () => {
    mocked.share.findMany.mockResolvedValue([
      { entityId: "rt-1" },
      { entityId: "rt-2" },
    ]);
    expect(await directlySharedIds(SHAREE, "route")).toEqual(["rt-1", "rt-2"]);
    expect(mocked.share.findMany).toHaveBeenCalledWith({
      where: { sharedWithId: SHAREE, entityType: "route" },
      select: { entityId: true },
    });
  });

  it("is empty when nothing is shared, so the OR arm matches nothing", async () => {
    expect(await directlySharedIds(SHAREE, "waypoint")).toEqual([]);
  });

  it("never keys off sharedById — a share I SENT is not one I can see", async () => {
    await directlySharedIds(SHAREE, "topoJob");
    const where = mocked.share.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty("sharedById");
    expect(where.sharedWithId).toBe(SHAREE);
  });
});
