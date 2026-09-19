import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useCurrentUser } from "./placeUtils";

// The signed-in user's own record is the app's only source for "who am I", and
// `null` is load-bearing: Account renders "Loading…" for as long as it stays
// null, and way ownership reads a missing user as "not mine" — which hands a
// friend's shared route the OWNER's verbs (waysModel.ts `shared`, wayActions
// `owned`). Swallowing the one failure therefore did not degrade one page: a
// single 429 or 500 made Account load forever and mislabelled ownership, with
// nothing to retry. It was the one hook in placeUtils that did not return
// `error` (frontend/CLAUDE.md, "Hook contract").
//
// The 429 is the case that found it: a rate-limited boot, not a dead server.

const user = {
  id: "u1",
  username: "alice",
  email: "alice@example.com",
  consentVersion: "2026-01-01",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  // Skips Amplify entirely in getIdToken — the same branch local dev uses.
  vi.stubEnv("VITE_AUTH_MODE", "fake");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("useCurrentUser load failure", () => {
  it("surfaces a retryable error rather than staying null with no reason", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 429)));

    const { result } = renderHook(() => useCurrentUser(true));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.currentUser).toBeNull();
    // The user is told what happened, in the words the shared mapper owns.
    expect(result.current.error).toBe("Too many requests. Please wait a moment and try again.");
  });

  it("clears the error and caches the user when a retry lands", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse(user));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCurrentUser(true));
    await waitFor(() => expect(result.current.error).not.toBeNull());

    act(() => result.current.refetchCurrentUser());

    await waitFor(() => expect(result.current.currentUser).toEqual(user));
    expect(result.current.error).toBeNull();
  });

  it("does not fetch until it is enabled, and reports nothing while it waits", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCurrentUser(false));

    expect(fetchMock).not.toHaveBeenCalled();
    // Neither loaded nor failed: the consent gate's third state, which is what
    // a gate keyed on "not blocked" would have mistaken for an answer.
    expect(result.current.currentUser).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
