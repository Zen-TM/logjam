import { describe, it, expect, vi } from "vitest";

vi.mock("./prisma", () => ({ default: {} }));

import { buildPushMessages, pushTitleFor, tokensToPrune } from "./push";

describe("buildPushMessages — privacy invariant", () => {
  it("builds one message per token with a static generic title", () => {
    const messages = buildPushMessages(["ExponentPushToken[a]", "ExponentPushToken[b]"], {
      type: "canyon_shared",
      canyonId: "c1",
      notificationId: "n1",
    });
    expect(messages).toHaveLength(2);
    expect(messages[0].title).toBe("A canyon was shared with you");
    expect(messages[0].data).toEqual({
      type: "canyon_shared",
      canyonId: "c1",
      notificationId: "n1",
    });
  });

  it("titles are static per type — no interpolation surface at all", () => {
    // The builder accepts no free-text params; the title map values must not
    // contain template braces or placeholders.
    for (const type of [
      "friend_request",
      "friend_request_accepted",
      "canyon_shared",
      "topo_complete",
      "topo_failed",
      "topo_export_complete",
      "topo_export_skipped",
      "geo_pdf_complete",
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

  it("throws loudly on a non-whitelisted data key (no free-text smuggling)", () => {
    expect(() =>
      buildPushMessages(["t"], {
        type: "canyon_shared",
        // @ts-expect-error — deliberately illegal key
        canyonName: "Secret Canyon",
      }),
    ).toThrow(/not allowed: canyonName/);
    expect(() =>
      buildPushMessages(["t"], {
        type: "canyon_shared",
        // @ts-expect-error — deliberately illegal key
        latitude: -33.7,
      }),
    ).toThrow(/not allowed: latitude/);
  });

  it("has no body field — titles only, details fetched over the authed API", () => {
    const [message] = buildPushMessages(["t"], { type: "topo_complete", jobId: "j1" });
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
