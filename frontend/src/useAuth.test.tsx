// Guards for the sign-in state machine and the two sign-outs. Drop the forced
// refresh in signOutEverywhere and the first two signOutEverywhere tests go
// red; drop the `await` on globalSignOut and the third does.
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const oidc = vi.hoisted(() => ({
  completeSignInFromUrl: vi.fn(),
  loadSession: vi.fn(),
  signInRedirect: vi.fn(),
  signInWithPassword: vi.fn(),
  endProviderSession: vi.fn(),
  hasCognitoAccount: vi.fn(() => true),
  issuerUrl: vi.fn(() => "https://cognito-idp.r.amazonaws.com/r_P"),
}));
const globalSignOut = vi.hoisted(() => vi.fn());
const clearTripDraft = vi.hoisted(() => vi.fn());
const reload = vi.hoisted(() => vi.fn());
const assign = vi.hoisted(() => vi.fn());
const setSessionExpiredHandler = vi.hoisted(() => vi.fn());
const clearTileCache = vi.hoisted(() => vi.fn(async () => {}));
const apiFetch = vi.hoisted(() => vi.fn(async () => ({})));
const recordConsent = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock("./auth/oidc", () => oidc);
vi.mock("@logjam/shared", async (orig) => ({
  ...(await orig<typeof import("@logjam/shared")>()),
  globalSignOut,
}));
vi.mock("./placeUtils", () => ({
  apiFetch,
  recordConsent,
  setSessionExpiredHandler,
}));
vi.mock("./geoPdf/cache", () => ({ clearTileCache }));
vi.mock("./tripDraft", () => ({ clearTripDraft }));

import { useAuth, signOut, signOutEverywhere } from "./useAuth";

const session = { id_token: "id", access_token: "at" };

// A real session, not the fake one local dev and e2e run on, which skips OIDC.
beforeEach(() => {
  vi.stubEnv("VITE_AUTH_MODE", "oidc");
  vi.clearAllMocks();
  clearTileCache.mockImplementation(async () => {});
  oidc.completeSignInFromUrl.mockResolvedValue(null);
  oidc.loadSession.mockResolvedValue(session);
  oidc.endProviderSession.mockResolvedValue(
    "https://auth.example.com/logout?x=1",
  );
  globalSignOut.mockResolvedValue(undefined);
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { reload, assign },
  });
});

afterEach(() => vi.unstubAllEnvs());

async function signedIn() {
  const hook = renderHook(() => useAuth());
  await waitFor(() => expect(hook.result.current.state).toBe("authenticated"));
  return hook;
}

describe("the sign-in callback", () => {
  // Mutation: let the catch fall through to setState("authenticated"), or
  // swallow the error, and a refused sign-in looks like a signed-in user.
  it("shows the error on the sign-in screen and does not sign in", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    oidc.completeSignInFromUrl.mockRejectedValue(new Error("access_denied"));
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.state).toBe("signIn"));
    expect(result.current.error).toBe("Sign in failed. Please try again.");
    expect(apiFetch).not.toHaveBeenCalled();
    expect(oidc.loadSession).not.toHaveBeenCalled();
  });

  it("offers another try: signing in again clears the error and redirects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    oidc.completeSignInFromUrl.mockRejectedValue(new Error("access_denied"));
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    await act(() => result.current.signIn());
    expect(oidc.signInRedirect).toHaveBeenCalledOnce();
    expect(result.current.error).toBeNull();
  });

  it("shows a redirect that cannot start (discovery unreachable) as an error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    oidc.loadSession.mockResolvedValue(null);
    oidc.signInRedirect.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.state).toBe("signIn"));
    await act(() => result.current.signIn());
    expect(result.current.error).toMatch(/connect/i);
  });

  // Mutation: setState("authenticated") before the clear or the /users/me
  // await (or drop either) and `state` is already authenticated inside the
  // mocks, or the order differs.
  it("empties the tile cache and provisions the user before it flips to authenticated", async () => {
    oidc.completeSignInFromUrl.mockResolvedValue(session);
    // One log of renders and of the two awaited steps, in the order they ran.
    const log: string[] = [];
    clearTileCache.mockImplementation(async () => {
      log.push("clear");
      // Let React render anything already set, so an early flip is seen.
      await new Promise((r) => setTimeout(r, 5));
    });
    apiFetch.mockImplementation(async () => {
      log.push("me");
      await new Promise((r) => setTimeout(r, 5));
      return {};
    });
    const hook = renderHook(() => {
      const auth = useAuth();
      if (log[log.length - 1] !== auth.state) log.push(auth.state);
      return auth;
    });
    await waitFor(() =>
      expect(hook.result.current.state).toBe("authenticated"),
    );
    expect(log).toEqual(["loading", "clear", "me", "authenticated"]);
    expect(oidc.loadSession).not.toHaveBeenCalled();
  });

  // Mutation: drop `if (cancelled) return;` after the callback try/catch: the
  // unmounted (first StrictMode) pass provisions and flips state too.
  it("does nothing more once the hook has unmounted", async () => {
    let finish: (u: unknown) => void = () => {};
    oidc.completeSignInFromUrl.mockReturnValue(
      new Promise((r) => (finish = r)),
    );
    const hook = renderHook(() => useAuth());
    hook.unmount();
    finish(session);
    await new Promise((r) => setTimeout(r, 0));
    expect(apiFetch).not.toHaveBeenCalled();
    expect(clearTileCache).not.toHaveBeenCalled();
  });
});

