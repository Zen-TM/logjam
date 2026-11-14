import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { topoRegionsFile } from "./topoRegions.js";

const FILE = new URL("../../topo/regions.json", import.meta.url);
type Entry = {
  id: string;
  sim?: true;
  borders: unknown[];
  terrain: Record<string, { archivePath: string }>;
};
const parsed = (text: string) =>
  (JSON.parse(text) as { regions: Entry[] }).regions;

describe("topo/regions.json", () => {
  // Mutation: change an archive path (or add a region) in regions.ts or
  // simRegions.ts and do not run `npm run topo-regions`.
  it("is what the script writes", () => {
    expect(
      readFileSync(FILE, "utf8"),
      "topo/regions.json is stale: run `npm run build && npm run topo-regions` in shared/",
    ).toBe(topoRegionsFile());
  });

  // Mutation: drop the `sim` mark from the entry, and topo/regions.py reads
  // the made-up regions in prod.
  it("marks the simulated regions and no other", () => {
    const regions = parsed(topoRegionsFile());
    expect(regions.map((r) => [r.id, r.sim === true])).toEqual([
      ["nsw", false],
      ["simnz", true],
      ["simutah", true],
    ]);
  });

  // Mutation: skip a member of `terrain` in the entry (a layer a region has
  // would vanish from the file), or leave `borders` out.
  it("carries each region's rings and every archive it declares", async () => {
    const { NSW_REGION } = await import("./regions.js");
    const nsw = parsed(topoRegionsFile())[0]!;
    expect(nsw.borders).toEqual(NSW_REGION.borders);
    expect(
      Object.fromEntries(
        Object.entries(nsw.terrain).map(([k, a]) => [k, a.archivePath]),
      ),
    ).toEqual(
      Object.fromEntries(
        Object.entries(NSW_REGION.terrain).map(([k, a]) => [k, a.archivePath]),
      ),
    );
    expect(Object.keys(nsw.terrain).length).toBeGreaterThanOrEqual(5);
  });

  // Mutation: give `REGIONS` with the switch on a list of its own (in
  // regions.ts) instead of `REGIONS_WITH_SIMULATED`, and add a region to one.
  it("lists the regions the declaration holds with the simulated ones on", async () => {
    const flag = globalThis as { LOGJAM_SIM_REGIONS?: unknown };
    vi.resetModules();
    flag.LOGJAM_SIM_REGIONS = true;
    try {
      const { REGIONS } = await import("./regions.js");
      expect(parsed(topoRegionsFile()).map((r) => r.id)).toEqual(
        REGIONS.map((r) => r.id),
      );
    } finally {
      delete flag.LOGJAM_SIM_REGIONS;
      vi.resetModules();
    }
  });
});
