// Mutations that turn it red: add a header or a query to the fetch; drop the
// parse (a bad file replaces a good one); fetch while offline-only; drop the
// five-minute debounce.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GAUGE_LATEST_PATH } from "@logjam/shared";

import { refreshGauges, resetGaugeFeed } from "./gaugeFeed";
import { gaugeFixture } from "./gaugeFixture";

const h = vi.hoisted(() => ({
  fetch: vi.fn(),
  cache: vi.fn(async () => {}),
  offlineOnly: false,
  canRun: true,
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
  gaugesEpoch: () => 0,
}));

const answer = (body: string, ok = true) =>
  h.fetch.mockResolvedValue({ ok, text: async () => body });

beforeEach(() => {
  resetGaugeFeed();
  h.fetch.mockReset();
  h.cache.mockClear();
  h.offlineOnly = false;
  h.canRun = true;
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
});
