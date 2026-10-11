import { beforeEach, describe, expect, it } from "vitest";
import {
  captureFriendInvite,
  clearPendingFriendInvite,
  pendingFriendInvite,
} from "./pendingFriendInvite";

const TOKEN = "b".repeat(43);

describe("pending friend invite", () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("takes the token out of the address bar and keeps it for after sign-in", () => {
    window.history.replaceState({}, "", `/?x=1#invite=${TOKEN}`);
    captureFriendInvite();
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("?x=1");
    expect(pendingFriendInvite()).toBe(TOKEN);
    clearPendingFriendInvite();
    expect(pendingFriendInvite()).toBeNull();
  });

  it("leaves any other hash alone", () => {
    window.history.replaceState({}, "", "/#invite=nope");
    captureFriendInvite();
    expect(window.location.hash).toBe("#invite=nope");
    expect(pendingFriendInvite()).toBeNull();
  });
});
