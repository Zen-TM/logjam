import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { clearTrackTexts } from "./trackGeo";
import { useTrackFileDetail } from "./useTrackFileDetail";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearTrackTexts();
});

describe("useTrackFileDetail", () => {
  // Mutation: console.error the parse failure in the hook's catch.
  it("reports an unreadable file in its own sentence and logs nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"type": -33.71, 150.31')),
    );
    const logged = (["log", "info", "warn", "error", "debug"] as const).map(
      (level) => vi.spyOn(console, level).mockImplementation(() => {}),
    );

    const { result } = renderHook(() =>
      useTrackFileDetail({
        mediaId: "m1",
        filename: "Secret Creek.geojson",
        displayUrl: () => "https://s3.example/Secret%20Creek.geojson",
      }),
    );

    await waitFor(() =>
      expect(result.current.error).toBe("Couldn't read that file."),
    );
    for (const spy of logged) expect(spy).not.toHaveBeenCalled();
  });
});