describe("the session check", () => {
  it("empties the tile cache when the tab opens with no session", async () => {
    oidc.loadSession.mockResolvedValue(null);
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.state).toBe("signIn"));
    expect(clearTileCache).toHaveBeenCalled();
  });

  // Mutation: restore `void clearTileCache()` in the mount `.catch`, or drop
  // the `sessionCheckFailed` guard on the `state === "signIn"` effect: either
  // clears the cache of a user who is still signed in, just offline.
  it("keeps the tile cache when the session check itself fails", async () => {
    oidc.loadSession.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.state).toBe("signIn"));
    await new Promise((r) => setTimeout(r, 0));
    expect(clearTileCache).not.toHaveBeenCalled();
  });

  it("keeps it while signed in", async () => {
    await signedIn();
    expect(clearTileCache).not.toHaveBeenCalled();
  });

  // Mutation: drop the effect on `state === "signIn"`: the expiry and
  // no-session tests still pass on their direct calls, this one does not.
  it("empties it whenever the sign-in screen shows, after the workers are gone", async () => {
    oidc.loadSession.mockResolvedValue(null);
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.state).toBe("signIn"));
    expect(clearTileCache.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("empties it when the session expires mid-use", async () => {
    await signedIn();
    const expire = setSessionExpiredHandler.mock.calls
      .map(([handler]) => handler)
      .find((handler) => typeof handler === "function");
    expect(expire).toBeTypeOf("function");
    act(() => expire());
    expect(clearTileCache).toHaveBeenCalled();
  });
});

