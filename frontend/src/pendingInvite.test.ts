import { beforeEach, describe, expect, it } from "vitest";
import { friendInvite, planInvite } from "./pendingInvite";

const FRIEND = "b".repeat(43);
const PLAN = "c".repeat(43);

describe("a pending invite", () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  // Mutation: drop the replaceState, and the token stays in history and
  // in any screenshot of the address bar.
  it("takes the token out of the address bar and keeps it for after sign-in", () => {
    window.history.replaceState({}, "", `/?x=1#invite=${FRIEND}`);
    friendInvite.capture();
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("?x=1");
    expect(friendInvite.pending()).toBe(FRIEND);
    friendInvite.clear();
    expect(friendInvite.pending()).toBeNull();

    window.history.replaceState({}, "", `/#plan-invite=${PLAN}`);
    planInvite.capture();
    expect(window.location.hash).toBe("");
    expect(planInvite.pending()).toBe(PLAN);
  });

  it("leaves any other hash alone", () => {
    window.history.replaceState({}, "", "/#invite=nope");
    friendInvite.capture();
    expect(window.location.hash).toBe("#invite=nope");
    expect(friendInvite.pending()).toBeNull();
  });

  // Mutation: give both the same parser, and a friend link is held as a plan
  // link (or the reverse) and its hash taken from the other.
  it("never takes a friend link for a plan link, or the reverse", () => {
    window.history.replaceState({}, "", `/#plan-invite=${PLAN}`);
    friendInvite.capture();
    expect(friendInvite.pending()).toBeNull();
    expect(window.location.hash).toBe(`#plan-invite=${PLAN}`);

    window.history.replaceState({}, "", `/#invite=${FRIEND}`);
    planInvite.capture();
    expect(planInvite.pending()).toBeNull();
    expect(window.location.hash).toBe(`#invite=${FRIEND}`);
  });
});
