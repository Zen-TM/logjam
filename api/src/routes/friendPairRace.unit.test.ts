// Two people get one friendship row. `friendships_pair_key` (migration
// 20261012120000_friendships_one_per_pair) refuses a second row for a pair
// whichever way round it is, so a write that raced past a route's own check
// now fails with P2002. These tests are the routes' half: that failure is
// answered the way the check would have answered it, never with a 500.
//
// Mutations that turn it red: drop the second attempt in POST
// /friends/request or in POST /friends/invites/redeem.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const findFriendship = vi.fn();
const findInvite = vi.fn();
const transaction = vi.fn();
vi.mock("../services/prisma", () => ({
  default: {
    user: {
      findUnique: vi.fn().mockResolvedValue({ id: "them", uiPreferences: {} }),
    },
    friendInvite: { findUnique: findInvite },
    friendship: { findFirst: findFriendship },
    $transaction: transaction,
  },
}));
const sendPushToUser = vi.fn();
vi.mock("../services/push", () => ({ sendPushToUser }));
vi.mock("../lib/resolveUser", () => ({
  resolveUser: vi.fn().mockResolvedValue({ id: "me" }),
}));

const { default: friends } = await import("./friends");
const { default: invites } = await import("./friendInvites");

type Handler = (req: unknown, res: unknown) => Promise<void>;
type Layer = { route?: { path: string; stack: { handle: Handler }[] } };

/** A route's own handler, past requireAuth and its limiter. */
function handlerOf(router: { stack: unknown[] }, path: string): Handler {
  const route = (router.stack as Layer[]).find(
    (layer) => layer.route?.path === path,
  )!.route!;
  return route.stack[route.stack.length - 1].handle;
}

const lostTheRace = () =>
  new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });

beforeEach(() => {
  findFriendship.mockReset();
  findInvite.mockReset();
  transaction.mockReset();
});

// A request to someone whose own request is waiting accepts it: both asked.
// It has to end the same whether the two were a year apart (the read finds
// the row) or raced (the insert is refused, and the second read finds it).
//
// Mutations that turn it red: answer an opposite pending row with the 409 a
// same-way one gets; let a block reach `acceptFriendRequest`.
describe("POST /friends/request", () => {
  const theirs = { id: "f-1", requesterId: "them", addresseeId: "me" };
  const tx = {
    friendship: {
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({ ...theirs, status: "accepted" }),
    },
    notification: { create: vi.fn(), deleteMany: vi.fn() },
  };
  const res = { status: vi.fn(), json: vi.fn() };
  const send = () =>
    handlerOf(friends, "/request")(
      { user: { sub: "me-sub" }, body: { addresseeId: "them" } },
      res,
    ).catch((err: unknown) => err);
  const runTx = (run: (client: typeof tx) => unknown) => run(tx);

  beforeEach(() => {
    vi.clearAllMocks();
    res.status.mockReturnValue(res);
  });

  // `raced` is the read that found nothing, then the insert that lost.
  describe.each([
    ["sent long after theirs", false],
    ["raced with theirs", true],
  ])("%s", (_when, raced) => {
    const found = (row: object) => {
      if (raced) {
        findFriendship.mockResolvedValueOnce(null);
        transaction.mockRejectedValueOnce(lostTheRace());
      }
      findFriendship.mockResolvedValueOnce(row);
      transaction.mockImplementation(runTx);
    };

    it("accepts their pending request, as an accept does", async () => {
      found({ ...theirs, status: "pending" });

      expect(await send()).toBeUndefined();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ ...theirs, status: "accepted" });
      expect(tx.friendship.create).not.toHaveBeenCalled();
      expect(tx.friendship.update).toHaveBeenCalledWith({
        where: { id: "f-1" },
        data: { status: "accepted" },
      });
      // My prompt for their request goes; they are told, and pushed.
      expect(tx.notification.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: "me",
          type: "friend_request",
          payload: { path: ["friendshipId"], equals: "f-1" },
        },
      });
      expect(tx.notification.create).toHaveBeenCalledWith({
        data: {
          userId: "them",
          type: "friend_request_accepted",
          payload: { friendshipId: "f-1", acceptedById: "me" },
        },
      });
      expect(sendPushToUser).toHaveBeenCalledWith("them", {
        type: "friend_request_accepted",
        friendshipId: "f-1",
      });
    });

    it.each([
      [
        { ...theirs, status: "blocked" },
        403,
        "Couldn't send that friend request.",
      ],
      [{ ...theirs, status: "accepted" }, 409, "You're already friends."],
      [
        {
          id: "f-1",
          requesterId: "me",
          addresseeId: "them",
          status: "pending",
        },
        409,
        "A friend request between you is already waiting.",
      ],
    ])("refuses over %o", async (row, statusCode, message) => {
      found(row);

      expect(await send()).toMatchObject({ statusCode, message });
      expect(tx.friendship.update).not.toHaveBeenCalled();
    });
  });
});

describe("POST /friends/invites/redeem, when the other write lands first", () => {
  const TOKEN = "A".repeat(43);
  const tx = {
    friendInvite: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    friendship: { create: vi.fn(), update: vi.fn() },
    notification: { create: vi.fn(), deleteMany: vi.fn() },
  };
  const json = vi.fn();
  const spend = () =>
    handlerOf(invites, "/redeem")(
      { user: { sub: "me-sub" }, body: { token: TOKEN } },
      { json },
    ).catch((err: unknown) => err);

  beforeEach(() => {
    json.mockReset();
    tx.friendship.create.mockReset();
    tx.friendship.update.mockReset();
    findInvite.mockResolvedValue({
      id: "invite-1",
      expiresAt: new Date(Date.now() + 60_000),
      inviter: { id: "them", username: "them" },
    });
    transaction
      .mockRejectedValueOnce(lostTheRace())
      .mockImplementation((run: (client: typeof tx) => unknown) => run(tx));
  });

  it("accepts the row that won", async () => {
    findFriendship.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "f-1",
      requesterId: "them",
      addresseeId: "me",
      status: "pending",
    });

    expect(await spend()).toBeUndefined();
    expect(tx.friendship.create).not.toHaveBeenCalled();
    expect(tx.friendship.update).toHaveBeenCalledWith({
      where: { id: "f-1" },
      data: { status: "accepted" },
    });
    // Mutation that turns it red: scope the purge to the caller only.
    expect(tx.notification.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: { in: ["them", "me"] },
        type: "friend_request",
        payload: { path: ["friendshipId"], equals: "f-1" },
      },
    });
    expect(json).toHaveBeenCalledWith({
      id: "them",
      username: "them",
      friendshipId: "f-1",
    });
  });

  it("still refuses a block that won", async () => {
    findFriendship
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "f-1", status: "blocked" });

    expect(await spend()).toMatchObject({ statusCode: 404 });
    expect(tx.friendship.update).not.toHaveBeenCalled();
  });
});
