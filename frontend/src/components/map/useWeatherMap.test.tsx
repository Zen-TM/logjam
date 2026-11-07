import { act, cleanup, renderHook } from "@testing-library/react";
import { WEATHER_MAP } from "@logjam/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWeatherMap } from "./useWeatherMap";

const NOW = Date.parse("2026-11-07T09:30:00Z");
const hour = 3_600_000;
const manifest = {
  format: 1,
  model: "ecmwf_ifs",
  run: "2026-11-07T00:00Z",
  built: "2026-11-07T09:07Z",
  anchor: "2026-11-07T09:00Z",
  path: "runs/20261107T0000Z-20261107T0900Z/",
  bounds: [139, -39.5, 156, -26],
  zoom: 5,
  steps: [0, 1, 2].map((i) => ({
    time: new Date(Date.parse("2026-11-07T09:00:00Z") + i * hour).toISOString(),
    hours: 1,
  })),
  totals: [],
  attribution: WEATHER_MAP.credit,
};
const wind = {
  west: 150,
  north: -30,
  step: 1,
  columns: 2,
  rows: 1,
  steps: [0, 1, 2].map(() => ({ speed: [10, 20], from: [0, 90] })),
};

let asked: string[];
let respond: (url: string) => unknown;
beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "Date",
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
    ],
    now: NOW,
  });
  asked = [];
  respond = (url) => (url.endsWith("latest.json") ? manifest : wind);
  vi.stubGlobal("fetch", async (input: string) => {
    asked.push(input);
    const body = respond(input);
    return body === null
      ? { ok: false, json: async () => ({}) }
      : { ok: true, json: async () => body };
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));

