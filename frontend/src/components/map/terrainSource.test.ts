import { describe, expect, it, vi } from "vitest";

import {
  NSW_TERRAIN_SOURCE,
  WORLDWIDE_TERRAIN_SOURCE,
  applyTerrain,
  dropStaleTerrainSources,
  terrainSourceFor,
} from "./terrainSource";
import { NSW_5M, type SharpenedOverlay } from "@logjam/shared";

function fakeMap(lng: number, lat: number) {
  const sources = new Map<string, unknown>();
  return {
    getCenter: () => ({
      wrap: () => ({ lng: ((((lng + 180) % 360) + 360) % 360) - 180, lat }),
    }),
    getSource: (id: string) => sources.get(id),
    addSource: vi.fn((id: string, source: unknown) => {
      // As MapLibre does.
      if (sources.has(id)) throw new Error(`Source "${id}" already exists.`);
      sources.set(id, source);
    }),
  } as unknown as Parameters<typeof terrainSourceFor>[0] & {
    addSource: ReturnType<typeof vi.fn>;
  };
}

const KATOOMBA = [150.31, -33.71] as const;
const opens = async () => {};

const area: SharpenedOverlay = {
  id: "a1",
  zmax: 16,
  tiles15: [30100, 19654, 30103, 19657],
  coverage: [150.7, -33.8, 150.72, -33.78],
  contours: false,
  credit: "Elevation: a made-up survey.",
  createdAt: "2026-10-24T00:00:00.000Z",
  heightsUrl: "https://bucket.test/h?sig",
  slopeUrl: "https://bucket.test/s?sig",
  contoursUrl: null,
};

