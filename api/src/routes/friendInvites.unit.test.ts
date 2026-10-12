// Fake auth signs every integration request in, so "no invite route answers a
// signed-out caller" cannot be shown there. It is shown here instead, from the
// router itself.
//
// Mutation that turns it red: drop `requireAuth` from any route in
// friendInvites.ts, or put a limiter ahead of it.
import { describe, expect, it, vi } from "vitest";

const findInvite = vi.fn();
const findFriendship = vi.fn();
vi.mock("../services/prisma", () => ({
  default: {
    friendInvite: { findUnique: findInvite },
    friendship: { findFirst: findFriendship },
  },
}));
vi.mock("../services/push", () => ({ sendPushToUser: vi.fn() }));

const { requireAuth } = await import("../middleware/auth");
const { default: router, resolveInvite } = await import("./friendInvites");

type Layer = {
  route?: { path: string; stack: { handle: unknown; method: string }[] };
};

describe("friend invite routes", () => {
  const routes = (router.stack as Layer[]).flatMap((layer) =>
    layer.route ? [layer.route] : [],
  );

  it("finds the routes", () => {
    // A walk that found nothing would pass the check below.
    expect(routes.map((r) => `${r.stack[0].method} ${r.path}`).sort()).toEqual([
      "delete /",
      "get /",
      "post /",
      "post /preview",
      "post /redeem",
    ]);
  });

  it("runs requireAuth first on every one", () => {
    for (const route of routes) {
      expect(route.stack[0].handle, route.path).toBe(requireAuth);
    }
  });
});

// Nothing in the API writes a block yet, so no integration test can set one
// up: the seed has none and no route makes one. The check is here for the day
// one does, and both /preview and /redeem reach a link only through
// `resolveInvite`.
//
// Mutation that turns it red: drop the `blocked` check in resolveInvite. A
// blocked account's link then names its owner to the other party, and
// spending it turns the block into a friendship.
describe("a link between two accounts with a block", () => {
  const TOKEN = "A".repeat(43);

  it("fails the way a link that never existed does", async () => {
    findInvite.mockResolvedValue(null);
    const unknown = await resolveInvite(TOKEN, "caller").catch((err) => err);

    findInvite.mockResolvedValue({
      id: "invite-1",
      expiresAt: new Date(Date.now() + 60_000),
      inviter: { id: "inviter", username: "inviter" },
    });
    findFriendship.mockResolvedValue({ id: "f-1", status: "blocked" });
    const blocked = await resolveInvite(TOKEN, "caller").catch((err) => err);

    expect(blocked).toMatchObject({ statusCode: 404 });
    expect(blocked.message).toBe(unknown.message);
  });
});
