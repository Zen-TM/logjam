// Guard: Amplify's global sign-out swallows a failed GlobalSignOut and still
// clears the browser. Drop the forced refresh in signOutEverywhere and the
// first two tests go red; drop the `!tokens` check and the second does.
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const amplify = vi.hoisted(() => ({
  signOut: vi.fn(),
  signIn: vi.fn(),
  fetchAuthSession: vi.fn(),
}));
const clearTripDraft = vi.hoisted(() => vi.fn());
const reload = vi.hoisted(() => vi.fn());

vi.mock("aws-amplify/auth", () => ({
  ...amplify,
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  resendSignUpCode: vi.fn(),
  resetPassword: vi.fn(),
  confirmResetPassword: vi.fn(),
}));
const setSessionExpiredHandler = vi.hoisted(() => vi.fn());
const clearTileCache = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./placeUtils", () => ({
  apiFetch: vi.fn(async () => ({})),
  setSessionExpiredHandler,
}));
vi.mock("./geoPdf/cache", () => ({ clearTileCache }));
vi.mock("./tripDraft", () => ({ clearTripDraft }));

import { useAuth } from "./useAuth";

// A real session, not the fake one local dev and e2e run on, which skips Amplify.
beforeEach(() => {
  vi.stubEnv("VITE_AUTH_MODE", "cognito");
  vi.clearAllMocks();
  clearTileCache.mockImplementation(async () => {});
  amplify.signOut.mockResolvedValue(undefined);
  amplify.fetchAuthSession.mockResolvedValue({ tokens: { idToken: {} } });
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { reload },
  });
});

afterEach(() => vi.unstubAllEnvs());

async function signedIn() {
  const hook = renderHook(() => useAuth());
  await waitFor(() => expect(hook.result.current.state).toBe("authenticated"));
  return hook;
}

describe("signOut", () => {
  it("ends this browser's session only", async () => {
    const { result } = await signedIn();
    await act(() => result.current.signOut());
    expect(amplify.signOut).toHaveBeenCalledWith({ global: false });
    expect(reload).toHaveBeenCalledOnce();
  });

  // The GeoPDF tile cache shows which areas a user printed, so it goes with
  // the session down every exit that is known to be one. Mutation: drop
  // `clearTileCache()` from endSession and the first test goes red. The expiry
  // and no-session paths are covered twice over (their own call, and the
  // `state === "signIn"` effect), so drop both to turn those tests red.
  it("empties the GeoPDF tile cache before it reloads", async () => {
    const { result } = await signedIn();
    reload.mockImplementation(() => expect(clearTileCache).toHaveBeenCalled());
    await act(() => result.current.signOut());
    expect(clearTileCache).toHaveBeenCalled();
    expect(reload).toHaveBeenCalledOnce();
  });

  // Mutation: drop the effect on `state === "signIn"`: the expiry and
  // no-session tests still pass on their direct calls, this one does not.
  it("empties it whenever the sign-in screen shows, after the workers are gone", async () => {
    const { result } = await signedIn();
    clearTileCache.mockClear();
    act(() => result.current.goToSignIn());
    await waitFor(() => expect(clearTileCache).toHaveBeenCalled());
  });

  // Mutation: drop the second `clearTileCache()` after amplifySignOut: a
  // worker's write during the sign-out round trip survives the reload.
  it("empties it again after the sign-out round trip, before it reloads", async () => {
    const { result } = await signedIn();
    clearTileCache.mockClear();
    let signOutDone = false;
    amplify.signOut.mockImplementation(async () => {
      signOutDone = true;
    });
    reload.mockImplementation(() => {
      expect(signOutDone).toBe(true);
      expect(clearTileCache).toHaveBeenCalledTimes(2);
    });
    await act(() => result.current.signOut());
    expect(reload).toHaveBeenCalledOnce();
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

  it("empties it when the tab opens with no session", async () => {
    amplify.fetchAuthSession.mockResolvedValue({ tokens: undefined });
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.state).toBe("signIn"));
    expect(clearTileCache).toHaveBeenCalled();
  });

  // Mutation: restore `void clearTileCache()` in the mount `.catch`, or drop
  // the `sessionCheckFailed` guard on the `state === "signIn"` effect: either
  // clears the cache of a user who is still signed in, just offline.
  it("keeps it when the session check itself fails", async () => {
    amplify.fetchAuthSession.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.state).toBe("signIn"));
    act(() => result.current.goToSignUp());
    act(() => result.current.goToSignIn());
    expect(clearTileCache).not.toHaveBeenCalled();
  });

  // Mutation: drop `await clearTileCache()` from handleSignIn and someone else
  // signing in after a failed check inherits the last user's cache.
  it("empties it at a successful sign-in, before the state flips", async () => {
    amplify.fetchAuthSession.mockRejectedValue(new Error("offline"));
    amplify.signIn.mockResolvedValue({ isSignedIn: true });
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.state).toBe("signIn"));
    expect(clearTileCache).not.toHaveBeenCalled();
    clearTileCache.mockImplementation(async () => {
      expect(result.current.state).toBe("signIn");
    });
    await act(() => result.current.signIn("bob", "pw"));
    expect(clearTileCache).toHaveBeenCalledOnce();
    expect(result.current.state).toBe("authenticated");
  });

  it("keeps it while signed in", async () => {
    await signedIn();
    expect(clearTileCache).not.toHaveBeenCalled();
  });
});

describe("signOutEverywhere", () => {
  it("stays signed in, with the draft kept, when the refresh cannot reach Logjam", async () => {
    const { result } = await signedIn();
    amplify.fetchAuthSession.mockRejectedValue(new Error("offline"));
    await expect(result.current.signOutEverywhere()).rejects.toThrow("offline");
    expect(amplify.signOut).not.toHaveBeenCalled();
    expect(clearTripDraft).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("stays signed in when the refresh is rejected and leaves no tokens", async () => {
    const { result } = await signedIn();
    amplify.fetchAuthSession.mockResolvedValue({ tokens: undefined });
    await expect(result.current.signOutEverywhere()).rejects.toThrow();
    expect(amplify.signOut).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("refreshes first, then revokes every session and clears the draft", async () => {
    const { result } = await signedIn();
    amplify.fetchAuthSession.mockClear();
    await act(() => result.current.signOutEverywhere());
    expect(amplify.fetchAuthSession).toHaveBeenCalledWith({
      forceRefresh: true,
    });
    expect(amplify.signOut).toHaveBeenCalledWith({ global: true });
    expect(clearTripDraft).toHaveBeenCalledOnce();
    expect(clearTileCache).toHaveBeenCalled();
    expect(reload).toHaveBeenCalledOnce();
  });
});
