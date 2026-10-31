// A profile reads the sharpened areas the caller can see, so an answer asked
// for before the user or their areas changed must not be cached for after.
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cachedProfile,
  clearProfileCache,
  scopeProfileCache,
} from "./elevationCache";
import { useElevationProfile, type ProfiledLine } from "./placeUtils";

vi.mock("./auth/oidc", () => ({
  loadSession: vi.fn().mockResolvedValue({ id_token: "test-token" }),
}));

const response = (body: unknown) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => body,
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearProfileCache();
});

describe("useElevationProfile and a change of scope", () => {
  // Mutation: read the cache generation when the answer arrives instead of
  // when the request went out, and a profile read through a revoked area, or
  // for the last user on the tab, is cached for whoever asks next.
  it("does not cache an answer asked for before the scope changed", async () => {
    let arrive!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValueOnce(new Promise((r) => (arrive = r))),
    );
    const line: ProfiledLine = [
      [150.3, -33.7],
      [150.31, -33.71],
    ];
    scopeProfileCache("true,area-1");
    const { result } = renderHook(() => useElevationProfile(line));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1));

    scopeProfileCache("true");
    await act(async () =>
      arrive(
        response({
          samples: [{ distanceM: 0, elevationM: 900 }],
          gainM: 0,
          lossM: 0,
          minM: 900,
          maxM: 900,
          attribution: "Elevation: a survey.",
        }),
      ),
    );
    await waitFor(() => expect(result.current.profile).not.toBeNull());
    expect(cachedProfile(JSON.stringify(line))).toBeNull();
  });
});
