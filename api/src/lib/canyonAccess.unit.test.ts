import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../services/prisma", () => ({
  default: {
    canyonShare: { findFirst: vi.fn() },
  },
}));

import prisma from "../services/prisma";
import { AppError, errorHandler } from "../middleware/errorHandler";
import {
  getCanyonRole,
  requireCanyonAccess,
  requireCanyonOwner,
} from "./canyonAccess";

const shareFindFirst = (
  prisma as unknown as { canyonShare: { findFirst: Mock } }
).canyonShare.findFirst;

const CANYON = { id: "canyon-1", ownerId: "owner-1" };

beforeEach(() => {
  shareFindFirst.mockReset();
});

// These tests encode the hybrid-share privacy boundary (root CLAUDE.md):
// share recipients are "shared", never "owner"; strangers are "none".

describe("getCanyonRole", () => {
  it("returns 'owner' for the canyon owner without querying shares", async () => {
    await expect(getCanyonRole("owner-1", CANYON)).resolves.toBe("owner");
    expect(shareFindFirst).not.toHaveBeenCalled();
  });

  it("returns 'shared' when a share row exists for the user", async () => {
    shareFindFirst.mockResolvedValue({ id: "share-1" });
    await expect(getCanyonRole("friend-1", CANYON)).resolves.toBe("shared");
    expect(shareFindFirst).toHaveBeenCalledWith({
      where: { canyonId: "canyon-1", sharedWithId: "friend-1" },
      select: { id: true },
    });
  });

  it("returns 'none' when the user is neither owner nor share recipient", async () => {
    shareFindFirst.mockResolvedValue(null);
    await expect(getCanyonRole("stranger-1", CANYON)).resolves.toBe("none");
  });
});

describe("requireCanyonAccess", () => {
  it("returns 'owner' for the owner", async () => {
    await expect(requireCanyonAccess("owner-1", CANYON)).resolves.toBe("owner");
  });

  it("returns 'shared' for a share recipient", async () => {
    shareFindFirst.mockResolvedValue({ id: "share-1" });
    await expect(requireCanyonAccess("friend-1", CANYON)).resolves.toBe(
      "shared",
    );
  });

  it("throws 403 for a stranger", async () => {
    shareFindFirst.mockResolvedValue(null);
    const err = await requireCanyonAccess("stranger-1", CANYON).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(403);
  });
});

describe("requireCanyonOwner", () => {
  it("passes for the owner", () => {
    expect(() => requireCanyonOwner("owner-1", CANYON)).not.toThrow();
  });

  it("throws the default 403 for a non-owner (even a share recipient)", () => {
    const err = (() => {
      try {
        requireCanyonOwner("friend-1", CANYON);
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(403);
  });

  it("throws the caller-supplied denial (404 anti-oracle for trip logs)", () => {
    const denial = new AppError(404, "Trip log not found");
    expect(() => requireCanyonOwner("friend-1", CANYON, denial)).toThrow(
      denial,
    );
  });
});

// PRIV-001 promise anchor. privacy.html ("How sharing works") commits:
// "Per-trip notes, per-trip media, and your trip-log history remain private
// to you." These tests pin the exact wire-shape a share recipient receives
// from the single-trip GET deny path — if that policy wording ever changes,
// these tests are the deliberate stop to revisit the boundary.
describe("sharee single-trip denial (privacy.html: per-trip data 'remain private to you')", () => {
  it("sharee cannot read per-trip notes — denial body has no owner-private fields or presigned-URL markers", () => {
    // A share recipient ("shared" role, not owner) hitting
    // GET /canyons/:canyonId/trips/:id is denied by requireCanyonOwner with
    // the 404 anti-oracle denial (routes/tripLogs.ts).
    let denial: AppError | undefined;
    try {
      requireCanyonOwner(
        "friend-1",
        CANYON,
        new AppError(404, "Trip log not found"),
      );
    } catch (e) {
      denial = e as AppError;
    }
    expect(denial).toBeInstanceOf(AppError);
    expect(denial!.statusCode).toBe(404);

    // Run the denial through the real errorHandler to capture the exact JSON
    // body the sharee would receive on the wire.
    let status = 0;
    let body: unknown;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json(payload: unknown) {
        body = payload;
      },
    };
    const req = { log: { warn: vi.fn(), error: vi.fn() } };
    errorHandler(denial!, req as never, res as never, (() => {}) as never);

    expect(status).toBe(404);
    const wire = JSON.stringify(body);
    // None of the owner-private trip-log field names or presigned-media
    // markers may appear anywhere in the response body.
    for (const marker of [
      "notes",
      "customFields",
      "media",
      "date",
      "X-Amz-",
      "url",
    ]) {
      expect(wire).not.toContain(marker);
    }
  });

  it("a stranger gets the identical denial as a sharee — no role oracle on owner-private trips", () => {
    const shareeDenial = (() => {
      try {
        requireCanyonOwner(
          "friend-1",
          CANYON,
          new AppError(404, "Trip log not found"),
        );
      } catch (e) {
        return e as AppError;
      }
    })();
    const strangerDenial = (() => {
      try {
        requireCanyonOwner(
          "stranger-1",
          CANYON,
          new AppError(404, "Trip log not found"),
        );
      } catch (e) {
        return e as AppError;
      }
    })();
    expect(shareeDenial!.statusCode).toBe(strangerDenial!.statusCode);
    expect(shareeDenial!.message).toBe(strangerDenial!.message);
  });
});
