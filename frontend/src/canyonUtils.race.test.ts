// FECO-001: the shared data hooks in canyonUtils.ts fire a request on every
// `fetchCount` bump but must not let an earlier in-flight response overwrite
// state set by a later one (load → write → refetch, with the load's response
// landing after the refetch's). Covers one representative hook (`useCanyons`)
// per the finding's suggested test — the same `cancelled` guard is applied
// identically to all eight hooks.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useCanyons } from "./canyonUtils";

vi.mock("aws-amplify/auth", () => ({
  fetchAuthSession: vi.fn().mockResolvedValue({
    tokens: { idToken: { toString: () => "test-token" } },
  }),
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

describe("useCanyons stale-response race (FECO-001)", () => {
  it("keeps the newer response when the older request resolves last", async () => {
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    const firstResponse = new Promise((resolve) => { resolveFirst = resolve; });
    const secondResponse = new Promise((resolve) => { resolveSecond = resolve; });

    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(firstResponse)
      .mockReturnValueOnce(secondResponse);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCanyons(true));

    // Bump refetch (simulates a write completing) before the first request's
    // response has arrived — this is the load(A) -> write -> refetch(B)
    // sequence from the finding.
    act(() => { result.current.refetch(); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // Newer request (B) resolves first.
    act(() => { resolveSecond(fakeResponse([{ id: "fresh" }])); });
    await waitFor(() => expect(result.current.canyons).toEqual([{ id: "fresh" }]));

    // Older request (A) resolves after — must NOT overwrite the fresh state.
    await act(async () => {
      resolveFirst(fakeResponse([{ id: "stale" }]));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.canyons).toEqual([{ id: "fresh" }]);
  });
});
