// Guards for the hook's decisions. React is stubbed so the hook runs as a plain
// function (effects are collected and run by hand): mobile's vitest has no
// jsdom or renderer.
//
//  - Fake auth: the button enters as the fake user and never opens a browser.
//    Drop the fake branch in `handleSignIn` and the first test goes red; write
//    a local identity from it and the first goes red as well.
//  - A closed sheet changes nothing: make `cancel` set an error, a state or
//    run `finishSignIn` and the second test goes red.
//  - Cold start keeps a known user on a transient failure (network, timeout) and
//    drops only on no session: classify a failure other than "transient" as
//    sign-out, or ignore `localIdentity`, and the restore tests go red.
//  - Sign-out clears tokens and identity BEFORE any network call: move
//    `signOutLocally` after `endProviderSession`, or make a failing
//    `endProviderSession` skip `setState("chooser")`, and the sign-out tests
//    go red.
import { beforeEach, describe, expect, it, vi } from "vitest";

const setState = vi.fn();
const effects: (() => void | (() => void))[] = [];
const events: string[] = [];
const config = { authMode: "fake" as string };
const signInWithBrowser = vi.fn();
const finishSignIn = vi.fn();
const getSession = vi.fn();
const signOutLocally = vi.fn();
const endProviderSession = vi.fn();
const readLocalIdentity = vi.fn();
const writeEntryChoice = vi.fn();
const writeLocalIdentity = vi.fn();

vi.mock("react", () => ({
  useState: (init: unknown) => [
    typeof init === "function" ? (init as () => unknown)() : init,
    setState,
  ],
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => void | (() => void)) => {
    effects.push(fn);
  },
}));
vi.mock("react-native", () => ({ AppState: { addEventListener: vi.fn() } }));
vi.mock("../config", () => ({ config }));
vi.mock("../api/apiFetch", () => ({ setSessionRejectedHandler: vi.fn() }));
vi.mock("./oidcSession", () => ({
  signInWithBrowser,
  getSession,
  signOutLocally,
  endProviderSession,
}));
vi.mock("./finishSignIn", () => ({ finishSignIn }));
vi.mock("./guestModePreference", () => ({
  clearEntryChoice: () => events.push("clearEntryChoice"),
  readEntryChoice: () => "unchosen",
  writeEntryChoice,
}));
vi.mock("./localIdentity", () => ({
  clearLocalIdentity: async () => {
    events.push("clearLocalIdentity");
  },
  readLocalIdentity,
  writeLocalIdentity,
}));

const { useAuth } = await import("./useAuth");
// The stubbed hook is a plain function; the alias keeps the hooks lint rule out of async tests.
const runHook = useAuth;

beforeEach(() => {
  setState.mockReset();
  effects.length = 0;
  events.length = 0;
  config.authMode = "fake";
  for (const fn of [
    signInWithBrowser,
    finishSignIn,
    getSession,
    signOutLocally,
    endProviderSession,
    readLocalIdentity,
  ])
    fn.mockReset();
  writeEntryChoice.mockReset().mockReturnValue(true);
  writeLocalIdentity.mockReset();
  readLocalIdentity.mockResolvedValue({ sub: "s", username: "a@example.com" });
  signOutLocally.mockImplementation(async () => {
    events.push("signOutLocally");
    return { idToken: "i" };
  });
  endProviderSession.mockImplementation(async () => {
    events.push("endProviderSession");
  });
});

describe("fake-auth sign-in", () => {
  it("signs straight in without opening a browser, and records the account choice", async () => {
    const ok = await useAuth().signIn();
    expect(ok).toBe(true);
    expect(setState).toHaveBeenLastCalledWith("authenticated");
    expect(signInWithBrowser).not.toHaveBeenCalled();
    expect(writeLocalIdentity).not.toHaveBeenCalled();
    expect(writeEntryChoice).toHaveBeenCalledWith("account");
  });
});

describe("OIDC sign-in", () => {
  beforeEach(() => {
    config.authMode = "oidc";
  });

  it("changes nothing when the browser sheet is closed", async () => {
    signInWithBrowser.mockResolvedValue({ type: "cancel" });
    expect(await useAuth().signIn()).toBe(false);
    expect(finishSignIn).not.toHaveBeenCalled();
    expect(setState).not.toHaveBeenCalledWith("authenticated");
    // Only the reset of the error before the attempt; none after it.
    expect(setState.mock.calls.filter(([v]) => typeof v === "string")).toEqual(
      [],
    );
  });

  it("opens the app once the identity is settled", async () => {
    signInWithBrowser.mockResolvedValue({ type: "success", idToken: "i" });
    finishSignIn.mockResolvedValue({ ok: true });
    expect(await useAuth().signIn()).toBe(true);
    expect(finishSignIn).toHaveBeenCalledWith("i");
    expect(setState).toHaveBeenLastCalledWith("authenticated");
  });

  it("stays on sign-in when finishing is refused", async () => {
    signInWithBrowser.mockResolvedValue({ type: "success", idToken: "i" });
    finishSignIn.mockResolvedValue({ ok: false, error: "cancelled" });
    expect(await useAuth().signIn()).toBe(false);
    expect(setState).not.toHaveBeenCalledWith("authenticated");
  });
});

describe("cold start", () => {
  async function restore() {
    config.authMode = "oidc";
    runHook();
    await effects[0]();
    await new Promise((r) => setTimeout(r, 0));
  }

  it("opens a user whose token works", async () => {
    getSession.mockResolvedValue({ idToken: "i", accessToken: "a" });
    await restore();
    expect(setState).toHaveBeenLastCalledWith("authenticated");
  });

  it("keeps a known user signed in when the refresh could not be tried (offline, timeout)", async () => {
    getSession.mockRejectedValue(new TypeError("Network request failed"));
    await restore();
    expect(setState).toHaveBeenLastCalledWith("authenticated");
  });

  it("asks a user with no identity on the phone to sign in when it could not be tried", async () => {
    readLocalIdentity.mockResolvedValue(null);
    getSession.mockRejectedValue(new TypeError("Network request failed"));
    await restore();
    expect(setState).toHaveBeenLastCalledWith("chooser");
  });

  it("asks for sign-in when there is no session", async () => {
    getSession.mockResolvedValue(null);
    await restore();
    expect(setState).toHaveBeenLastCalledWith("chooser");
  });

  it("asks for sign-in when the provider rejected the refresh", async () => {
    getSession.mockRejectedValue(
      Object.assign(new Error("x"), { name: "invalid_grant" }),
    );
    await restore();
    expect(setState).toHaveBeenLastCalledWith("chooser");
  });
});

describe("sign out", () => {
  it("clears tokens and identity before it touches the network, and lands on the chooser", async () => {
    config.authMode = "oidc";
    endProviderSession.mockImplementation(async () => {
      events.push("endProviderSession");
      expect(setState).toHaveBeenLastCalledWith("chooser");
    });
    await useAuth().signOut();
    expect(events).toEqual([
      "clearLocalIdentity",
      "clearEntryChoice",
      "signOutLocally",
      "endProviderSession",
    ]);
  });

  it("completes when ending the provider's session fails", async () => {
    config.authMode = "oidc";
    endProviderSession.mockRejectedValue(new Error("offline"));
    await expect(useAuth().signOut()).resolves.toBeUndefined();
    expect(setState).toHaveBeenLastCalledWith("chooser");
  });

  it("completes when the tokens could not be cleared", async () => {
    config.authMode = "oidc";
    signOutLocally.mockRejectedValue(new Error("keystore"));
    await useAuth().signOut();
    expect(setState).toHaveBeenLastCalledWith("chooser");
  });
});
