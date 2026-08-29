import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useCanyons, isCanyonDoneByViewer } from "./canyonUtils";
import type { TCanyon } from "./canyonUtils";

// The map paints a canyon green iff `_count.tripLogLinks > 0`
// (isCanyonDoneByViewer), and that tally is computed server-side on the owned
// canyon list — nothing in the client maintains it. So "the marker turns green
// the moment a trip is logged" reduces to one property of useCanyons: refetch
// re-pulls the list and the fresh count reaches consumers. App.tsx's
// refetchAfterTripWrite rides on exactly that. If a future refactor makes
// refetch a no-op (a stale-data cache, a memo on the fetched array), the marker
// silently goes back to only updating on the next unrelated refresh — this test
// fails instead.

function canyonPayload(tripLogLinks: number) {
  return [
    {
      id: "c1",
      name: "Empress Canyon",
      latitude: -33.5,
      longitude: 150.3,
      _count: { tripLogLinks, shares: 0 },
    },
  ];
}

function respondWith(tripLogLinks: number) {
  return new Response(JSON.stringify(canyonPayload(tripLogLinks)), {
    status: 200,
    headers: { "X-Total-Count": "1" },
  });
}

beforeEach(() => {
  // Skips Amplify entirely in getIdToken — same branch local dev uses.
  vi.stubEnv("VITE_AUTH_MODE", "fake");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("useCanyons refetch — the map's completed-marker refresh path", () => {
  it("re-pulls the owner's trip tally, flipping a canyon to done", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respondWith(0)) // before the trip is logged
      .mockResolvedValueOnce(respondWith(1)); // after
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useCanyons(true));

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(isCanyonDoneByViewer(result.current.canyons[0] as TCanyon, true)).toBe(
      false,
    );

    act(() => result.current.refetch());

    await waitFor(() =>
      expect(
        isCanyonDoneByViewer(result.current.canyons[0] as TCanyon, true),
      ).toBe(true),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("still withholds done from a canyon shared with the viewer", async () => {
    // The refresh must not widen what `_count` is read for: on a shared canyon
    // the tally is the OWNER's, and a refetch that made it render as done would
    // leak how often that friend runs it.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respondWith(3)));

    const { result } = renderHook(() => useCanyons(true));

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(
      isCanyonDoneByViewer(result.current.canyons[0] as TCanyon, false),
    ).toBe(false);
  });
});
