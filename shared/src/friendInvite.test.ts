// Mutation that turns it red: put the token in the query string or the path
// in `friendInviteUrl`, or loosen TOKEN so a short or padded value passes.
import { describe, expect, it } from "vitest";
import {
  friendInviteTokenFromHash,
  friendInviteUrl,
  isFriendInviteToken,
} from "./friendInvite.js";

const TOKEN = "A".repeat(41) + "_-";

describe("friend invite link", () => {
  it("round-trips a token through the URL", () => {
    const url = new URL(friendInviteUrl("https://example.test/", TOKEN));
    expect(friendInviteTokenFromHash(url.hash)).toBe(TOKEN);
  });

  it("keeps the token out of everything a server is sent", () => {
    const url = new URL(friendInviteUrl("https://example.test", TOKEN));
    expect(url.pathname).toBe("/");
    expect(url.search).toBe("");
    expect(url.hash).toContain(TOKEN);
  });

  it("accepts only a whole token", () => {
    expect(isFriendInviteToken(TOKEN)).toBe(true);
    expect(isFriendInviteToken(TOKEN.slice(1))).toBe(false);
    expect(isFriendInviteToken(TOKEN + "A")).toBe(false);
    expect(isFriendInviteToken(TOKEN.replace("_", "="))).toBe(false);
    expect(isFriendInviteToken(undefined)).toBe(false);
  });

  it("reads nothing out of a hash without a whole token", () => {
    expect(friendInviteTokenFromHash("")).toBeNull();
    expect(friendInviteTokenFromHash("#invite=short")).toBeNull();
    expect(friendInviteTokenFromHash(`#other=${TOKEN}`)).toBeNull();
  });
});
