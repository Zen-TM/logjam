// Guard: Amplify's global sign-out swallows a failed GlobalSignOut and still
// clears the browser. Drop the forced refresh in signOutEverywhere and the
// first two tests go red; drop the `!tokens` check and the second does.
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const amplify = vi.hoisted(() => ({
  signOut: vi.fn(),
  fetchAuthSession: vi.fn(),
}));
const clearTripDraft = vi.hoisted(() => vi.fn());
const reload = vi.hoisted(() => vi.fn());

vi.mock("aws-amplify/auth", () => ({
  ...amplify,
  signIn: vi.fn(),
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  resendSignUpCode: vi.fn(),
  resetPassword: vi.fn(),
  confirmResetPassword: vi.fn(),
}));
vi.mock("./placeUtils", () => ({
  apiFetch: vi.fn(),
  setSessionExpiredHandler: vi.fn(),
}));
vi.mock("./tripDraft", () => ({ clearTripDraft }));

import { useAuth } from "./useAuth";

// A real session, not the fake one local dev and e2e run on, which skips Amplify.
beforeEach(() => {
  vi.stubEnv("VITE_AUTH_MODE", "cognito");
  vi.clearAllMocks();
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
    expect(reload).toHaveBeenCalledOnce();
  });
});
