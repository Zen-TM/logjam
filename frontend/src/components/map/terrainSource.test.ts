import { describe, expect, it, vi } from "vitest";

import {
  REGION_TERRAIN_SOURCE,
  WORLDWIDE_TERRAIN_SOURCE,
  applyTerrain,
  dropStaleTerrainSources,
  terrainSourceFor,
} from "./terrainSource";
import {
  NSW_REGION,
  SIM_NZ,
  SIM_UTAH,
  SIM_WORLD,
  type Region,
  type SharpenedOverlay,
} from "@logjam/shared";

const NSW_TERRAIN_SOURCE = `${REGION_TERRAIN_SOURCE}${NSW_REGION.id}`;
const SIM_REGIONS = [NSW_REGION, SIM_NZ, SIM_UTAH];

/** A map showing a small view round a point, its longitudes raw as MapLibre reports them. */
function fakeMap(lng: number, lat: number) {
  const sources = new Map<string, unknown>();
  return {
    getBounds: () => ({
      getWest: () => lng - 0.01,
      getEast: () => lng + 0.01,
      getSouth: () => lat - 0.01,
      getNorth: () => lat + 0.01,
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

  // Mutation: read the view unwrapped (`regionInView` in place of
  // `regionInWrappedView`) and a map panned once around the world draws NSW
  // from the worldwide tiles.
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

  describe("by region", () => {
    const WANAKA = [169.1, -44.62] as const;
    const NZ_ARCHIVE = `https://web.test/${SIM_NZ.terrain.heights!.archivePath}`;
    const nzArea: SharpenedOverlay = {
      ...area,
      id: "nz1",
      coverage: [169.05, -44.65, 169.07, -44.63],
    };
    const ask = (
      map: ReturnType<typeof fakeMap>,
      areas: SharpenedOverlay[] = [],
      open: (url: string) => Promise<unknown> = opens,
      world?: Region,
    ) =>
      terrainSourceFor(
        map,
        areas,
        open,
        "https://web.test",
        SIM_REGIONS,
        world,
      );

    // Mutation: read NSW's archive whatever the region, and a map over
    // another region draws its terrain from New South Wales's heights.
    it("reads the heights of the region the map shows", async () => {
      const map = fakeMap(...WANAKA);
      const open = vi.fn(opens);
      expect(await ask(map, [], open)).toBe(`${REGION_TERRAIN_SOURCE}simnz`);
      expect(open).toHaveBeenCalledWith(NZ_ARCHIVE);
      expect(map.addSource.mock.calls[0]![1]).toMatchObject({
        url: `pmtiles://${NZ_ARCHIVE}`,
        attribution: SIM_NZ.terrain.heights!.creditHtml,
      });
    });

    // Mutation: test the view's centre against the heights' coverage box in
    // place of `regionInWrappedView`, and a view centred just east of the
    // Coromandel, whose border still touches it, draws the worldwide tiles.
    it("reads a region whose border touches the view, as the Terrain group does", async () => {
      expect(await ask(fakeMap(175.705, -37.0))).toBe(
        `${REGION_TERRAIN_SOURCE}simnz`,
      );
    });

    // Mutation: return the region's source whenever `region` is set, and a
    // region with no heights draws a source over an archive that is not there.
    it("uses the worldwide tiles over a region that declares no heights", async () => {
      const noHeights: Region = { ...SIM_NZ, terrain: {} };
      const open = vi.fn(opens);
      expect(
        await terrainSourceFor(
          fakeMap(...WANAKA),
          [],
          open,
          "https://web.test",
          [noHeights],
        ),
      ).toBe(WORLDWIDE_TERRAIN_SOURCE);
      expect(open).not.toHaveBeenCalled();
    });

    // Mutation: skip the world fallback and a map outside every region draws
    // no heights of the everywhere tier.
    it("falls back to the everywhere tier outside every region, when there is one", async () => {
      const map = fakeMap(0, 20);
      expect(await ask(map, [], opens, SIM_WORLD)).toBe(
        `${REGION_TERRAIN_SOURCE}world`,
      );
      expect(map.addSource.mock.calls[0]![1]).toMatchObject({
        url: `pmtiles://https://web.test/${SIM_WORLD.terrain.heights!.archivePath}`,
      });
    });

    // Mutation: hand the router every area (`areas` in place of `held`), and
    // an area in New South Wales turns another region's source into a routed
    // one whose zooms reach past its archive.
    it("ignores an area another region holds", async () => {
      const map = fakeMap(...WANAKA);
      expect(await ask(map, [area])).toBe(`${REGION_TERRAIN_SOURCE}simnz`);
      const spec = map.addSource.mock.calls[0]![1] as Record<string, unknown>;
      expect(spec.url).toBe(`pmtiles://${NZ_ARCHIVE}`);
      expect(spec.tiles).toBeUndefined();
    });

    // Mutation: build the template with NSW's region in place of `region`,
    // and an area in another region is routed under the wrong archives.
    it("routes the areas a region holds under its own id", async () => {
      const map = fakeMap(...WANAKA);
      const id = await ask(map, [nzArea]);
      expect(id).toMatch(/^3d-terrain-dem-simnz-./);
      expect(map.addSource.mock.calls[0]![1]).toMatchObject({
        tiles: [
          expect.stringMatching(/^logjam-terrain:\/\/simnz\/hillshade\//),
        ],
        bounds: [...SIM_NZ.terrain.heights!.coverage],
        minzoom: SIM_NZ.terrain.hillshade!.minzoom,
      });
    });

    // Mutation: keep the NSW-only prefix test in `dropStaleTerrainSources`,
    // and a region's source is left behind when the map crosses into another.
    it("drops the source of the region the map has left, never the worldwide one", () => {
      const removed: string[] = [];
      dropStaleTerrainSources(
        {
          getStyle: () => ({
            sources: {
              [`${REGION_TERRAIN_SOURCE}simnz`]: {},
              [NSW_TERRAIN_SOURCE]: {},
              [WORLDWIDE_TERRAIN_SOURCE]: {},
            },
          }),
          removeSource: (id: string) => void removed.push(id),
        } as never,
        NSW_TERRAIN_SOURCE,
      );
      expect(removed).toEqual([`${REGION_TERRAIN_SOURCE}simnz`]);
    });
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
        tiles: [expect.stringMatching(/^logjam-terrain:\/\/nsw\/hillshade\//)],
        maxzoom: 16,
        encoding: "terrarium",
      });
      expect(spec.url).toBeUndefined();
      expect(spec.attribution).toContain("a made-up survey");
      expect(spec.attribution).toContain(NSW_REGION.terrain.heights.creditHtml);
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
      // Mutation: exaggeration back to 1.5 (heights drawn taller than true).
      expect(map.setTerrain.mock.calls[1]![0]).toEqual({
        source: NSW_TERRAIN_SOURCE,
        exaggeration: 1,
      });
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
