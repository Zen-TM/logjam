// Guards for who owns this phone when a sign-in lands (root AGENTS.md, useAuth
// header). Each names its mutation.
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const readPreviousIdentity = vi.fn();
const wipeAllLocalData = vi.fn();
const apiFetch = vi.fn();

vi.mock("expo-secure-store", () => ({}));
vi.mock("../api/apiFetch", () => ({ apiFetch: (p: string) => apiFetch(p) }));
vi.mock("../offline/wipeLocalData", () => ({
  wipeAllLocalData: () => {
    calls.push("wipe");
    return wipeAllLocalData();
  },
}));
vi.mock("../notifications/pushRegistration", () => ({
  unregisterPushNotifications: async () => {
    calls.push("unregisterPush");
  },
}));
vi.mock("./guestModePreference", () => ({
  writeEntryChoice: (v: string) => calls.push(`entryChoice:${v}`),
}));
vi.mock("./localIdentity", async () => {
  const real =
    await vi.importActual<typeof import("./localIdentity")>("./localIdentity");
  return {
    signInNeedsWipe: real.signInNeedsWipe,
    readPreviousIdentity: () => readPreviousIdentity(),
    clearLocalIdentity: async () => {
      calls.push("clearIdentity");
    },
    writeLocalIdentity: async (i: { sub: string }) => {
      calls.push(`writeIdentity:${i.sub}`);
    },
  };
});
vi.mock("./oidcSession", () => ({
  identityFromIdToken: (t: string) =>
    t === "no-sub" ? null : { sub: t, username: `${t}@example.com` },
}));

const { finishSignIn: finish } = await import("./finishSignIn");

// What signInWithBrowser hands over: the tokens are stored only by `commit`.
const finishSignIn = (idToken: string) =>
  finish({
    idToken,
    commit: async () => {
      calls.push("commit");
    },
  });

beforeEach(() => {
  calls.length = 0;
  readPreviousIdentity.mockReset().mockResolvedValue(null);
  wipeAllLocalData.mockReset().mockResolvedValue({ failed: [] });
  apiFetch.mockReset().mockResolvedValue(undefined);
});

describe("finishSignIn", () => {
  // Mutation: reorder the wipe before unregisterPush, or the identity write
  // before the wipe, or commit before unregisterPush (the DELETE then runs as
  // the arriving user, the API deletes zero rows and the departing user's
  // pushes keep reaching this phone).
  it("as a different user: unregisters push, wipes, then records the new identity", async () => {
    readPreviousIdentity.mockResolvedValue({ sub: "old", username: "o" });
    expect(await finishSignIn("new")).toEqual({ ok: true });
    expect(calls).toEqual([
      "unregisterPush",
      "wipe",
      "clearIdentity",
      "writeIdentity:new",
      "commit",
      "entryChoice:account",
    ]);
  });

  it("as the same user: keeps the data", async () => {
    readPreviousIdentity.mockResolvedValue({ sub: "same", username: "o" });
    await finishSignIn("same");
    expect(calls).not.toContain("wipe");
  });

  // Mutation: treat `previous === null` as needing a wipe.
  it("as a guest linking an account: keeps the data", async () => {
    await finishSignIn("new");
    expect(calls).not.toContain("wipe");
    expect(calls).not.toContain("unregisterPush");
    expect(calls).toContain("writeIdentity:new");
  });

  // Mutation: treat "unreadable" as a guest.
  it("with an unreadable previous record: wipes", async () => {
    readPreviousIdentity.mockResolvedValue("unreadable");
    await finishSignIn("new");
    expect(calls).toContain("wipe");
  });

  // Mutation: commit (store the new tokens) before or despite a failed wipe.
  it("stores nothing when the wipe fails", async () => {
    readPreviousIdentity.mockResolvedValue({ sub: "old", username: "o" });
    wipeAllLocalData.mockResolvedValue({ failed: ["photos"] });
    const result = await finishSignIn("new");
    expect(result).toMatchObject({ ok: false });
    expect(calls).toEqual(["unregisterPush", "wipe"]);
  });

  // Mutation: commit before the wipe.
  it("stores nothing when a step throws", async () => {
    readPreviousIdentity.mockResolvedValue({ sub: "old", username: "o" });
    wipeAllLocalData.mockRejectedValue(new Error("disk"));
    await expect(finishSignIn("new")).rejects.toThrow("disk");
    expect(calls).not.toContain("commit");
  });

  // Mutation: carry on without a sub (or commit before checking it).
  it("cancels the sign-in when the ID token has no sub", async () => {
    const result = await finishSignIn("no-sub");
    expect(result).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });

  it("signs in even when provisioning cannot reach the API", async () => {
    apiFetch.mockRejectedValue(new Error("offline"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await finishSignIn("new")).toEqual({ ok: true });
  });
});
