import { describe, expect, it } from "vitest";

import { basemapToShow } from "@logjam/shared";

import { DEFAULT_BASEMAP } from "./basemapMeta";
import type { BasemapId } from "./sourceResolver";
import { basemapFallbackFor, PROBED_BASEMAPS } from "./basemapReachability";

describe("the probed basemaps", () => {
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
      basemapFallbackFor(DEFAULT_BASEMAP, down),
    );
    expect(shown).not.toBe(DEFAULT_BASEMAP);
    expect(down.has(shown as never)).toBe(false);
    expect(
      basemapToShow(
        DEFAULT_BASEMAP,
        new Set(),
        basemapFallbackFor(DEFAULT_BASEMAP, new Set()),
      ),
    ).toBe(DEFAULT_BASEMAP);
  });

  // Mutation: ignore `down` in basemapFallbackFor, and a SIX outage maps the
  // imagery pick to the also-down topo, which is drawn blank.
  it("falls to the drawn basemap when the default is down too", () => {
    const down = new Set<BasemapId>([DEFAULT_BASEMAP, "six-imagery"]);
    expect(basemapFallbackFor("six-imagery", down)).toBe("protomaps");
    expect(
      basemapToShow(
        "six-imagery",
        down,
        basemapFallbackFor("six-imagery", down),
      ),
    ).toBe("protomaps");
  });
});
