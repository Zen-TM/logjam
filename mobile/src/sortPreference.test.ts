import { beforeEach, describe, expect, it, vi } from "vitest";
import { readSort } from "./sortPreference";

const store = new Map<string, string>();
vi.mock("./prefsDb", () => ({
  readPref: (key: string) => store.get(key) ?? null,
  writePref: (key: string, value: string) => {
    store.set(key, value);
    return true;
  },
}));

const KEYS = ["name", "recent"] as const;

// Mutation: read the fallback unconditionally (a restart forgets the sort), or
// drop the `keys.find` check (a retired sort key reaches the list).
describe("readSort", () => {
  beforeEach(() => store.clear());

  it("reads what was stored, per list", () => {
    store.set("sort.places", "recent");
    expect(readSort("places", KEYS, "name")).toBe("recent");
    expect(readSort("trips", KEYS, "name")).toBe("name");
  });

  it("falls back for a sort the list no longer has", () => {
    store.set("sort.places", "grade");
    expect(readSort("places", KEYS, "name")).toBe("name");
  });
});
