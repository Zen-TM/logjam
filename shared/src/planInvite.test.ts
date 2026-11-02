// Mutation that turns it red: put the token in the query string or the path
// in `planInviteUrl`, or read the friend link's `invite` key back as a plan's.
import { describe, expect, it } from "vitest";
import { friendInviteUrl } from "./friendInvite.js";
import { planInviteTokenFromHash, planInviteUrl } from "./planInvite.js";

const TOKEN = "A".repeat(41) + "_-";

describe("plan invite link", () => {
  it("round-trips a token through the URL, in the fragment only", () => {
    const url = new URL(planInviteUrl("https://example.test/", TOKEN));
    expect(url.pathname).toBe("/");
    expect(url.search).toBe("");
    expect(planInviteTokenFromHash(url.hash)).toBe(TOKEN);
  });

  it("never reads a friend invite link as a plan's", () => {
    const friend = new URL(friendInviteUrl("https://example.test", TOKEN));
    expect(planInviteTokenFromHash(friend.hash)).toBeNull();
  });

  it("reads nothing out of a hash without a whole token", () => {
    expect(planInviteTokenFromHash("")).toBeNull();
    expect(planInviteTokenFromHash("#plan-invite=short")).toBeNull();
  });
});
