// The shared data hooks in placeUtils.ts fire a request on every
// `fetchCount` bump but must not let an earlier in-flight response overwrite
// state set by a later one (load → write → refetch, with the load's response
// landing after the refetch's). Covers one representative hook (`usePlaces`)
// — the same `cancelled` guard is applied identically to all eight hooks.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { usePlaces, useTripLogs } from "./placeUtils";

vi.mock("./auth/oidc", () => ({
  loadSession: vi.fn().mockResolvedValue({ id_token: "test-token" }),
}));

function fakeResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePlaces stale-response race", () => {
  it("keeps the newer response when the older request resolves last", async () => {
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    const firstResponse = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const secondResponse = new Promise((resolve) => {
      resolveSecond = resolve;
    });

    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(firstResponse)
      .mockReturnValueOnce(secondResponse);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePlaces(true));

    // Bump refetch (simulates a write completing) before the first request's
    // response has arrived — this is the load(A) -> write -> refetch(B)
    // sequence.
    act(() => {
      result.current.refetch();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // Newer request (B) resolves first.
    act(() => {
      resolveSecond(fakeResponse([{ id: "fresh" }]));
    });
    await waitFor(() =>
      expect(result.current.places).toEqual([{ id: "fresh" }]),
    );

    // Older request (A) resolves after — must NOT overwrite the fresh state.
    await act(async () => {
      resolveFirst(fakeResponse([{ id: "stale" }]));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.places).toEqual([{ id: "fresh" }]);
  });
});

// A failed first load is `failed`, never a loaded empty list (which the Places
// panel reads as "add your first place"). Mutation that turns it red: call
// `setLoaded(true)` in the hook's `.finally`, as it did before.
describe.each([
  ["usePlaces", usePlaces],
  ["useTripLogs", useTripLogs],
])("%s when the first load fails", (_name, useHook) => {
  it("is failed until a retry succeeds, then ready", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(fakeResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() => useHook(true));
    await waitFor(() => expect(result.current.state).toBe("failed"));
    expect(result.current.loaded).toBe(false);

    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.error).toBeNull();
  });
});
