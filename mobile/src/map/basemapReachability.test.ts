import { afterEach, describe, expect, it, vi } from "vitest";

import { basemapToShow } from "@logjam/shared";

import { DEFAULT_BASEMAP } from "./basemapMeta";
import {
  basemapFallbackFor,
  PROBED_BASEMAPS,
  serverAnswers,
} from "./basemapReachability";

afterEach(() => vi.unstubAllGlobals());

describe("serverAnswers", () => {
  // Mutation: treat any non-2xx as down, and a provider that refuses an
  // unattributed client (403) or HEAD (405) is shown as an outage.
  it("a refusal is an answer; a 5xx or no connection is not", async () => {
    for (const [status, answers] of [
      [200, true],
      [403, true],
      [405, true],
      [503, false],
    ] as const) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status }));
      expect(await serverAnswers("https://x.example/t.png")).toBe(answers);
    }
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("net")));
    expect(await serverAnswers("https://x.example/t.png")).toBe(false);
  });

  // Mutation: probe the drawn basemap, and an unreachable CDN marks the
  // default down on a phone that has the region saved.
  it("probes the fetched basemaps, not the drawn one", () => {
    expect(PROBED_BASEMAPS).not.toContain("protomaps");
    expect(PROBED_BASEMAPS).toContain("six-topo");
  });
});

describe("the basemap shown while a server is down", () => {
  // Mutation: make basemapFallbackFor return the pick itself, and a down pick
  // is drawn anyway (a blank map).
  it("stands in a basemap that is up, and keeps the pick otherwise", () => {
    const down = new Set([DEFAULT_BASEMAP]);
    const shown = basemapToShow(
      DEFAULT_BASEMAP,
      down,
      basemapFallbackFor(DEFAULT_BASEMAP),
    );
    expect(shown).not.toBe(DEFAULT_BASEMAP);
    expect(down.has(shown as never)).toBe(false);
    expect(
      basemapToShow(
        DEFAULT_BASEMAP,
        new Set(),
        basemapFallbackFor(DEFAULT_BASEMAP),
      ),
    ).toBe(DEFAULT_BASEMAP);
  });
});
