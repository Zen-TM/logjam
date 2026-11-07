import { describe, expect, it, vi } from "vitest";

import { basemapToShow, serverAnswers } from "@logjam/shared";

import { defaultBasemap } from "./basemapMeta";
import type { BasemapId } from "./sourceResolver";
import {
  basemapFallbackFor,
  probedBasemaps,
  useDownBasemaps,
} from "./basemapReachability";

vi.mock("@logjam/shared", async (original) => ({
  ...(await original<typeof import("@logjam/shared")>()),
  serverAnswers: vi.fn(),
}));

// Just enough React to run the hook once and see what it hands setState.
const setState = vi.fn();
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (init: () => unknown) => [init(), setState],
  useRef: (current: unknown) => ({ current }),
  useCallback: (fn: unknown) => fn,
  useEffect: () => {},
}));

const NSW = ["nsw"];
const DEFAULT_BASEMAP = defaultBasemap(NSW);
const PROBED_BASEMAPS = probedBasemaps(NSW);

const settle = () => new Promise((resolve) => setTimeout(resolve));

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
      basemapFallbackFor(DEFAULT_BASEMAP, down, NSW),
    );
    expect(shown).not.toBe(DEFAULT_BASEMAP);
    expect(down.has(shown as never)).toBe(false);
    expect(
      basemapToShow(
        DEFAULT_BASEMAP,
        new Set(),
        basemapFallbackFor(DEFAULT_BASEMAP, new Set(), NSW),
      ),
    ).toBe(DEFAULT_BASEMAP);
  });

  // Mutation: ignore `down` in basemapFallbackFor, and a SIX outage maps the
  // imagery pick to the also-down topo, which is drawn blank.
  it("falls to the drawn basemap when the default is down too", () => {
    const down = new Set<BasemapId>([DEFAULT_BASEMAP, "six-imagery"]);
    expect(basemapFallbackFor("six-imagery", down, NSW)).toBe("protomaps");
    expect(
      basemapToShow(
        "six-imagery",
        down,
        basemapFallbackFor("six-imagery", down, NSW),
      ),
    ).toBe("protomaps");
  });
});

describe("probing the basemaps when the Layers sheet opens", () => {
  // Mutation: call setDown for every answer again (drop the `next ===
  // verdict.current` check) and each open re-renders MapScreen once per
  // server, in the frames the sheet is sliding up.
  it("sets state only when a server's verdict changes", async () => {
    const answers = vi.mocked(serverAnswers);
    const { probe } = useDownBasemaps(true, NSW);

    answers.mockResolvedValue(true);
    probe();
    probe();
    await settle();
    expect(setState).not.toHaveBeenCalled();

    answers.mockResolvedValue(false);
    probe();
    await settle();
    expect(setState).toHaveBeenCalledTimes(PROBED_BASEMAPS.length);

    probe();
    await settle();
    expect(setState).toHaveBeenCalledTimes(PROBED_BASEMAPS.length);
  });
});
