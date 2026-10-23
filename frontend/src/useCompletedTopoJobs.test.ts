import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchOverlays = vi.hoisted(() => vi.fn());
vi.mock("./placeUtils", () => ({ apiFetch: fetchOverlays }));

import type { CompletedTopoJob } from "./topoLayerTypes";
import { useCompletedTopoJobs } from "./useCompletedTopoJobs";

const job = (id: string) => ({ jobId: id }) as CompletedTopoJob;
const answer = (ids: string[]) => ({
  jobs: ids.map(job),
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
});

afterEach(() => fetchOverlays.mockReset());

// A session expiry signs out with no reload, so the next person to sign in
// shares the tab with the last one's state. Mutation: keep the jobs across
// signing out, and user B is drawn user A's sharpened areas (A's presigned
// URLs work for a day) until B's list arrives, or for good if it fails.
describe("useCompletedTopoJobs across a sign-out", () => {
  it("holds no job of the last user once signed out", async () => {
    fetchOverlays.mockResolvedValueOnce(answer(["a-job"]));
    const { result, rerender } = renderHook(
      ({ signedIn }) => useCompletedTopoJobs(signedIn),
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

  it("drops a list that arrives after the user signed out", async () => {
    let arrive: (value: unknown) => void = () => {};
    fetchOverlays.mockReturnValueOnce(new Promise((r) => (arrive = r)));
    const { result, rerender } = renderHook(
      ({ signedIn }) => useCompletedTopoJobs(signedIn),
      { initialProps: { signedIn: true } },
    );
    rerender({ signedIn: false });
    await act(async () => arrive(answer(["a-job"])));
    expect(result.current.jobs).toEqual([]);
  });
});
