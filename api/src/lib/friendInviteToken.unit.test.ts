// Mutation that turns it red: return the token itself from
// `hashFriendInviteToken`, or mint fewer than 32 bytes.
import { describe, expect, it } from "vitest";
import { isFriendInviteToken } from "@logjam/shared";
import {
  hashFriendInviteToken,
  mintFriendInviteToken,
} from "./friendInviteToken";

describe("friend invite token", () => {
  it("mints a token the shared parser accepts, different every time", () => {
    const a = mintFriendInviteToken();
    const b = mintFriendInviteToken();
    expect(isFriendInviteToken(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it("stores a hash that is stable and is not the token", () => {
    const token = mintFriendInviteToken();
    const hash = hashFriendInviteToken(token);
    expect(hash).toBe(hashFriendInviteToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
  });
});
