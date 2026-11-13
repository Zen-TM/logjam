import { afterEach, describe, expect, it, vi } from "vitest";
import { geocode, geocodeBias } from "./geocode";
import { regionBounds, type LonLatBox, NSW_REGION } from "./regions";
import { SIM_NZ, SIM_REGIONS, SIM_WORLD } from "./simRegions";

const around = ([lon, lat]: readonly [number, number], r = 0.1): LonLatBox => ({
  west: lon - r,
  south: lat - r,
  east: lon + r,
  north: lat + r,
});
/** A view in the Pacific, outside every region, simulated or not. */
const OPEN_OCEAN = around([-140, 0]);
const sentParams = (fetchMock: ReturnType<typeof vi.fn>) =>
  Object.fromEntries(
    new URL((fetchMock.mock.calls.at(-1) as unknown as [string])[0])
      .searchParams,
  );

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

    await geocode(
      "  Newnes Plateau ",
      undefined,
      around(NSW_REGION.view.center),
    );

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const sent = new URL(url);
    expect(sent.origin).toBe("https://nominatim.openstreetmap.org");
    expect(Object.fromEntries(sent.searchParams)).toEqual({
      format: "jsonv2",
      q: "Newnes Plateau",
      limit: "5",
      viewbox: "140.9,-28.04,154.29,-37.73",
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

  // Mutation: send a box, centre or zoom whenever the view is outside every
  // region (for instance the view's own bounds, or the old NSW box).
  it("sends no view bias when the map shows no region, so the view stays on the device", async () => {
    vi.useFakeTimers();
    // Past every earlier test's request slot (the spacing is module state).
    vi.setSystemTime(Date.now() + 300_000);
    const fetchMock = vi.fn(async () => new Response("[]"));
    vi.stubGlobal("fetch", fetchMock);

    for (const [name, view] of [
      ["Mount Cook", OPEN_OCEAN],
      ["Mount Kosciuszko", null],
      ["Zion Narrows", undefined],
    ] as const) {
      const done = geocode(name, undefined, view);
      await vi.advanceTimersByTimeAsync(1000);
      await done;
    }

    for (const call of fetchMock.mock.calls) {
      const params = Object.fromEntries(
        new URL((call as unknown as [string])[0]).searchParams,
      );
      expect(Object.keys(params).sort()).toEqual(["format", "limit", "q"]);
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  // Mutation: key the cache on the query alone: a name asked from Utah
  // answers from NSW's biased result.
  it("asks again when the same query is asked from a different region", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 600_000);
    const fetchMock = vi.fn(async () => new Response("[]"));
    vi.stubGlobal("fetch", fetchMock);
    const nsw = around(NSW_REGION.view.center);
    await geocode("Springfield", undefined, nsw);
    await geocode("springfield", undefined, nsw);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    await geocode("Springfield", undefined, OPEN_OCEAN);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentParams(fetchMock)).not.toHaveProperty("viewbox");
  });
});

describe("geocodeBias", () => {
  // Mutation: return the view itself, or any box when no region holds it.
  it("is the bounds of the region in view and nothing outside every region", () => {
    expect(geocodeBias(around(NSW_REGION.view.center))).toEqual(
      regionBounds(NSW_REGION),
    );
    expect(geocodeBias(OPEN_OCEAN)).toBeNull();
    expect(geocodeBias(null)).toBeNull();
    expect(geocodeBias(undefined)).toBeNull();
  });

  it("follows the region under the view's centre, not the view's size", () => {
    const [lon, lat] = SIM_NZ.view.center;
    expect(geocodeBias(around([lon, lat], 5), SIM_REGIONS)).toEqual(
      regionBounds(SIM_NZ),
    );
  });

  // Mutation: let the world entry through to regionBounds, which throws on a
  // region with no border.
  it("gives no box for the worldwide entry, which has no border", () => {
    expect(geocodeBias(OPEN_OCEAN, SIM_REGIONS, SIM_WORLD)).toBeNull();
  });
});
