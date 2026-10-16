import { afterEach, describe, expect, it, vi } from "vitest";
import { geocode } from "./geocode";

afterEach(() => vi.unstubAllGlobals());

describe("geocode", () => {
  // Mutation: add any parameter that is not the typed string or a constant,
  // or send our auth header to Nominatim.
  it("sends the third party the typed string, fixed parameters and nothing else", async () => {
    const fetchMock = vi.fn(async () => new Response("[]"));
    vi.stubGlobal("fetch", fetchMock);

    await geocode("  Newnes Plateau ");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const sent = new URL(url);
    expect(sent.origin).toBe("https://nominatim.openstreetmap.org");
    expect(Object.fromEntries(sent.searchParams)).toEqual({
      format: "jsonv2",
      q: "Newnes Plateau",
      countrycodes: "au",
      limit: "5",
      viewbox: "140.999,-28.157,153.638,-37.505",
      bounded: "0",
    });
    expect(Object.keys(init.headers as object).sort()).toEqual([
      "Accept",
      "User-Agent",
    ]);
  });

  it("sends nothing for a query too short to be useful", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await geocode("ab")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
