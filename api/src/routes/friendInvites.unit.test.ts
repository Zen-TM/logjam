// Fake auth signs every integration request in, so "no invite route answers a
// signed-out caller" cannot be shown there. It is shown here instead, from the
// router itself.
//
// Mutation that turns it red: drop `requireAuth` from any route in
// friendInvites.ts, or put a limiter ahead of it.
import { describe, expect, it, vi } from "vitest";

vi.mock("../services/prisma", () => ({ default: {} }));
vi.mock("../services/push", () => ({ sendPushToUser: vi.fn() }));

const { requireAuth } = await import("../middleware/auth");
const { default: router } = await import("./friendInvites");

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
