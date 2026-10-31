// Guard: the order Sign out runs in. Everywhere, the forced refresh and the
// provider's GlobalSignOut both come before anything is wiped, and either
// failing leaves the phone as it was (ADR 0041).
//
// Mutations: run `signOutEverywhereAtProvider` after `wipe` -> "ends the other
// sessions after the confirm and before anything is wiped" goes red; swallow
// its error (or `assertCanSignOutEverywhere`'s) and the matching "aborts" test
// goes red; ask `confirm` before the forced refresh and the refresh-failure
// test sees `confirm` called.
import { describe, expect, it, vi } from "vitest";

import { runSignOut, type SignOutSteps } from "./signOutSequence";

function steps(
  overrides: (calls: string[]) => Partial<SignOutSteps> = () => ({}),
) {
  const calls: string[] = [];
  const log = (name: string, result?: unknown) =>
    vi.fn(async () => {
      calls.push(name);
      return result;
    });
  const s = {
    everywhere: true,
    accountDeleted: false,
    assertCanSignOutEverywhere: log("refresh"),
    confirm: log("confirm", true),
    signOutEverywhereAtProvider: log("globalSignOut"),
    reportEverywhereFailed: vi.fn(() => void calls.push("alert")),
    unregisterPush: log("unregisterPush"),
    wipe: log("wipe", { failed: [] }),
    reportWipeIncomplete: vi.fn(() => void calls.push("wipeAlert")),
    finish: log("finish"),
    ...overrides(calls),
  } as unknown as SignOutSteps;
  return { s, calls };
}

describe("sign out everywhere", () => {
  it("ends the other sessions after the confirm and before anything is wiped", async () => {
    const { s, calls } = steps();
    await runSignOut(s);
    expect(calls).toEqual([
      "refresh",
      "confirm",
      "globalSignOut",
      "unregisterPush",
      "wipe",
      "finish",
    ]);
  });

  it("aborts with nothing wiped, and tells the user, when the refresh fails", async () => {
    const { s, calls } = steps((calls) => ({
      assertCanSignOutEverywhere: vi.fn(async () => {
        calls.push("refresh");
        throw new Error("offline");
      }),
    }));
    await runSignOut(s);
    expect(calls).toEqual(["refresh", "alert"]);
  });

  it("aborts with nothing wiped, and tells the user, when GlobalSignOut fails", async () => {
    const { s, calls } = steps((calls) => ({
      signOutEverywhereAtProvider: vi.fn(async () => {
        calls.push("globalSignOut");
        throw new Error("NotAuthorizedException");
      }),
    }));
    await runSignOut(s);
    expect(calls).toEqual(["refresh", "confirm", "globalSignOut", "alert"]);
  });

  it("does nothing when the user declines", async () => {
    const { s, calls } = steps(() => ({ confirm: vi.fn(async () => false) }));
    await runSignOut(s);
    expect(calls).toEqual(["refresh"]);
  });
});

describe("an ordinary sign out", () => {
  it("never touches the provider's sign-out-everywhere", async () => {
    const { s, calls } = steps(() => ({ everywhere: false }));
    await runSignOut(s);
    expect(calls).toEqual(["confirm", "unregisterPush", "wipe", "finish"]);
  });

  it("does not ask after the account was deleted", async () => {
    const { s, calls } = steps(() => ({
      everywhere: false,
      accountDeleted: true,
    }));
    await runSignOut(s);
    expect(calls).toEqual(["unregisterPush", "wipe", "finish"]);
  });

  it("says so when part of the wipe failed, and still signs out", async () => {
    const { s, calls } = steps((calls) => ({
      everywhere: false,
      wipe: vi.fn(async () => {
        calls.push("wipe");
        return { failed: ["photos"] };
      }),
    }));
    await runSignOut(s);
    expect(calls).toEqual([
      "confirm",
      "unregisterPush",
      "wipe",
      "wipeAlert",
      "finish",
    ]);
  });
});
