import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { usePlaces, isPlaceDoneByViewer } from "./placeUtils";
import type { TPlace } from "./placeUtils";

// The map paints a place green iff `_count.tripLogLinks > 0`
// (isPlaceDoneByViewer), and that tally is computed server-side on the owned
// place list — nothing in the client maintains it. So "the marker turns green
// the moment a trip is logged" reduces to one property of usePlaces: refetch
// re-pulls the list and the fresh count reaches consumers. App.tsx's
// refetchAfterTripWrite rides on exactly that. If a future refactor makes
// refetch a no-op (a stale-data cache, a memo on the fetched array), the marker
// silently goes back to only updating on the next unrelated refresh — this test
// fails instead.

function placePayload(tripLogLinks: number) {
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
  return new Response(JSON.stringify(placePayload(tripLogLinks)), {
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

describe("usePlaces refetch — the map's completed-marker refresh path", () => {
  it("re-pulls the owner's trip tally, flipping a place to done", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respondWith(0)) // before the trip is logged
      .mockResolvedValueOnce(respondWith(1)); // after
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => usePlaces(true));

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(isPlaceDoneByViewer(result.current.places[0] as TPlace, true)).toBe(
      false,
    );

    act(() => result.current.refetch());

    await waitFor(() =>
      expect(
        isPlaceDoneByViewer(result.current.places[0] as TPlace, true),
      ).toBe(true),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("still withholds done from a place shared with the viewer", async () => {
    // The refresh must not widen what `_count` is read for: on a shared place
    // the tally is the OWNER's, and a refetch that made it render as done would
    // leak how often that friend runs it.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respondWith(3)));

    const { result } = renderHook(() => usePlaces(true));

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(
      isPlaceDoneByViewer(result.current.places[0] as TPlace, false),
    ).toBe(false);
  });
});
