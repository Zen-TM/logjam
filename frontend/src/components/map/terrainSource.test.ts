import { describe, expect, it, vi } from "vitest";

import {
  NSW_TERRAIN_SOURCE,
  WORLDWIDE_TERRAIN_SOURCE,
  terrainSourceFor,
} from "./terrainSource";

function fakeMap(lng: number, lat: number) {
  const sources = new Map<string, unknown>();
  return {
    getCenter: () => ({ lng, lat }),
    getSource: (id: string) => sources.get(id),
    addSource: vi.fn((id: string, source: unknown) => {
      sources.set(id, source);
    }),
  } as unknown as Parameters<typeof terrainSourceFor>[0] & {
    addSource: ReturnType<typeof vi.fn>;
  };
}

const KATOOMBA = [150.31, -33.71] as const;
const opens = async () => {};

describe("terrainSourceFor", () => {
  it("uses the NSW archive over NSW, and adds its source once", async () => {
    const map = fakeMap(...KATOOMBA);
    const open = vi.fn(opens);
    expect(await terrainSourceFor(map, open, "https://web.test")).toBe(
      NSW_TERRAIN_SOURCE,
    );
    expect(await terrainSourceFor(map, open, "https://web.test")).toBe(
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
      await terrainSourceFor(fakeMap(115.86, -31.95), open, "https://web.test"),
    ).toBe(WORLDWIDE_TERRAIN_SOURCE);
    expect(open).not.toHaveBeenCalled();
  });
});
