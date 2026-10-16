import { afterEach, describe, expect, it, vi } from "vitest";
import { geocode } from "./geocode";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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

  // Mutation: drop `waitForSlot`, or give it no memory of the last request.
  it("spaces its requests a second apart", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60_000);
    const fetchMock = vi.fn(async () => new Response("[]"));
    vi.stubGlobal("fetch", fetchMock);

    void geocode("Kanangra Walls");
    const second = geocode("Katoomba");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // Mutation: skip the cache read.
  it("answers a repeated query from memory, not by asking again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 120_000);
    const fetchMock = vi.fn(async () => new Response("[]"));
    vi.stubGlobal("fetch", fetchMock);
    await geocode("Mount Wilson");
    await geocode("mount wilson ");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
