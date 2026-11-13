// The catchment lookup behind "What is here?": a failure reads as no answer,
// so the panel shows a catchment or nothing (MapPointPopover.test.tsx).
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFlowNetworkLookup } from "./placeUtils";

vi.mock("./auth/oidc", () => ({ loadSession: vi.fn() }));

const point = { longitude: 150.3, latitude: -33.6 };
const found = {
  status: "found",
  snapped: point,
  distanceM: 4,
  catchmentKm2: 4.2,
  streamOrder: 3,
  attribution: "credit",
};

function answer(reply: () => Promise<Response>) {
  // Fake auth, as `make dev` has it: CI has no session to load.
  vi.stubEnv("VITE_AUTH_MODE", "fake");
  const fetch = vi.fn(reply);
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("useFlowNetworkLookup", () => {
  it("asks once, with the point in the body, and gives the answer", async () => {
    const fetch = answer(async () => Response.json(found));
    const { result } = renderHook(() => useFlowNetworkLookup(point));
    expect(result.current).toEqual({ lookup: null, loading: true });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.lookup).toEqual(found);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain("150.3");
    expect(JSON.parse(String(init.body))).toEqual(point);
  });

  // Mutation: keep the API's error as an answer, and the panel has a
  // sentence to show where it should show nothing.
  it.each([
    [
      "a 503 while the layer is unavailable",
      async () =>
        Response.json(
          { error: "Catchment sizes aren't available right now." },
          { status: 503 },
        ),
    ],
    [
      "no connection",
      async (): Promise<Response> => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("settles on no answer after %s", async (_, reply) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    answer(reply);
    const { result } = renderHook(() => useFlowNetworkLookup(point));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toEqual({ lookup: null, loading: false });
  });
});
