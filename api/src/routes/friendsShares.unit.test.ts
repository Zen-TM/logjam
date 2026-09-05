import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../services/prisma", () => ({
  default: {
    friendship: { findUnique: vi.fn() },
  },
}));

import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import {
  ownedSharesToFriendWhere,
  receivedSharesFromFriendWhere,
  resolveFriendCounterpart,
  selectRequested,
} from "./friends";

const findUnique = (
  prisma as unknown as { friendship: { findUnique: Mock } }
).friendship.findUnique;

const ME = "user-me";
const FRIEND = "user-friend";
const STRANGER = "user-stranger";
const FRIENDSHIP_ID = "friendship-1";

beforeEach(() => {
  findUnique.mockReset();
});

// These tests encode the access boundary of the sharing-audit surface (fix 24).
// The invariant they defend: you can only ever see or revoke shares on canyons
// YOU OWN, and only for a friendship you are actually a member of.

describe("ownedSharesToFriendWhere — the forward list/revoke filter", () => {
  it("scopes to canyons the CALLER owns, shared with the friend", () => {
    expect(ownedSharesToFriendWhere(ME, FRIEND)).toEqual({
      sharedWithId: FRIEND,
      canyon: { ownerId: ME },
    });
  });

  // The privacy-critical assertion. Filtering on the share's `sharedById` would
  // trust a denormalised value; filtering on the canyon's `ownerId` derives the
  // set from ownership itself, so no canyon the caller doesn't own can ever
  // enter the result — or be revoked by the bulk delete that reuses this.
  it("derives from canyon ownership, never from the share's sharedById", () => {
    const where = ownedSharesToFriendWhere(ME, FRIEND);
    expect(where.canyon.ownerId).toBe(ME);
    expect(where).not.toHaveProperty("sharedById");
  });

  it("is not symmetric — swapping the args flips whose canyons are in scope", () => {
    expect(ownedSharesToFriendWhere(FRIEND, ME)).toEqual({
      sharedWithId: ME,
      canyon: { ownerId: FRIEND },
    });
  });
});

describe("receivedSharesFromFriendWhere — the reverse (read-only) list filter", () => {
  it("scopes to canyons the FRIEND owns, shared with the caller", () => {
    expect(receivedSharesFromFriendWhere(ME, FRIEND)).toEqual({
      sharedWithId: ME,
      canyon: { ownerId: FRIEND },
    });
  });

  // Guards the direction confusion that would turn "canyons Bob shares with
  // you" into a list of YOUR canyons — i.e. the bulk revoke hitting the wrong
  // set entirely.
  it("is the exact mirror of the forward filter", () => {
    expect(receivedSharesFromFriendWhere(ME, FRIEND)).toEqual(
      ownedSharesToFriendWhere(FRIEND, ME),
    );
  });
});

describe("resolveFriendCounterpart — the friendship membership check", () => {
  it("returns the addressee when the caller is the requester", async () => {
    findUnique.mockResolvedValue({
      id: FRIENDSHIP_ID,
      status: "accepted",
      requesterId: ME,
      addresseeId: FRIEND,
    });
    await expect(resolveFriendCounterpart(FRIENDSHIP_ID, ME)).resolves.toBe(
      FRIEND,
    );
  });

  it("returns the requester when the caller is the addressee", async () => {
    findUnique.mockResolvedValue({
      id: FRIENDSHIP_ID,
      status: "accepted",
      requesterId: FRIEND,
      addresseeId: ME,
    });
    await expect(resolveFriendCounterpart(FRIENDSHIP_ID, ME)).resolves.toBe(
      FRIEND,
    );
  });

  // A stranger holding a valid friendship id must not learn its share graph.
  it("throws 403 for a user who is not a member of the friendship", async () => {
    findUnique.mockResolvedValue({
      id: FRIENDSHIP_ID,
      status: "accepted",
      requesterId: ME,
      addresseeId: FRIEND,
    });
    await expect(
      resolveFriendCounterpart(FRIENDSHIP_ID, STRANGER),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("throws 404 for an unknown friendship id", async () => {
    findUnique.mockResolvedValue(null);
    await expect(
      resolveFriendCounterpart(FRIENDSHIP_ID, ME),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      resolveFriendCounterpart(FRIENDSHIP_ID, ME),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  // A pending request is not a sharing relationship — shares can't exist yet
  // (POST /canyons/:id/share requires an accepted friendship), and a pending
  // addressee must not get an audit surface on the requester.
  it("throws 400 for a pending (not accepted) friendship", async () => {
    findUnique.mockResolvedValue({
      id: FRIENDSHIP_ID,
      status: "pending",
      requesterId: ME,
      addresseeId: FRIEND,
    });
    await expect(
      resolveFriendCounterpart(FRIENDSHIP_ID, ME),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("throws 400 for a blocked friendship", async () => {
    findUnique.mockResolvedValue({
      id: FRIENDSHIP_ID,
      status: "blocked",
      requesterId: ME,
      addresseeId: FRIEND,
    });
    await expect(
      resolveFriendCounterpart(FRIENDSHIP_ID, ME),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

// The subset arm of the bulk revoke (a phone multi-select picks 3 of 11). The
// dangerous shapes are the two ends: a request that names nothing must not be
// read as naming everything, and a request that names something the caller does
// not own must not widen the set it was intersected with.
describe("selectRequested — what a bulk revoke body may narrow", () => {
  const MINE = [
    { entityType: "canyon", entityId: "c1" },
    { entityType: "canyon", entityId: "c2" },
    { entityType: "waypoint", entityId: "w1" },
  ];

  it("leaves the set whole when the request named no items", () => {
    expect(selectRequested(MINE, null)).toEqual(MINE);
  });

  // The bug this pins: reading `[]` as "all" would turn a client that computed
  // an empty selection into an unshare-everything.
  it("revokes NOTHING for an explicitly empty item list", () => {
    expect(selectRequested(MINE, [])).toEqual([]);
  });

  it("narrows to the named items", () => {
    expect(
      selectRequested(MINE, [
        { entityType: "canyon", entityId: "c2" },
        { entityType: "waypoint", entityId: "w1" },
      ]),
    ).toEqual([MINE[1], MINE[2]]);
  });

  // The body is a filter, never a source: an id the caller does not own is not
  // in the set being narrowed, so it cannot be added by asking for it.
  it("cannot introduce a row that was not in the caller's own set", () => {
    expect(
      selectRequested(MINE, [{ entityType: "canyon", entityId: "someone-elses" }]),
    ).toEqual([]);
  });

  // Type and id are one key: the same uuid as a waypoint and as a canyon are
  // different rows in different tables.
  it("matches on entityType AND entityId, not the id alone", () => {
    expect(
      selectRequested(MINE, [{ entityType: "route", entityId: "c1" }]),
    ).toEqual([]);
  });
});
