import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchOverlays = vi.hoisted(() => vi.fn());
vi.mock("./placeUtils", () => ({ apiFetch: fetchOverlays }));

import {
  cacheProfile,
  cachedProfile,
  clearProfileCache,
  profileCacheGeneration,
  type CachedProfile,
} from "./elevationCache";
import type { CompletedTopoJob } from "./topoLayerTypes";
import { useCompletedTopoJobs } from "./useCompletedTopoJobs";

// A job id ending "-area" is a sharpened job with an area of that id.
const job = (id: string) =>
  ({
    jobId: id,
    ...(id.endsWith("-area") ? { sharpened: { id } } : {}),
  }) as CompletedTopoJob;
const answer = (ids: string[]) => ({
  jobs: ids.map(job),
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
});

afterEach(() => {
  fetchOverlays.mockReset();
  clearProfileCache();
});

// A session expiry signs out with no reload, so the next person to sign in
// shares the tab with the last one's state. Mutation: keep the jobs across
// signing out, and user B is drawn user A's sharpened areas (A's presigned
// URLs work for a day) until B's list arrives, or for good if it fails.
describe("useCompletedTopoJobs across a sign-out", () => {
  it("holds no job of the last user once signed out", async () => {
    fetchOverlays.mockResolvedValueOnce(answer(["a-job"]));
    const { result, rerender } = renderHook(
      ({ signedIn }) => useCompletedTopoJobs(signedIn, signedIn),
      { initialProps: { signedIn: true } },
    );
    await waitFor(() => expect(result.current.jobs).toHaveLength(1));

    rerender({ signedIn: false });
    expect(result.current.jobs).toEqual([]);
    expect(result.current.loaded).toBe(false);

    fetchOverlays.mockRejectedValueOnce(new Error("offline"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    rerender({ signedIn: true });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.jobs).toEqual([]);
  });

  // Mutation: judge the stretch when the list arrives rather than when it
  // was asked for, and A's list, landing after B has signed in, is drawn
  // for B, replacing B's own list if that landed first, until the next
  // refetch (a day later, or sooner if B creates, finishes or deletes a
  // topo).
  it("drops a list asked for before the next user signed in", async () => {
    let arrive: (value: unknown) => void = () => {};
    fetchOverlays.mockReturnValueOnce(new Promise((r) => (arrive = r)));
    const { result, rerender } = renderHook(
      ({ signedIn }) => useCompletedTopoJobs(signedIn, signedIn),
      { initialProps: { signedIn: true } },
    );
    rerender({ signedIn: false });
    fetchOverlays.mockResolvedValueOnce(answer([]));
    rerender({ signedIn: true });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => arrive(answer(["a-job"])));
    expect(result.current.jobs).toEqual([]);
  });
});

const profile = {
  samples: [],
  gainM: 0,
  lossM: 0,
  minM: null,
  maxM: null,
  attribution: "",
} as CachedProfile;

// Mutation: drop the hook's scope call, and the profile cache, keyed on a
// line's points alone, hands the next user on the tab the last one's
// profile, or a revoked sharee the heights of an area they can't see.
describe("useCompletedTopoJobs and the profile cache", () => {
  it("empties the profile cache on signing out, and when an area goes", async () => {
    fetchOverlays.mockResolvedValueOnce(answer(["x-area", "y-area"]));
    const { result, rerender } = renderHook(
      ({ signedIn }) => useCompletedTopoJobs(signedIn, signedIn),
      { initialProps: { signedIn: true } },
    );
    await waitFor(() => expect(result.current.jobs).toHaveLength(2));
    cacheProfile("line", profile, profileCacheGeneration());
    rerender({ signedIn: false });
    expect(cachedProfile("line")).toBeNull();

    fetchOverlays.mockResolvedValueOnce(answer(["x-area", "y-area"]));
    rerender({ signedIn: true });
    await waitFor(() => expect(result.current.jobs).toHaveLength(2));
    cacheProfile("line", profile, profileCacheGeneration());
    fetchOverlays.mockResolvedValueOnce(answer(["x-area"]));
    await act(async () => {
      await result.current.refetch();
    });
    expect(cachedProfile("line")).toBeNull();
  });
});

// Mutation: scope the cache on whether user data loads rather than on
// whether anyone is signed in. Before /me settles (or if it fails) that is
// false for the whole session, so an expiry changes nothing: the next user,
// in the same state, is handed the last one's profile for the same line.
describe("useCompletedTopoJobs and a profile cached before /me settled", () => {
  it("empties the cache when the session ends, whatever user data did", () => {
    const { rerender } = renderHook(
      ({ signedIn }) => useCompletedTopoJobs(false, signedIn),
      { initialProps: { signedIn: true } },
    );
    cacheProfile("line", profile, profileCacheGeneration());
    rerender({ signedIn: false });
    rerender({ signedIn: true });
    expect(cachedProfile("line")).toBeNull();
  });
});
