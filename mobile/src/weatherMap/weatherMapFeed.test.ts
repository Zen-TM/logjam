// Mutations that turn it red: add a header or a query to a fetch; drop the
// parse (a manifest this build can't draw is drawn); fetch while offline-only;
// log a failure (its URL would reach the log); ask the "sync" setting when the
// caller passed the user's own answer for mobile data.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchWeatherManifest, fetchWeatherWind } from "./weatherMapFeed";
import { weatherFixture } from "./weatherMapFixture";

const wind = {
  west: 139,
  north: -26,
  step: 0.5,
  columns: 2,
  rows: 1,
  steps: [{ speed: [10, 20], from: [90, 180] }],
};

const h = vi.hoisted(() => ({
  fetch: vi.fn(),
  offlineOnly: false,
  canRun: true,
  canRunArgs: [] as unknown[][],
}));
vi.mock("../config", () => ({
  config: { topoCdnBaseUrl: "https://cdn.example" },
}));
vi.mock("../offline/offlineOnlyMode", () => ({
  isOfflineOnly: () => h.offlineOnly,
}));
vi.mock("../offline/networkPolicy", () => ({
  canRunNow: async (...args: unknown[]) => {
    h.canRunArgs.push(args);
    return h.canRun;
  },
}));

const answer = (body: string, ok = true) =>
  h.fetch.mockResolvedValue({ ok, text: async () => body });

beforeEach(() => {
  h.fetch.mockReset();
  h.offlineOnly = false;
  h.canRun = true;
  h.canRunArgs = [];
  vi.stubGlobal("fetch", h.fetch);
});

describe("fetchWeatherManifest", () => {
  it("asks the CDN for the public file with nothing else sent", async () => {
    const text = JSON.stringify(weatherFixture);
    answer(text);
    expect(await fetchWeatherManifest()).toEqual({
      file: weatherFixture,
      text,
    });
    expect(h.fetch.mock.calls).toEqual([
      [
        "https://cdn.example/master/weather/v1/latest.json",
        { signal: expect.any(AbortSignal) },
      ],
    ]);
  });

  it("gives nothing for a failure or a file this build can't draw", async () => {
    answer("", false);
    expect(await fetchWeatherManifest()).toBeNull();
    answer('{"format":2}');
    expect(await fetchWeatherManifest()).toBeNull();
    answer("not json");
    expect(await fetchWeatherManifest()).toBeNull();
    h.fetch.mockRejectedValue(new Error("offline"));
    expect(await fetchWeatherManifest()).toBeNull();
  });

  it("asks for nothing offline-only or on a connection the user ruled out", async () => {
    answer(JSON.stringify(weatherFixture));
    h.offlineOnly = true;
    expect(await fetchWeatherManifest()).toBeNull();
    h.offlineOnly = false;
    h.canRun = false;
    expect(await fetchWeatherManifest()).toBeNull();
    expect(h.fetch).not.toHaveBeenCalled();
  });
});

describe("the save's answer for mobile data", () => {
  // Mutation: ignore `allowMetered`, and a save the user allowed on mobile data
  // keeps no weather when "sync" is Wi-Fi only.
  it("stands in for the sync setting when given, and defers to it when not", async () => {
    answer(JSON.stringify(weatherFixture));
    await fetchWeatherManifest(true);
    await fetchWeatherManifest();
    expect(h.canRunArgs).toEqual([
      ["sync", true],
      ["sync", undefined],
    ]);
  });
});

describe("a failure", () => {
  // Mutation: log the failure (`console.error(url, err)` in a catch), and a
  // URL, or a place the user looks at, reaches the log.
  it("is a state, never a log line", async () => {
    const logs = (["log", "warn", "error", "info", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    h.fetch.mockRejectedValue(new Error("https://cdn.example/secret"));
    await fetchWeatherManifest();
    await fetchWeatherWind(weatherFixture);
    answer("not json");
    await fetchWeatherManifest();
    await fetchWeatherWind(weatherFixture);
    for (const log of logs) expect(log).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe("fetchWeatherWind", () => {
  it("reads the run's own wind file, with nothing else sent", async () => {
    answer(JSON.stringify(wind));
    expect(await fetchWeatherWind(weatherFixture)).toEqual(wind);
    expect(h.fetch.mock.calls[0]).toEqual([
      "https://cdn.example/master/weather/v1/runs/20261107T0000Z-20261107T0900Z/wind.json",
      { signal: expect.any(AbortSignal) },
    ]);
  });

  // Mutation: return the body unchecked, and arrows are cut from a file that
  // is not a wind file.
  it("gives nothing for a file that is not a wind file", async () => {
    answer('{"steps":7}');
    expect(await fetchWeatherWind(weatherFixture)).toBeNull();
  });
});
