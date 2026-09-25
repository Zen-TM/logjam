import { describe, expect, it, vi } from "vitest";

vi.mock("../prefsDb", () => ({
  readPref: vi.fn(() => storedValue),
  writePref: vi.fn((_key: string, value: string) => {
    storedValue = value;
    return true;
  }),
}));

let storedValue: string | null = null;

const { readMutedTopoAreas, writeMutedTopoAreas } = await import("./topoAreaMuting");

describe("topo area muting", () => {
  it("round-trips a set of area ids", () => {
    storedValue = null;
    writeMutedTopoAreas(new Set(["area-a", "area-b"]));
    expect(readMutedTopoAreas()).toEqual(new Set(["area-a", "area-b"]));
  });

  it("reads nothing recorded as nothing muted", () => {
    storedValue = null;
    expect(readMutedTopoAreas().size).toBe(0);
  });

  it("reads a corrupt value as nothing muted rather than throwing", () => {
    // The map's first render calls this — a parse error here must not be the
    // difference between a screen that mounts and one that doesn't.
    storedValue = "{not json";
    expect(readMutedTopoAreas().size).toBe(0);
    storedValue = '{"muted":true}';
    expect(readMutedTopoAreas().size).toBe(0);
  });

  it("drops non-string entries from a hand-edited array", () => {
    storedValue = '["area-a", 7, null, "area-b"]';
    expect(readMutedTopoAreas()).toEqual(new Set(["area-a", "area-b"]));
  });
});
