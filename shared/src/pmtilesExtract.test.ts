import { readFileSync } from "node:fs";
import { PMTiles, type Source } from "pmtiles";
import { describe, expect, it, vi } from "vitest";

import { lonLatToTile } from "./mapRegionEstimate.js";
import {
  fetchExtractRequest,
  planExtract,
  type ExtractOptions,
} from "./pmtilesExtract.js";
// The script that wrote the fixture reads archives the same way, so go's
// extract and ours are compared through one reader.
// @ts-expect-error -- a plain .mjs script, untyped
import { dumpArchive } from "../scripts/pmtiles-extract-fixture.mjs";

const DIR = new URL("./__fixtures__/pmtiles-extract/", import.meta.url);
const fixture = new Uint8Array(readFileSync(new URL("fixture.pmtiles", DIR)));
const { sourceHasLeaves, cases } = JSON.parse(
  readFileSync(new URL("expected.json", DIR), "utf8"),
) as {
  sourceHasLeaves: boolean;
  cases: {
    name: string;
    bbox: [number, number, number, number];
    minzoom?: number;
    maxzoom: number;
    expected: unknown;
  }[];
};

/** A source over bytes in memory, counting what it is asked for. */
function memorySource(bytes: Uint8Array) {
  const asked: number[] = [];
  const source: Source = {
    getKey: () => "fixture",
    getBytes: async (offset, length) => {
      asked.push(length);
      return { data: bytes.slice(offset, offset + length).buffer };
    },
  };
  return { source, asked };
}

async function extract(bytes: Uint8Array, options: ExtractOptions) {
  const { source, asked } = memorySource(bytes);
  const plan = await planExtract(source, options);
  const out = new Uint8Array(plan.totalBytes);
  out.set(plan.prefix);
  let at = plan.prefix.length;
  for (const request of plan.requests) {
    // Requests come in output order, so a writer can append.
    expect(request.dstOffset).toBe(at);
    const data = await fetchExtractRequest(source, plan, request);
    out.set(data, request.dstOffset);
    at += data.length;
  }
  expect(at).toBe(plan.totalBytes);
  return { out, plan, asked };
}

const optionsOf = (c: (typeof cases)[number]): ExtractOptions => ({
  bbox: {
    west: c.bbox[0],
    south: c.bbox[1],
    east: c.bbox[2],
    north: c.bbox[3],
  },
  minzoom: c.minzoom,
  maxzoom: c.maxzoom,
});

describe("planExtract", () => {
  it("reads a fixture that needs leaf directories", () => {
    // Otherwise the leaf walk is never exercised.
    expect(sourceHasLeaves).toBe(true);
  });

  // The cuts go-pmtiles v1.31.2 made of the same fixture
  // (scripts/pmtiles-extract-fixture.mjs). Mutations, each red here: keep
  // a whole run of identical tiles instead of cutting it to the area (across
  // the sea); give every duplicate its own copy (full depth); skip the leaves
  // (every case).
  it.each(cases)("cuts what pmtiles extract cuts: $name", async (c) => {
    const { out } = await extract(fixture, optionsOf(c));
    const ours = await dumpArchive(out);
    // Ours writes its own gzip, so only the directories' bytes may differ.
    expect(ours).toEqual(c.expected);
  });

  it("writes a file the pmtiles reader opens tile by tile", async () => {
    const c = cases[0];
    const { out } = await extract(fixture, optionsOf(c));
    const clip = new PMTiles(memorySource(out).source);
    const whole = new PMTiles(memorySource(fixture).source);
    const { x, y } = lonLatToTile(150.4, -33.6, 14);
    const z = 14;
    const a = await clip.getZxy(z, x, y);
    const b = await whole.getZxy(z, x, y);
    expect(a?.data).toBeDefined();
    expect(new Uint8Array(a!.data)).toEqual(new Uint8Array(b!.data));
  });

  // Mutation: drop the gap merge (gap 0) and the request count rises to one
  // per run; drop the size cap and a single request carries the whole clip.
  it("coalesces runs across small gaps, and caps a request's size", async () => {
    const options = optionsOf(cases[0]);
    const merged = await extract(fixture, options);
    const apart = await extract(fixture, { ...options, mergeGapBytes: 0 });
    expect(merged.plan.requests.length).toBeLessThan(
      apart.plan.requests.length,
    );
    expect(merged.out).toEqual(apart.out);

    const capped = await extract(fixture, { ...options, maxRequestBytes: 64 });
    expect(
      Math.max(...capped.plan.requests.map((r) => r.length)),
    ).toBeLessThanOrEqual(64);
    expect(capped.out).toEqual(merged.out);
  });

  // Mutations: drop the west-of test and the first check goes red; call an
  // area outside unless it is wholly inside and "past the edge" goes red.
  it("says when the area misses the archive's bounds", async () => {
    const outside = cases.find((c) => c.name === "outside")!;
    const { plan } = await extract(fixture, optionsOf(outside));
    expect(plan.outside).toBe(true);
    for (const c of cases.filter((c) => c !== outside)) {
      const { plan } = await extract(fixture, optionsOf(c));
      expect(plan.outside, c.name).toBe(false);
    }
  });

  // A partial clip is resumed only when a replanned one starts with the same
  // bytes (mobile regionDownloads.ts). Mutation: let gzip stamp the time into
  // the directories and the two prefixes differ.
  it("plans the same bytes again later", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const first = await extract(fixture, optionsOf(cases[0]));
      vi.setSystemTime(Date.now() + 60_000);
      const again = await extract(fixture, optionsOf(cases[0]));
      expect(again.plan.prefix).toEqual(first.plan.prefix);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a short range", async () => {
    const { source } = memorySource(fixture);
    const plan = await planExtract(source, optionsOf(cases[0]));
    const short: Source = {
      getKey: () => "short",
      getBytes: async (offset, length) => source.getBytes(offset, length - 1),
    };
    await expect(
      fetchExtractRequest(short, plan, plan.requests[0]),
    ).rejects.toThrow(/short range/);
  });
});
