// Two people get one friendship row. `friendships_pair_key` (migration
// 20261012120000_friendships_one_per_pair) refuses a second row for a pair
// whichever way round it is, so a write that raced past a route's own check
// now fails with P2002. These tests are the routes' half: that failure is
// answered the way the check would have answered it, never with a 500.
//
// Mutations that turn it red: drop the P2002 catch in POST /friends/request,
// or the second attempt in POST /friends/invites/redeem.
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
vi.mock("../services/push", () => ({ sendPushToUser: vi.fn() }));
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

describe("POST /friends/request, when the other write lands first", () => {
  const send = () =>
    handlerOf(friends, "/request")(
      { user: { sub: "me-sub" }, body: { addresseeId: "them" } },
      {},
    ).catch((err: unknown) => err);

  it.each([
    ["pending", 409, "Friend request already pending"],
    ["accepted", 409, "Already friends"],
    ["blocked", 403, "Unable to send friend request"],
  ])(
    "answers as the check does for a %s row",
    async (status, code, message) => {
      findFriendship
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "f-1", status });
      transaction.mockRejectedValueOnce(lostTheRace());

      expect(await send()).toMatchObject({ statusCode: code, message });
    },
  );
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
    findFriendship
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "f-1", status: "pending" });

    expect(await spend()).toBeUndefined();
    expect(tx.friendship.create).not.toHaveBeenCalled();
    expect(tx.friendship.update).toHaveBeenCalledWith({
      where: { id: "f-1" },
      data: { status: "accepted" },
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
