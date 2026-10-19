import { beforeEach, describe, expect, it } from "vitest";
import {
  capturePlanInvite,
  clearPendingPlanInvite,
  pendingPlanInvite,
} from "./pendingPlanInvite";
import {
  captureFriendInvite,
  pendingFriendInvite,
} from "./pendingFriendInvite";

const TOKEN = "c".repeat(43);

describe("pending plan invite", () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  // Mutation: drop the replaceState, and the token stays in history and
  // in any screenshot of the address bar.
  it("takes the token out of the address bar and keeps it for after sign-in", () => {
    window.history.replaceState({}, "", `/#plan-invite=${TOKEN}`);
    capturePlanInvite();
    expect(window.location.hash).toBe("");
    expect(pendingPlanInvite()).toBe(TOKEN);
    clearPendingPlanInvite();
    expect(pendingPlanInvite()).toBeNull();
  });

  it("never takes a friend link for a plan link, or the reverse", () => {
    window.history.replaceState({}, "", `/#plan-invite=${TOKEN}`);
    captureFriendInvite();
    expect(pendingFriendInvite()).toBeNull();
    capturePlanInvite();
    expect(pendingPlanInvite()).toBe(TOKEN);
  });
});
