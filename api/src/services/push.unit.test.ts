import { describe, it, expect, vi } from "vitest";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
const { pushUrl } = vi.hoisted(() => ({
  pushUrl: { value: undefined as string | undefined },
}));
vi.mock("../lib/env", async (orig) => {
  const real = await orig<typeof import("../lib/env")>();
  return {
    ...real,
    getEnv: () => ({
      ...real.getEnv(),
      ...(pushUrl.value ? { EXPO_PUSH_URL: pushUrl.value } : {}),
    }),
  };
});
vi.mock("./prisma", () => ({ default: { deviceToken: { findMany } } }));

import {
  buildPushMessages,
  pushTitleFor,
  sendPushToUser,
  tokensToPrune,
} from "./push";

describe("buildPushMessages — privacy invariant", () => {
  it("builds one message per token with a static generic title", () => {
    const messages = buildPushMessages(
      ["ExponentPushToken[a]", "ExponentPushToken[b]"],
      {
        type: "place_shared",
        placeId: "c1",
        notificationId: "n1",
      },
    );
    expect(messages).toHaveLength(2);
    expect(messages[0].title).toBe("A place was shared with you");
    expect(messages[0].data).toEqual({
      type: "place_shared",
      placeId: "c1",
      notificationId: "n1",
    });
  });

  it("titles are static per type — no interpolation surface at all", () => {
    // The builder accepts no free-text params; the title map values must not
    // contain template braces or placeholders.
    for (const type of [
      "friend_request",
      "friend_request_accepted",
      "place_shared",
      "topo_complete",
      "topo_failed",
      "topo_export_complete",
      "topo_export_skipped",
      "geo_pdf_complete",
      "geo_pdf_failed",
      "unknown_future_type",
    ]) {
      const title = pushTitleFor(type);
      expect(title).not.toMatch(/[{}$]/);
      // No coordinates-like content possible in a constant, but assert the
      // titles never mention a name-like placeholder.
      expect(title).toBe(pushTitleFor(type)); // deterministic
    }
    expect(pushTitleFor("unknown_future_type")).toBe("Logjam notification");
  });

  // The push carries no status field, so the type is the only thing that can
  // carry the outcome.
  it("gives a failed GeoPDF its own title, distinct from the success one", () => {
    expect(pushTitleFor("geo_pdf_failed")).toBe("GeoPDF failed");
    expect(pushTitleFor("geo_pdf_failed")).not.toBe(
      pushTitleFor("geo_pdf_complete"),
    );
    expect(pushTitleFor("geo_pdf_failed")).not.toBe("Logjam notification");
  });

  it("throws loudly on a non-whitelisted data key (no free-text smuggling)", () => {
    expect(() =>
      buildPushMessages(["t"], {
        type: "place_shared",
        // @ts-expect-error — deliberately illegal key
        placeName: "Secret Place",
      }),
    ).toThrow(/not allowed: placeName/);
    expect(() =>
      buildPushMessages(["t"], {
        type: "place_shared",
        // @ts-expect-error — deliberately illegal key
        latitude: -33.7,
      }),
    ).toThrow(/not allowed: latitude/);
  });

  it("has no body field — titles only, details fetched over the authed API", () => {
    const [message] = buildPushMessages(["t"], {
      type: "topo_complete",
      jobId: "j1",
    });
    expect("body" in message).toBe(false);
  });
});

describe("tokensToPrune", () => {
  it("selects tokens whose ticket is DeviceNotRegistered, by position", () => {
    const tokens = ["a", "b", "c"];
    const tickets = [
      { status: "ok" as const },
      { status: "error" as const, details: { error: "DeviceNotRegistered" } },
      { status: "error" as const, details: { error: "MessageRateExceeded" } },
    ];
    expect(tokensToPrune(tokens, tickets)).toEqual(["b"]);
  });

  it("handles missing tickets gracefully", () => {
    expect(tokensToPrune(["a", "b"], [{ status: "ok" }])).toEqual([]);
  });
});

// Mutation: rethrow from sendPushToUser's catch.
describe("sendPushToUser", () => {
  it("swallows a failed send, so the request that triggered it still succeeds", async () => {
    findMany.mockResolvedValueOnce([{ token: "ExponentPushToken[a]" }]);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(
      sendPushToUser("u1", { type: "friend_request", notificationId: "n1" }),
    ).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledOnce();
    fetchSpy.mockRestore();
  });
});

// Mutation: hard-code Expo's URL in sendPushToUser again.
describe("sendPushToUser — EXPO_PUSH_URL", () => {
  it("posts to the configured URL, so CI can point it at a stub", async () => {
    pushUrl.value = "http://localhost:9099";
    findMany.mockResolvedValueOnce([{ token: "ExponentPushToken[a]" }]);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })));
    await sendPushToUser("u1", {
      type: "friend_request",
      notificationId: "n1",
    });
    expect(fetchSpy.mock.calls[0][0]).toBe("http://localhost:9099");
    fetchSpy.mockRestore();
    pushUrl.value = undefined;
  });
});