describe("terrainSourceFor", () => {
  it("uses the NSW archive over NSW, and adds its source once", async () => {
    const map = fakeMap(...KATOOMBA);
    const open = vi.fn(opens);
    expect(await terrainSourceFor(map, [], open, "https://web.test")).toBe(
      NSW_TERRAIN_SOURCE,
    );
    expect(await terrainSourceFor(map, [], open, "https://web.test")).toBe(
      NSW_TERRAIN_SOURCE,
    );
    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.addSource.mock.calls[0]![1]).toMatchObject({
      url: "pmtiles://https://web.test/master/dem/nsw-5m.pmtiles",
      encoding: "terrarium",
    });
  });

  // Mutation: add the NSW source without opening the archive first and, until
  // the statewide archive is uploaded, 3D terrain over NSW is flat.
  it("falls back to the worldwide tiles when the archive will not open", async () => {
    const map = fakeMap(...KATOOMBA);
    const source = await terrainSourceFor(
      map,
      [],
      async () => {
        throw new Error("404");
      },
      "https://web.test",
    );
    expect(source).toBe(WORLDWIDE_TERRAIN_SOURCE);
    expect(map.addSource).not.toHaveBeenCalled();
  });

  it("uses the worldwide tiles outside NSW without asking for the archive", async () => {
    const open = vi.fn(opens);
    expect(
      await terrainSourceFor(
        fakeMap(115.86, -31.95),
        [],
        open,
        "https://web.test",
      ),
    ).toBe(WORLDWIDE_TERRAIN_SOURCE);
    expect(open).not.toHaveBeenCalled();
  });

  // Mutation: read the centre unwrapped and a map panned once around the
  // world draws NSW from the worldwide tiles.
  it("uses the NSW archive over NSW after a pan around the world", async () => {
    const map = fakeMap(KATOOMBA[0] + 360, KATOOMBA[1]);
    expect(
      await terrainSourceFor(map, [], vi.fn(opens), "https://web.test"),
    ).toBe(NSW_TERRAIN_SOURCE);
  });

  // Mutation: drop the second look for the source, and two calls that wait on
  // the same open both add it: MapLibre throws on the second.
  it("adds the source once when two calls wait on the archive together", async () => {
    const map = fakeMap(...KATOOMBA);
    const slow = () => new Promise<void>((resolve) => setTimeout(resolve, 5));
    await expect(
      Promise.all([
        terrainSourceFor(map, [], slow, "https://web.test"),
        terrainSourceFor(map, [], slow, "https://web.test"),
      ]),
    ).resolves.toEqual([NSW_TERRAIN_SOURCE, NSW_TERRAIN_SOURCE]);
    expect(map.addSource).toHaveBeenCalledTimes(1);
  });

  describe("with sharpened areas", () => {
    // Mutation: keep the archive's own URL when areas exist and 3D ignores
    // them, as it did before the router.
    it("reads the router, to the deepest zmax, with the area's credit", async () => {
      const map = fakeMap(...KATOOMBA);
      const id = await terrainSourceFor(map, [area], opens, "https://web.test");
      expect(id).not.toBe(NSW_TERRAIN_SOURCE);
      const spec = map.addSource.mock.calls[0]![1] as Record<string, unknown>;
      expect(spec).toMatchObject({
        tiles: [expect.stringMatching(/^logjam-terrain:\/\/hillshade\//)],
        maxzoom: 16,
        encoding: "terrarium",
      });
      expect(spec.url).toBeUndefined();
      expect(spec.attribution).toContain("a made-up survey");
      expect(spec.attribution).toContain(NSW_5M.creditHtml);
    });

    // Mutation: one source id for every set, and a revoked share keeps being
    // drawn from the tiles cached under the old set.
    it("gives a changed set a new source and drops the old one", async () => {
      const map = fakeMap(...KATOOMBA);
      const before = await terrainSourceFor(
        map,
        [area],
        opens,
        "https://web.test",
      );
      const none = await terrainSourceFor(map, [], opens, "https://web.test");
      expect(none).toBe(NSW_TERRAIN_SOURCE);
      expect(none).not.toBe(before);
      const removed: string[] = [];
      dropStaleTerrainSources(
        {
          getStyle: () => ({
            sources: { [before]: {}, [none]: {}, other: {} },
          }),
          removeSource: (id: string) => void removed.push(id),
        } as never,
        none,
      );
      expect(removed).toEqual([before]);
    });
  });

  // Mutations (each red): skip dropStaleTerrainSources; setTerrain with the
  // old source; ignore isCurrent.
  describe("applyTerrain", () => {
    function terrainMap() {
      const base = fakeMap(...KATOOMBA);
      const added = new Set<string>();
      const map = Object.assign(base, {
        getSource: (id: string) => (added.has(id) ? {} : undefined),
        addSource: vi.fn((id: string) => void added.add(id)),
        getStyle: () => ({
          sources: Object.fromEntries(
            [WORLDWIDE_TERRAIN_SOURCE, ...added].map((id) => [id, {}]),
          ),
        }),
        removeSource: vi.fn((id: string) => void added.delete(id)),
        setTerrain: vi.fn(),
        once: vi.fn(),
      });
      return map;
    }

    it("draws the new set and removes the source of an area no longer seen", async () => {
      const map = terrainMap();
      const go = (areas: SharpenedOverlay[]) =>
        applyTerrain(
          map as never,
          areas,
          opens,
          "https://web.test",
          () => true,
        );
      await go([area]);
      const withArea = map.setTerrain.mock.calls[0]![0].source as string;
      await go([]);
      expect(map.setTerrain.mock.calls[1]![0].source).toBe(NSW_TERRAIN_SOURCE);
      expect(map.removeSource).toHaveBeenCalledWith(withArea);
      expect(map.removeSource).not.toHaveBeenCalledWith(
        WORLDWIDE_TERRAIN_SOURCE,
      );
    });

    it("draws nothing for a stale answer, and tilts once idle", async () => {
      const map = terrainMap();
      await applyTerrain(
        map as never,
        [area],
        opens,
        "https://web.test",
        () => false,
      );
      expect(map.setTerrain).not.toHaveBeenCalled();
      const tilt = vi.fn();
      await applyTerrain(
        map as never,
        [],
        opens,
        "https://web.test",
        () => true,
        tilt,
      );
      expect(map.once).toHaveBeenCalledWith("idle", tilt);
    });
  });
});