describe("useWeatherMap", () => {
  // Mutation: fetch on mount whatever `on` says, and every map load asks for
  // a forecast nobody switched on.
  it("asks for nothing while Weather is off", async () => {
    const { result } = renderHook(() => useWeatherMap(false, "rain"));
    await flush();
    expect(asked).toEqual([]);
    expect(result.current.state.status).toBe("loading");
  });

  // Mutation: keep polling, and a left-open tab asks every minute.
  it("fetches the manifest from our own origin once on turn-on, never again by itself", async () => {
    const { result } = renderHook(() => useWeatherMap(true, "rain"));
    expect(result.current.state.status).toBe("loading");
    await flush();
    expect(asked).toEqual([
      `${window.location.origin}/master/weather/v1/latest.json`,
    ]);
    expect(result.current.state.status).toBe("ready");
    await act(() => vi.advanceTimersByTimeAsync(2 * hour));
    expect(asked).toHaveLength(1);
  });

  // Mutation: refetch on every turn-on, or never: a day-old run is shown, or
  // each toggle costs a request.
  it("asks again on a turn-on only when what it holds is over an hour old", async () => {
    const { rerender } = renderHook(({ on }) => useWeatherMap(on, "rain"), {
      initialProps: { on: true },
    });
    await flush();
    rerender({ on: false });
    rerender({ on: true });
    await flush();
    expect(asked).toHaveLength(1);
    rerender({ on: false });
    await act(() => vi.advanceTimersByTimeAsync(61 * 60_000));
    rerender({ on: true });
    await flush();
    expect(asked).toHaveLength(2);
  });

  // Mutation: treat a manifest of another format as ready, and the map draws
  // files it can't read.
  it("reads a manifest it can't draw as failed, and Try again asks anew", async () => {
    respond = () => ({ ...manifest, format: 2 });
    const { result } = renderHook(() => useWeatherMap(true, "rain"));
    await flush();
    expect(result.current.state.status).toBe("failed");
    respond = (url) => (url.endsWith("latest.json") ? manifest : wind);
    act(() => result.current.retry());
    await flush();
    expect(result.current.state.status).toBe("ready");
    expect(asked).toHaveLength(2);
  });

  it("reads a missing manifest as failed", async () => {
    respond = () => null;
    const { result } = renderHook(() => useWeatherMap(true, "rain"));
    await flush();
    expect(result.current.state.status).toBe("failed");
  });

  // Mutation: fetch wind.json for Rain, or once per step, and every user pays
  // for arrows the layer doesn't draw.
  it("fetches the wind file once, only for a layer that draws arrows", async () => {
    const { result, rerender } = renderHook(
      ({ layer }) => useWeatherMap(true, layer),
      { initialProps: { layer: "rain" as "rain" | "wind" | "gusts" } },
    );
    await flush();
    expect(result.current.arrows).toBeNull();
    expect(asked.some((u) => u.endsWith("wind.json"))).toBe(false);
    rerender({ layer: "wind" });
    await flush();
    rerender({ layer: "gusts" });
    await flush();
    expect(asked.filter((u) => u.endsWith("wind.json"))).toHaveLength(1);
    expect(result.current.arrows?.features).toHaveLength(2);
  });

  // Mutation: draw the step the bar is on, not the one it rested on, and a
  // drag across the week asks the map for an archive per notch.
  it("draws the step the bar settled on", async () => {
    const { result } = renderHook(() => useWeatherMap(true, "rain"));
    await flush();
    const url = (n: number) =>
      `${window.location.origin}/master/weather/v1/${manifest.path}rain/00${n}.pmtiles`;
    expect(result.current.drawnUrl).toBe(url(1));
    act(() => result.current.settle({ path: manifest.path, step: 2 }));
    expect(result.current.drawnUrl).toBe(url(2));
    act(() => result.current.settle({ path: "runs/other/", step: 2 }));
    expect(result.current.drawnUrl).toBe(url(1));
  });

  // Mutation: skip the visibilitychange listener, and a tab left on Weather
  // overnight keeps asking for the pruned run's files.
  it("asks again when the tab returns to the front over an hour on, not before", async () => {
    renderHook(() => useWeatherMap(true, "rain"));
    await flush();
    const show = () => document.dispatchEvent(new Event("visibilitychange"));
    await act(() =>
      vi.advanceTimersByTimeAsync(WEATHER_MAP.refreshAfterMs - 1000),
    );
    show();
    await flush();
    expect(asked).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    show();
    await flush();
    expect(asked).toHaveLength(2);
  });

  describe("an archive the manifest names is gone", () => {
    const fresh = {
      ...manifest,
      run: "2026-11-07T06:00Z",
      path: "runs/20261107T0600Z-20261107T0900Z/",
    };
    // Mutation: blacklist instead of refetching (do nothing here), and the
    // overlay stays on a pruned run until it is toggled.
    it("drops the manifest, asks for the current one once and draws its run", async () => {
      const { result } = renderHook(() => useWeatherMap(true, "rain"));
      await flush();
      respond = (url) => (url.endsWith("latest.json") ? fresh : wind);
      // A tile burst reports it more than once.
      act(() => {
        result.current.archiveGone();
        result.current.archiveGone();
      });
      expect(result.current.drawnUrl).toBeNull();
      await flush();
      expect(asked.filter((u) => u.endsWith("latest.json"))).toHaveLength(2);
      expect(result.current.drawnUrl).toContain(fresh.path);
    });

    // Mutation: refetch every time, and a run whose archive really is gone
    // loops manifest, archive, manifest, ...
    it("is failed when the current run's archive is gone too, and Try again asks anew", async () => {
      const { result } = renderHook(() => useWeatherMap(true, "rain"));
      await flush();
      act(() => result.current.archiveGone());
      await flush();
      expect(result.current.state.status).toBe("ready");
      act(() => result.current.archiveGone());
      expect(result.current.state.status).toBe("failed");
      expect(asked.filter((u) => u.endsWith("latest.json"))).toHaveLength(2);
      act(() => result.current.retry());
      await flush();
      expect(result.current.state.status).toBe("ready");
      expect(asked.filter((u) => u.endsWith("latest.json"))).toHaveLength(3);
    });

    // Mutation: never forget a run whose archive went missing once, and a
    // passing 404 long ago makes the next one fail the overlay at once.
    it("asks again for a run whose archive went missing over an hour ago", async () => {
      const { result } = renderHook(() => useWeatherMap(true, "rain"));
      await flush();
      act(() => result.current.archiveGone());
      await flush();
      const later = Date.now() + WEATHER_MAP.refreshAfterMs + 1;
      const clock = vi.spyOn(Date, "now").mockReturnValue(later);
      act(() => result.current.archiveGone());
      await flush();
      clock.mockRestore();
      expect(result.current.state.status).toBe("ready");
      expect(asked.filter((u) => u.endsWith("latest.json"))).toHaveLength(3);
    });

    // Mutation: keep the old manifest when the refetch fails, and the bar says
    // ready over nothing.
    it("is failed when the manifest cannot be fetched again", async () => {
      const { result } = renderHook(() => useWeatherMap(true, "rain"));
      await flush();
      respond = () => null;
      act(() => result.current.archiveGone());
      await flush();
      expect(result.current.state.status).toBe("failed");
    });
  });

  // Mutation: draw arrows when wind.json is malformed, and a bad file throws
  // in the layer code.
  it("draws no arrows from a wind file it can't read", async () => {
    respond = (url) => (url.endsWith("latest.json") ? manifest : { nope: 1 });
    const { result } = renderHook(() => useWeatherMap(true, "wind"));
    await flush();
    expect(asked.some((u) => u.endsWith("wind.json"))).toBe(true);
    await flush();
    expect(result.current.arrows).toBeNull();
    expect(result.current.state.status).toBe("ready");
  });
});
