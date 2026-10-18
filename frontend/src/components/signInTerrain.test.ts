import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NSW_5M } from "@logjam/shared";
import { describe, expect, it } from "vitest";
import {
  areaKeys,
  cover,
  D8,
  drainage,
  dropPath,
  OUTLET,
  pickArea,
  sunPosition,
  traceDownhill,
  valleyLight,
} from "./signInTerrain";

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, "../assets/signIn");
const GENERATOR = join(HERE, "../../scripts/sign_in_terrain.py");

const DEG = 180 / Math.PI;

describe("sunPosition", () => {
  // Published for Sydney, 21 Dec 2026: solar noon about 12:57 AEDT at 79.5°;
  // sunrise 05:41 at an azimuth of about 119°. Near a summer noon the azimuth
  // swings a degree a minute, so it is only held to "north". Mutation that
  // turns it red: drop `lon` from the hour angle.
  it("puts the summer noon sun high in the north", () => {
    const sun = sunPosition(new Date("2026-12-21T01:57:00Z"), -33.87, 151.21);
    expect(sun.altitude * DEG).toBeCloseTo(79.5, 0);
    expect(Math.min(sun.azimuth * DEG, 360 - sun.azimuth * DEG)).toBeLessThan(
      15,
    );
  });

  it("rises in the south of east at midsummer", () => {
    const sun = sunPosition(new Date("2026-12-20T18:41:00Z"), -33.87, 151.21);
    expect(Math.abs(sun.altitude * DEG)).toBeLessThan(1);
    expect(sun.azimuth * DEG).toBeCloseTo(119, -1);
  });
});

describe("valleyLight", () => {
  it("lights from the north at noon and from the north-west at night", () => {
    const noon = valleyLight(new Date("2026-06-21T02:00:00Z"), -33.6, 150.3);
    expect(noon.light[1]).toBeLessThan(0); // y is south: negative is north
    const night = valleyLight(new Date("2026-06-21T14:00:00Z"), -33.6, 150.3);
    expect(night.light[0]).toBeLessThan(0);
    expect(night.light[1]).toBeLessThan(0);
    expect(night.gain).toBeLessThan(noon.gain);
  });

  it("is a unit vector", () => {
    const { light } = valleyLight(
      new Date("2026-03-01T22:00:00Z"),
      -33.6,
      150.3,
    );
    expect(Math.hypot(...light)).toBeCloseTo(1, 6);
  });
});

describe("drainage and traceDownhill", () => {
  // 3×2, everything ends at the top right:  → → out
  //                                          ↗ → ↑
  const E = 2;
  const N = 0;
  const NE = 1;
  const dir = Uint8Array.from([E, E, OUTLET, NE, E, N]);

  it("counts every upstream cell", () => {
    expect(Array.from(drainage(dir, 3, 2))).toEqual([1, 3, 6, 1, 1, 2]);
  });

  it("follows the arrows to the outlet", () => {
    expect(traceDownhill(dir, 3, 2, 0, 1)).toEqual([3, 1, 2]);
  });
});

describe("pickArea", () => {
  // Mutation that turns it red: drop the filter on `last`.
  it("never repeats the last area", () => {
    for (const random of [0, 0.3, 0.6, 0.99])
      expect(pickArea(["a", "b", "c"], "b", random)).not.toBe("b");
  });

  it("can pick every other area", () => {
    const picked = [0, 0.5, 0.99].map((r) => pickArea(["a", "b", "c"], "a", r));
    expect(new Set(picked)).toEqual(new Set(["b", "c"]));
  });

  it("shows the only area there is, and any area on a first visit", () => {
    expect(pickArea(["a"], "a", 0.5)).toBe("a");
    expect(pickArea(["a", "b"], null, 0.99)).toBe("b");
  });
});

describe("the area files", () => {
  const files = readdirSync(ASSETS);
  const json = files.filter((f) => f.endsWith(".json"));

  // Mutation that turns it red: delete any one area's Flow.webp.
  it("come in complete threes", () => {
    const keys = areaKeys(
      json,
      files.filter((f) => f.endsWith("Normals.webp")),
      files.filter((f) => f.endsWith("Flow.webp")),
    );
    expect(keys.length).toBeGreaterThan(1);
    expect(files.length).toBe(keys.length * 3);
  });

  // ADR 0031: the credit names the month the sheets were downloaded. The
  // credit shown is NSW_5M.credit, so every area must come from that month.
  // Mutation that turns it red: regenerate an area with another month.
  it("are from the month the credit names", () => {
    for (const file of json) {
      const { extracted } = JSON.parse(
        readFileSync(join(ASSETS, file), "utf8"),
      ) as { extracted: string };
      expect(NSW_5M.credit, file).toContain(`extracted ${extracted}.`);
    }
  });
});

describe("the generator and the reader", () => {
  // Mutation that turns it red: swap two entries of D8 in either file, or
  // change either OUTLET.
  it("count D8 directions in the same order, with the same outlet", () => {
    const py = readFileSync(GENERATOR, "utf8");
    const table = py.match(/^D8 = \[(.*)\]$/m)?.[1] ?? "";
    const pairs = [...table.matchAll(/\((-?\d), (-?\d)\)/g)].map((m) => [
      Number(m[1]),
      Number(m[2]),
    ]);
    expect(pairs).toEqual(D8.map((d) => [...d]));
    expect(py).toMatch(new RegExp(`^OUTLET = ${OUTLET}$`, "m"));
  });
});

describe("areaKeys", () => {
  it("leaves out an area missing a file", () => {
    expect(
      areaKeys(
        ["x/a.json", "x/b.json"],
        ["x/aNormals.webp", "x/bNormals.webp"],
        ["x/aFlow.webp"],
      ),
    ).toEqual(["a"]);
  });
});

describe("cover", () => {
  it("fills a wide box by width and crops top and bottom", () => {
    const { s, ox, oy } = cover(1600, 800, 800, 600);
    expect(s).toBe(2);
    expect(ox).toBe(0);
    expect(oy).toBe(-200);
  });

  it("fills a tall box by height and crops the sides", () => {
    const { s, ox, oy } = cover(400, 900, 800, 600);
    expect(s).toBe(1.5);
    expect(ox).toBe(-400);
    expect(oy).toBe(0);
  });
});

describe("dropPath", () => {
  // A drop running east along row 0 of a 6×1 grid, the water gathering.
  const flow = {
    dir: new Uint8Array(6),
    area: Float32Array.from([1, 2, 4, 8, 16, 32]),
    w: 6,
    h: 1,
  };
  const path = dropPath(flow, [0, 1, 2, 3, 4, 5], 10, 0, 0);

  it("runs forward, its distance only growing", () => {
    for (let i = 1; i < path.along.length; i++)
      expect(path.along[i]).toBeGreaterThan(path.along[i - 1]);
  });

  it("thickens and brightens as more ground drains into it", () => {
    for (let i = 1; i < path.width.length; i++) {
      expect(path.width[i]).toBeGreaterThan(path.width[i - 1]);
      expect(path.alpha[i]).toBeGreaterThanOrEqual(path.alpha[i - 1]);
    }
  });

  it("smooths the grid's staircase without moving off the line", () => {
    for (let i = 0; i < 6; i++) expect(path.points[i * 2 + 1]).toBe(5);
    expect(path.points[0]).toBeGreaterThan(5); // pulled towards its neighbours
  });
});
