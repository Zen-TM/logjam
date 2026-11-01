import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SharpenedOverlay } from "@logjam/shared";

import { sharpenedArchiveAddress } from "./terrainRoutes";

// MLRN's native transform table, as the module drives it.
const native = vi.hoisted(() => ({
  table: new Map<string, { match?: string; find: string; replace: string }>(),
}));
vi.mock("@maplibre/maplibre-react-native", () => ({
  TransformRequestManager: {
    addUrlTransform: ({
      id,
      ...transform
    }: {
      id: string;
      match?: string;
      find: string;
      replace: string;
    }) => {
      native.table.set(id, transform);
    },
    removeUrlTransform: (id: string) => {
      native.table.delete(id);
    },
    clearUrlTransforms: () => {
      native.table.clear();
    },
  },
}));

// A fresh JS context each time: the module's own state starts over, MLRN's
// native table does not.
const load = () => import("./sharpenedArchives");

const area = (id: string, contoursUrl: string | null): SharpenedOverlay => ({
  id,
  zmax: 17,
  tiles15: [100, 200, 101, 201],
  coverage: [0, 0, 0, 0],
  contours: contoursUrl != null,
  credit: "Made-up credit",
  createdAt: "2026-10-01T00:00:00Z",
  heightsUrl: `https://bucket.example/${id}/heights.pmtiles?X-Amz-Signature=h$1`,
  slopeUrl: `https://bucket.example/${id}/slope.pmtiles?X-Amz-Signature=s\\2`,
  contoursUrl,
});

// Kotlin's Regex.replace, as MLRN's interceptor calls it: `\` escapes the next
// character and `$n` is a group.
const kotlinReplace = (input: string, find: string, replacement: string) =>
  input.replace(new RegExp(find), () =>
    replacement.replace(/\\(.)|\$(\d)/g, (_m, escaped: string | undefined) => {
      if (escaped === undefined) throw new Error("group reference");
      return escaped;
    }),
  );

beforeEach(() => {
  vi.resetModules();
  native.table.clear();
});

describe("sharpenedArchiveTransforms", () => {
  // Red if `$` is doubled instead of escaped, or the URL goes in unescaped.
  it("turns each fixed address into its presigned URL, character for character", async () => {
    const { sharpenedArchiveTransforms } = await load();
    const a = area("a1", null);
    const transforms = sharpenedArchiveTransforms([a]);
    for (const [layer, url] of [
      ["heights", a.heightsUrl],
      ["slope", a.slopeUrl],
    ] as const) {
      const t = transforms.get(`sharpened-a1-${layer}`)!;
      const address = sharpenedArchiveAddress("a1", layer);
      expect(new RegExp(t.match).test(address)).toBe(true);
      expect(kotlinReplace(address, t.find, t.replace)).toBe(url);
    }
  });

  // Red if the pattern loses its anchor or its layer.
  it("matches only its own area's archive", async () => {
    const { sharpenedArchiveTransforms } = await load();
    const t = sharpenedArchiveTransforms([area("a1", null)]).get(
      "sharpened-a1-slope",
    )!;
    expect(
      new RegExp(t.match).test(sharpenedArchiveAddress("a1", "heights")),
    ).toBe(false);
    expect(
      new RegExp(t.match).test(sharpenedArchiveAddress("a12", "slope")),
    ).toBe(false);
  });

  it("serves no contour archive for an area that has none", async () => {
    const { sharpenedArchiveTransforms } = await load();
    const ids = [...sharpenedArchiveTransforms([area("a1", null)]).keys()];
    expect(ids).toEqual(["sharpened-a1-heights", "sharpened-a1-slope"]);
  });
});

describe("serveSharpenedArchives", () => {
  // Red if stale transforms are kept.
  it("drops the transforms of an area no longer listed", async () => {
    const { serveSharpenedArchives, sharpenedAreasEpoch } = await load();
    const epoch = sharpenedAreasEpoch();
    serveSharpenedArchives(
      [area("a1", null), area("a2", "https://c.example/c")],
      epoch,
    );
    serveSharpenedArchives([area("a2", "https://c.example/c")], epoch);
    expect([...native.table.keys()].sort()).toEqual([
      "sharpened-a2-contours",
      "sharpened-a2-heights",
      "sharpened-a2-slope",
    ]);
  });

  // Red if the first serve of a JS context doesn't clear MLRN's table.
  it("drops transforms a JS reload left behind", async () => {
    native.table.set("sharpened-gone-slope", { find: "x", replace: "y" });
    const { serveSharpenedArchives, sharpenedAreasEpoch } = await load();
    serveSharpenedArchives([area("a1", null)], sharpenedAreasEpoch());
    expect(native.table.has("sharpened-gone-slope")).toBe(false);
  });
});

