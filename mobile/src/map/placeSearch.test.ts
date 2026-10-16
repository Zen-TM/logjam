import { describe, expect, it, vi } from "vitest";
import type { PlaceResult } from "@logjam/shared";

const apiFetch = vi.hoisted(() =>
  vi.fn(async () => ({ results: [], version: "2026-10-15" })),
);
vi.mock("../api/apiFetch", () => ({ apiFetch }));

const { placeSearchSource, searchPlacesOnline, searchRows } = await import(
  "./placeSearch"
);

const peak: PlaceResult = {
  name: "Mount Solitary",
  kind: "Peak",
  near: "Katoomba",
  lon: 150.3,
  lat: -33.7,
};

describe("placeSearchSource", () => {
  // Mutation: check the account before the file.
  it("searches the phone's own copy whenever it has one, even online", () => {
    expect(placeSearchSource(true, "linked", true)).toBe("device");
    expect(placeSearchSource(true, "guest", false)).toBe("device");
  });

  // Mutation: return "api" without asking capabilities.ts.
  it("asks the API only for a signed-in phone with signal", () => {
    expect(placeSearchSource(false, "linked", true)).toBe("api");
    expect(placeSearchSource(false, "linked", false)).toBe("none");
    expect(placeSearchSource(false, "guest", true)).toBe("none");
  });
});

describe("searchPlacesOnline", () => {
  it("sends the query in the body, never the URL", async () => {
    await searchPlacesOnline("Claustral", new AbortController().signal);
    const [path, options] = apiFetch.mock.calls[0] as unknown as [
      string,
      { method: string; body: unknown },
    ];
    expect(path).toBe("/places/search");
    expect(options.method).toBe("POST");
    expect(options.body).toEqual({ q: "Claustral", limit: 8 });
  });
});

describe("searchRows", () => {
  // Mutation: list the registry's results above the user's own.
  it("puts the user's own things first, then places, the credit, then the ask", () => {
    expect(searchRows(["yours"], [peak], true).map((row) => row.kind)).toEqual([
      "saved",
      "place",
      "credit",
      "ask",
    ]);
  });

  it("credits OpenStreetMap only when its results are showing", () => {
    expect(searchRows(["yours"], [], true).map((row) => row.kind)).toEqual([
      "saved",
      "ask",
    ]);
  });
});