describe("signOut", () => {
  // Mutation: drop the endProviderSession call and the provider's session (and
  // the stored tokens) outlive the sign-out.
  it("ends the provider's session, with the draft and tile cache cleared first", async () => {
    await signedIn();
    const calls: string[] = [];
    clearTripDraft.mockImplementation(() => calls.push("draft"));
    clearTileCache.mockImplementation(async () => {
      calls.push("tiles");
    });
    oidc.endProviderSession.mockImplementation(async () => {
      calls.push("redirect");
      return "https://auth.example.com/logout?x=1";
    });
    assign.mockImplementation(() => calls.push("navigate"));
    await act(() => signOut());
    // Mutation: navigate before the second clear (the old order) and the
    // clear can be aborted by the page leaving.
    expect(calls).toEqual(["draft", "tiles", "redirect", "tiles", "navigate"]);
    expect(assign).toHaveBeenCalledWith("https://auth.example.com/logout?x=1");
    expect(globalSignOut).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  // Mutation: drop friendInvite.clear() or planInvite.clear() from endSession.
  it("clears the pending friend and plan invites", async () => {
    await signedIn();
    sessionStorage.setItem("pendingFriendInvite", "friend-token");
    sessionStorage.setItem("pendingPlanInvite", "plan-token");
    await act(() => signOut());
    expect(sessionStorage.getItem("pendingFriendInvite")).toBeNull();
    expect(sessionStorage.getItem("pendingPlanInvite")).toBeNull();
  });

  it("reloads when the provider cannot be reached, so a corrupt session is still escapable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    oidc.endProviderSession.mockRejectedValue(new Error("boom"));
    await signOut();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("only reloads under fake auth, which has no provider", async () => {
    vi.stubEnv("VITE_AUTH_MODE", "fake");
    await signOut();
    expect(oidc.endProviderSession).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe("signOutEverywhere", () => {
  it("stays signed in, with the draft kept, when the refresh cannot reach the provider", async () => {
    oidc.loadSession.mockRejectedValue(new Error("offline"));
    await expect(signOutEverywhere()).rejects.toThrow("offline");
    expect(globalSignOut).not.toHaveBeenCalled();
    expect(oidc.endProviderSession).not.toHaveBeenCalled();
    expect(clearTripDraft).not.toHaveBeenCalled();
  });

  it("stays signed in when the refresh is rejected and leaves no session", async () => {
    oidc.loadSession.mockResolvedValue(null);
    await expect(signOutEverywhere()).rejects.toThrow();
    expect(globalSignOut).not.toHaveBeenCalled();
    expect(clearTripDraft).not.toHaveBeenCalled();
  });

  // Mutation: catch the GlobalSignOut failure (Amplify's old behaviour) and
  // every other session lives on while this one looks signed out.
  it("throws, clearing nothing, when GlobalSignOut fails", async () => {
    globalSignOut.mockRejectedValue(new Error("NotAuthorizedException"));
    await expect(signOutEverywhere()).rejects.toThrow("NotAuthorized");
    expect(clearTripDraft).not.toHaveBeenCalled();
    expect(clearTileCache).not.toHaveBeenCalled();
    expect(oidc.endProviderSession).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("refreshes first, revokes every session with the fresh token, then signs out", async () => {
    oidc.loadSession.mockResolvedValue({ ...session, access_token: "fresh" });
    await signOutEverywhere();
    expect(oidc.loadSession).toHaveBeenCalledWith(true);
    expect(globalSignOut).toHaveBeenCalledWith(
      "https://cognito-idp.r.amazonaws.com/r_P",
      "fresh",
    );
    expect(clearTripDraft).toHaveBeenCalledOnce();
    expect(oidc.endProviderSession).toHaveBeenCalledOnce();
  });
});

// Mutations that turn these red: let an unknown error reach the form, so a
// client Cognito no longer signs in from here strands the user; send a refused
// password to the provider's page; redirect while offline, onto the browser's
// error page; or flip to authenticated before the consent is recorded, so a new
// account meets the gate it has just answered.
describe("useAuth password sign-in", () => {
  const signedOut = async () => {
    oidc.loadSession.mockResolvedValue(null);
    const hook = renderHook(() => useAuth());
    await waitFor(() => expect(hook.result.current.state).toBe("signIn"));
    return hook;
  };
  const named = (name: string) => Object.assign(new Error(name), { name });

  beforeEach(() => oidc.signInRedirect.mockResolvedValue(undefined));

  it("signs in on the page, after clearing the last user's tiles", async () => {
    oidc.signInWithPassword.mockResolvedValue(true);
    const { result } = await signedOut();
    clearTileCache.mockClear();
    await act(() => result.current.signInWithPassword("a@b.co", "pw"));
    expect(clearTileCache).toHaveBeenCalled();
    expect(apiFetch).toHaveBeenCalledWith("/users/me");
    expect(oidc.signInRedirect).not.toHaveBeenCalled();
    expect(result.current.state).toBe("authenticated");
  });

  it("hands over to the provider's page when Cognito wants more", async () => {
    oidc.signInWithPassword.mockResolvedValue(false);
    const { result } = await signedOut();
    await act(() => result.current.signInWithPassword("a@b.co", "pw"));
    expect(oidc.signInRedirect).toHaveBeenCalledOnce();
    expect(result.current.state).toBe("signIn");
  });

  it("hands over to the provider's page when the form cannot finish", async () => {
    oidc.signInWithPassword.mockRejectedValue(
      named("InvalidParameterException"),
    );
    const { result } = await signedOut();
    await act(() => result.current.signInWithPassword("a@b.co", "pw"));
    expect(oidc.signInRedirect).toHaveBeenCalledOnce();
  });

  it("leaves a refused password with the form", async () => {
    oidc.signInWithPassword.mockRejectedValue(named("NotAuthorizedException"));
    const { result } = await signedOut();
    await expect(
      result.current.signInWithPassword("a@b.co", "pw"),
    ).rejects.toThrow();
    expect(oidc.signInRedirect).not.toHaveBeenCalled();
  });

  it("leaves a failure to the form when offline", async () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    oidc.signInWithPassword.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = await signedOut();
    await expect(
      result.current.signInWithPassword("a@b.co", "pw"),
    ).rejects.toThrow("Failed to fetch");
    expect(oidc.signInRedirect).not.toHaveBeenCalled();
    onLine.mockRestore();
  });

  it("hands over to the provider's page on a blocked request online", async () => {
    oidc.signInWithPassword.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = await signedOut();
    await act(() => result.current.signInWithPassword("a@b.co", "pw"));
    expect(oidc.signInRedirect).toHaveBeenCalledOnce();
  });

  it("records a new account's consent before it is signed in", async () => {
    oidc.signInWithPassword.mockResolvedValue(true);
    const { result } = await signedOut();
    let recorded = () => {};
    recordConsent.mockImplementationOnce(
      () => new Promise((resolve) => (recorded = () => resolve({}))),
    );
    let signingIn = Promise.resolve();
    act(() => {
      signingIn = result.current.signInWithPassword(
        "a@b.co",
        "pw",
        "canyoneer",
      );
    });
    await waitFor(() =>
      expect(recordConsent).toHaveBeenCalledWith(
        expect.any(String),
        "canyoneer",
      ),
    );
    expect(result.current.state).toBe("signIn");
    await act(async () => {
      recorded();
      await signingIn;
    });
    expect(result.current.state).toBe("authenticated");
  });

  it("leaves a failed consent record to the gate", async () => {
    oidc.signInWithPassword.mockResolvedValue(true);
    recordConsent.mockRejectedValueOnce(new Error("taken"));
    const { result } = await signedOut();
    await act(() =>
      result.current.signInWithPassword("a@b.co", "pw", "canyoneer"),
    );
    expect(result.current.state).toBe("authenticated");
  });
});