describe("stopSharpenedAreasForWipe", () => {
  // Red if the wipe leaves a transform, or a list read before it is served.
  it("drops every transform, and never serves a list read before it", async () => {
    const {
      serveSharpenedArchives,
      sharpenedAreasEpoch,
      stopSharpenedAreasForWipe,
    } = await load();
    const before = sharpenedAreasEpoch();
    serveSharpenedArchives([area("a1", null)], before);
    stopSharpenedAreasForWipe();
    expect(native.table.size).toBe(0);
    // The map, still mounted while the wipe runs, renders with its old list.
    serveSharpenedArchives([area("a1", null)], before);
    expect(native.table.size).toBe(0);
    // The next account's map reads its list after the wipe.
    serveSharpenedArchives([area("b1", null)], sharpenedAreasEpoch());
    expect([...native.table.keys()]).toEqual([
      "sharpened-b1-heights",
      "sharpened-b1-slope",
    ]);
  });
});

describe("inAreasEpoch", () => {
  // Red if the epoch is read when the list arrives rather than when it was
  // asked for: a list still in flight at sign-out would be served after the
  // wipe, the departing account's URLs back in MLRN.
  it("never serves a list that was in flight when the sign-out wipe ran", async () => {
    const { inAreasEpoch, serveSharpenedArchives, stopSharpenedAreasForWipe } =
      await load();
    let land!: (list: { jobs: SharpenedOverlay[] }) => void;
    const answer = inAreasEpoch(
      () => new Promise<{ jobs: SharpenedOverlay[] }>((r) => (land = r)),
    );
    stopSharpenedAreasForWipe();
    land({ jobs: [area("a1", null)] });
    const { jobs, areasEpoch } = await answer;
    serveSharpenedArchives(jobs, areasEpoch);
    expect(native.table.size).toBe(0);
  });
});

describe("sharpenedAreasOf", () => {
  // Red if the map's areas take the epoch they land in rather than the one
  // the list carries: a list in flight at sign-out would be served after the
  // wipe.
  it("gives a list in flight at sign-out the epoch it was asked in", async () => {
    const {
      inAreasEpoch,
      serveSharpenedArchives,
      sharpenedAreasOf,
      stopSharpenedAreasForWipe,
    } = await load();
    let land!: (list: { jobs: { sharpened?: SharpenedOverlay }[] }) => void;
    const answer = inAreasEpoch(
      () =>
        new Promise<{ jobs: { sharpened?: SharpenedOverlay }[] }>(
          (r) => (land = r),
        ),
    );
    stopSharpenedAreasForWipe();
    land({ jobs: [{ sharpened: area("a1", null) }, {}] });
    const { sharpenedAreas, areasEpoch } = sharpenedAreasOf(await answer, true);
    expect(sharpenedAreas.map((a) => a.id)).toEqual(["a1"]);
    serveSharpenedArchives(sharpenedAreas, areasEpoch);
    expect(native.table.size).toBe(0);
  });

  // Red if a guest gets the list's areas: it keeps its last answer once the
  // query is disabled.
  it("shows a guest no area", async () => {
    const { inAreasEpoch, sharpenedAreasOf } = await load();
    const list = await inAreasEpoch(async () => ({
      jobs: [{ sharpened: area("a1", null) }],
    }));
    expect(sharpenedAreasOf(list, false).sharpenedAreas).toEqual([]);
  });
});

// Red if anything in Logjam GPS sets MLRN's log level below "warn".
it("never turns MLRN's logging up", () => {
  // MLRN logs every transformed URL, presigned query and all, to its JS log
  // at its debug level.
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });
  const root = join(__dirname, "../..");
  const calls = [
    ...files(join(root, "src")),
    join(root, "App.tsx"),
    join(root, "index.ts"),
  ]
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"))
    .flatMap(
      (f) => readFileSync(f, "utf8").match(/setLogLevel\([^)]*\)/g) ?? [],
    );
  expect(calls.filter((c) => !/["'](warn|error)["']/.test(c))).toEqual([]);
});
