import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SharpenedOverlay } from "@logjam/shared";

import {
  serveSharpenedArchives,
  sharpenedArchiveTransforms,
} from "./sharpenedArchives";
import { sharpenedArchiveAddress } from "./terrainRoutes";

const added = new Map<
  string,
  { match?: string; find: string; replace: string }
>();
const removed: string[] = [];
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
      added.set(id, transform);
    },
    removeUrlTransform: (id: string) => {
      added.delete(id);
      removed.push(id);
    },
  },
}));

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
  added.clear();
  removed.length = 0;
  serveSharpenedArchives([]);
  removed.length = 0;
});

describe("sharpenedArchiveTransforms", () => {
  it("turns each fixed address into its presigned URL, character for character", () => {
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

  it("matches only its own area's archive", () => {
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

  it("serves no contour archive for an area that has none", () => {
    const ids = [...sharpenedArchiveTransforms([area("a1", null)]).keys()];
    expect(ids).toEqual(["sharpened-a1-heights", "sharpened-a1-slope"]);
  });
});

describe("serveSharpenedArchives", () => {
  it("drops the transforms of an area no longer listed", () => {
    serveSharpenedArchives([
      area("a1", null),
      area("a2", "https://c.example/c"),
    ]);
    serveSharpenedArchives([area("a2", "https://c.example/c")]);
    expect(removed.sort()).toEqual([
      "sharpened-a1-heights",
      "sharpened-a1-slope",
    ]);
    expect([...added.keys()].sort()).toEqual([
      "sharpened-a2-contours",
      "sharpened-a2-heights",
      "sharpened-a2-slope",
    ]);
  });

  it("holds no URL once signed out", () => {
    serveSharpenedArchives([area("a1", null)]);
    serveSharpenedArchives([]);
    expect(added.size).toBe(0);
  });
});

it("never turns MLRN's logging up", () => {
  // MLRN logs every transformed URL, presigned query and all, at its debug
  // level. Nothing in Logjam GPS may set a level below "warn".
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
