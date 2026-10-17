import { describe, expect, it, vi } from "vitest";
import { PLACE_SEARCH_DEBOUNCE_MS, type PlaceResult } from "@logjam/shared";

const apiFetch = vi.hoisted(() =>
  vi.fn(async () => ({ results: [], version: "2026-10-15" })),
);
vi.mock("../api/apiFetch", () => ({ apiFetch }));

const {
  askPlacesOnline,
  placesFromAnswer,
  placeSearchSource,
  searchPlacesOnline,
  searchRows,
} = await import("./placeSearch");

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
  // Mutation: put `q` in the path's query string, or send a GET.
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

  // Mutation: push the credit row whatever the results.
  it("credits OpenStreetMap only when its results are showing", () => {
    expect(searchRows(["yours"], [], true).map((row) => row.kind)).toEqual([
      "saved",
      "ask",
    ]);
  });
  // Mutation: hold the user's own matches back until the index is built.
  it("shows the user's own matches at once while the place names load", () => {
    expect(
      searchRows(["yours"], "loading", true).map((row) => row.kind),
    ).toEqual(["saved", "loading", "ask"]);
  });
});

describe("the API's answer", () => {
  // Mutation: drop the `aborted` check in `askPlacesOnline`'s `.then`.
  it("never shows an older search that resolves after a newer one", async () => {
    vi.useFakeTimers();
    try {
      const pending: ((value: unknown) => void)[] = [];
      apiFetch.mockImplementation(
        () => new Promise((resolve) => pending.push(resolve)) as never,
      );
      const settled: string[] = [];
      const settle = (answer: { query: string }) => settled.push(answer.query);
      const cancelOlder = askPlacesOnline("Kat", settle);
      await vi.advanceTimersByTimeAsync(PLACE_SEARCH_DEBOUNCE_MS);
      cancelOlder();
      askPlacesOnline("Kato", settle);
      await vi.advanceTimersByTimeAsync(PLACE_SEARCH_DEBOUNCE_MS);
      pending[1]({ results: [peak] });
      await vi.advanceTimersByTimeAsync(0);
      pending[0]({ results: [] });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toEqual(["Kato"]);
    } finally {
      vi.useRealTimers();
      apiFetch.mockReset();
    }
  });

  // Mutation: settle a failure with an empty list and no message.
  it("says why when the search fails", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      apiFetch.mockRejectedValueOnce(new Error("Server unavailable"));
      let answer: unknown = null;
      askPlacesOnline("Kato", (next) => {
        answer = next;
      });
      await vi.advanceTimersByTimeAsync(PLACE_SEARCH_DEBOUNCE_MS);
      expect(answer).toEqual({
        query: "Kato",
        results: [],
        error: expect.any(String),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  // Mutation: show the last answer whatever the query is now.
  it("still fits while the query only grows, and is awaited otherwise", () => {
    const answer = { query: "Kat", results: [peak], error: null };
    expect(placesFromAnswer(answer, "Kato")).toEqual([peak]);
    expect(placesFromAnswer(answer, "Ka")).toBe("loading");
    expect(placesFromAnswer(answer, "Blue")).toBe("loading");
    expect(placesFromAnswer(null, "Kato")).toBe("loading");
  });

  // Mutation: drop the user's own matches or the ask row on a failure.
  it("keeps the user's own matches and the ask row on a failure", () => {
    const failed = { query: "Kat", results: [], error: "Server unavailable" };
    expect(
      searchRows(["yours"], placesFromAnswer(failed, "Kat"), true),
    ).toEqual([
      { kind: "saved", item: "yours" },
      { kind: "error", message: "Server unavailable" },
      { kind: "ask" },
    ]);
  });
});
