import { describe, expect, it } from "vitest";

import { shareRowSubtitle } from "./shareRowSubtitle";

// `shareRowSubtitle` is the one branchy thing in the sharing module, and its
// ORDER is the part worth pinning: DESIGN.md §10 says needs-account beats
// needs-connection, and both beat any data-derived line — a guest must be told
// they need an account, not that nobody has access yet.
type Args = Parameters<typeof shareRowSubtitle>[0];

function subtitleFor(partial: Partial<Args>): string | undefined {
  return shareRowSubtitle({
    shareStatus: { status: "available" },
    loadFailed: false,
    recipients: [],
    ...partial,
  } as Args);
}

describe("shareRowSubtitle", () => {
  it("names the blocking capability before anything else", () => {
    // Even with a successful load carrying recipients, the closed door wins.
    expect(
      subtitleFor({
        shareStatus: { status: "unavailable", reason: "needs-account" },
        recipients: [
          { id: "s1", sharedWith: { id: "u1", username: "bob" } },
        ],
      }),
    ).toBe("Needs an account");
    expect(
      subtitleFor({
        shareStatus: { status: "unavailable", reason: "needs-connection" },
      }),
    ).toBe("Needs a connection");
  });

  it("reports an unreachable account ahead of the empty state", () => {
    // recipients stays null on a failed load; saying "not shared with anyone"
    // there would be a claim we cannot make.
    expect(subtitleFor({ loadFailed: true, recipients: null })).toBe(
      "Can't reach your account right now",
    );
  });

  it("distinguishes not-loaded-yet from genuinely empty", () => {
    expect(subtitleFor({ recipients: null })).toBe("Loading…");
    expect(subtitleFor({ recipients: [] })).toBe("Not shared with anyone yet");
  });

  it("says nothing once there is a recipient — the rows speak for themselves", () => {
    expect(
      subtitleFor({
        recipients: [{ id: "s1", sharedWith: { id: "u1", username: "bob" } }],
      }),
    ).toBeUndefined();
  });
});
