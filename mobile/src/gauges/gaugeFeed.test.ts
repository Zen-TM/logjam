// Mutations that turn it red: add a header or a query to the fetch; drop the
// parse (a bad file replaces a good one); fetch while offline-only; drop the
// five-minute debounce; keep the throttle across a wipe (`lastOkEpoch`).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GAUGE_LATEST_PATH, gaugeHistoryUrl } from "@logjam/shared";

import {
  refreshGauges,
  refreshGaugeHistories,
  resetGaugeFeed,
} from "./gaugeFeed";
import { gaugeFixture } from "./gaugeFixture";

const h = vi.hoisted(() => ({
  fetch: vi.fn(),
  cache: vi.fn(async () => {}),
  cacheHistory: vi.fn(async (..._args: unknown[]) => {}),
  kept: null as { ageMs: number } | null,
  offlineOnly: false,
  canRun: true,
  epoch: 0,
}));
vi.mock("../config", () => ({
  config: { topoCdnBaseUrl: "https://cdn.example" },
}));
vi.mock("../offline/offlineOnlyMode", () => ({
  isOfflineOnly: () => h.offlineOnly,
}));
vi.mock("../offline/networkPolicy", () => ({
  canRunNow: async () => h.canRun,
}));
vi.mock("./gaugeStorage", () => ({
  cacheGauges: h.cache,
  cacheGaugeHistory: h.cacheHistory,
  readCachedGaugeHistory: async () => h.kept,
  gaugesEpoch: () => h.epoch,
}));

const answer = (body: string, ok = true) =>
  h.fetch.mockResolvedValue({ ok, text: async () => body });

beforeEach(() => {
  resetGaugeFeed();
  h.fetch.mockReset();
  h.cache.mockClear();
  h.cacheHistory.mockClear();
  h.kept = null;
  h.offlineOnly = false;
  h.canRun = true;
  h.epoch = 0;
  vi.stubGlobal("fetch", h.fetch);
});

describe("refreshGauges", () => {
  it("asks the CDN for the public file with nothing else sent", async () => {
    answer(JSON.stringify(gaugeFixture));
    expect(await refreshGauges()).toEqual(gaugeFixture);
    expect(h.fetch.mock.calls).toEqual([
      [
        `https://cdn.example/${GAUGE_LATEST_PATH}`,
        { signal: expect.any(AbortSignal) },
      ],
    ]);
  });

  it("keeps the old file when the download is malformed or fails", async () => {
    answer('{"version":1}');
    expect(await refreshGauges()).toBeNull();
    answer("", false);
    expect(await refreshGauges()).toBeNull();
    h.fetch.mockRejectedValue(new Error("offline"));
    expect(await refreshGauges()).toBeNull();
    expect(h.cache).not.toHaveBeenCalled();
  });

  it("sends nothing in offline-only mode or without a usable connection", async () => {
    h.offlineOnly = true;
    expect(await refreshGauges()).toBeNull();
    h.offlineOnly = false;
    h.canRun = false;
    expect(await refreshGauges()).toBeNull();
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("fetches at most once in five minutes", async () => {
    answer(JSON.stringify(gaugeFixture));
    await refreshGauges();
    expect(await refreshGauges()).toBeNull();
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it("fetches again after a wipe, though five minutes have not passed", async () => {
    answer(JSON.stringify(gaugeFixture));
    await refreshGauges();
    h.epoch = 1;
    expect(await refreshGauges()).toEqual(gaugeFixture);
    expect(h.fetch).toHaveBeenCalledTimes(2);
  });
});

// Mutations that turn it red: fetch a gauge whose file is under a day old;
// cache before parsing (a bad file replaces a good one); fetch two gauges at
// once; drop the five-minute debounce (a 404 is asked again at every screen);
// fetch with no id (a place with no gauge); ignore offline-only mode.
describe("refreshGaugeHistories", () => {
  const history = JSON.stringify({
    version: 1,
    id: "900001",
    start: "2026-10-01",
    level: [0.9],
    flow: [1],
  });
  const url = (id: string) => gaugeHistoryUrl("https://cdn.example", id);

  it("fetches a missing file, one gauge at a time, from the CDN with nothing else sent", async () => {
    let open = 0;
    let most = 0;
    h.fetch.mockImplementation(async () => {
      most = Math.max(most, ++open);
      await Promise.resolve();
      open -= 1;
      return { ok: true, text: async () => history };
    });
    await refreshGaugeHistories(["900001", "900002", "900001"]);
    expect(h.fetch.mock.calls).toEqual([
      [url("900001"), { signal: expect.any(AbortSignal) }],
      [url("900002"), { signal: expect.any(AbortSignal) }],
    ]);
    expect(most).toBe(1);
    expect(h.cacheHistory).toHaveBeenCalledTimes(2);
  });

  it("fetches nothing for no gauge, a fresh file, offline-only or no connection", async () => {
    await refreshGaugeHistories([]);
    h.kept = { ageMs: 3_600_000 };
    await refreshGaugeHistories(["900001"]);
    h.kept = null;
    h.offlineOnly = true;
    await refreshGaugeHistories(["900001"]);
    h.offlineOnly = false;
    h.canRun = false;
    await refreshGaugeHistories(["900001"]);
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("refreshes a file older than a day", async () => {
    answer(history);
    h.kept = { ageMs: 2 * 86_400_000 };
    await refreshGaugeHistories(["900001"]);
    expect(h.cacheHistory).toHaveBeenCalledTimes(1);
  });

  it("keeps the good file when the download is malformed, missing or fails", async () => {
    h.kept = { ageMs: 2 * 86_400_000 };
    answer('{"version":1}');
    await refreshGaugeHistories(["900001"]);
    answer("", false);
    await refreshGaugeHistories(["900002"]);
    h.fetch.mockRejectedValue(new Error("offline"));
    await refreshGaugeHistories(["900003"]);
    expect(h.cacheHistory).not.toHaveBeenCalled();
  });

  it("does not ask again within five minutes, not even after a 404", async () => {
    answer("", false);
    await refreshGaugeHistories(["900001"]);
    await refreshGaugeHistories(["900001"]);
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  // Mutation: read the epoch inside the loop, not when the call starts.
  it("stops for good when a wipe lands mid-refresh", async () => {
    h.fetch.mockImplementation(async () => {
      h.epoch = 1;
      return { ok: true, text: async () => history };
    });
    await refreshGaugeHistories(["900001", "900002"]);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    // The write of the fetch in flight carries the epoch it began under, so
    // the store drops it. Mutation: remove that argument → red.
    expect(h.cacheHistory.mock.calls[0]?.[2]).toBe(0);
  });
});
