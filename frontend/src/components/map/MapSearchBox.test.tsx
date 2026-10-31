import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PLACE_REGISTRY_ATTRIBUTION,
  PLACE_SEARCH_DEBOUNCE_MS,
  type PlaceResult,
} from "@logjam/shared";
import { ApiError } from "../../errors/ApiError";
import type { TPlace } from "../../placeUtils";
import MapSearchBox from "./MapSearchBox";

const { geocode } = vi.hoisted(() => ({ geocode: vi.fn(async () => []) }));
vi.mock("@logjam/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@logjam/shared")>()),
  geocode,
}));

const { searchPlaceRegistry } = vi.hoisted(() => ({
  searchPlaceRegistry: vi.fn(),
}));
vi.mock("../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../placeUtils")>()),
  searchPlaceRegistry,
}));

const { gaugeFile } = vi.hoisted(() => ({
  gaugeFile: {
    current: null as { gauges: Record<string, unknown>[] } | null,
  },
}));
vi.mock("../gauges/useGauges", () => ({
  useGauges: () => ({ file: gaugeFile.current, failed: false, now: 0 }),
}));

const FALLS: PlaceResult = {
  name: "Katoomba Falls",
  kind: "Waterfall",
  near: "Katoomba",
  lon: 150.307,
  lat: -33.73,
};

beforeEach(() => {
  vi.useFakeTimers();
  searchPlaceRegistry.mockResolvedValue({
    results: [FALLS],
    version: "2026-10-01",
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  geocode.mockClear();
  searchPlaceRegistry.mockReset();
});

function renderBox(
  props: Partial<Parameters<typeof MapSearchBox>[0]> = {},
): HTMLElement {
  render(
    <MapSearchBox
      places={[]}
      sharedPlaces={[]}
      onSelectPlace={() => {}}
      onSelectGauge={() => {}}
      onSelectLocation={() => {}}
      {...props}
    />,
  );
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  return input;
}

const type = (input: HTMLElement, value: string) =>
  fireEvent.change(input, { target: { value } });

/** Past the debounce, with the answer's promise settled. */
const settle = () =>
  act(() => vi.advanceTimersByTimeAsync(PLACE_SEARCH_DEBOUNCE_MS));

describe("MapSearchBox", () => {
  // Mutation: match the raw name, or leave `gaugeOptions` out of the list.
  it("finds a gauge by its readable name, and hands it back", async () => {
    gaugeFile.current = {
      gauges: [
        { id: "900001", name: "MADE UP R @ ONE" },
        { id: "900002", name: "OTHER CK @ TWO" },
      ],
    };
    const onSelectGauge = vi.fn();
    const input = renderBox({ onSelectGauge });
    type(input, "made up river");
    await settle();
    const option = screen.getByRole("option", {
      name: "Made Up River at One, River gauge",
    });
    expect(screen.queryByText("Other Creek at Two")).toBeNull();
    fireEvent.pointerDown(option);
    expect(onSelectGauge.mock.calls[0]?.[0]).toMatchObject({ id: "900001" });
    gaugeFile.current = null;
  });

  // Mutation: start the geocode effect from the query instead of from
  // `locationQuery`, which only "Search locations for …" sets.
  it("sends a query to the public geocoder only when the user asks it to", async () => {
    const input = renderBox();
    for (const typed of ["Hi", "Hidden", "Hidden Gorge"]) type(input, typed);
    await settle();
    expect(geocode).not.toHaveBeenCalled();

    fireEvent.pointerDown(
      screen.getByRole("option", { name: /Search locations for/ }),
    );
    expect(geocode).toHaveBeenCalledOnce();
    expect(geocode).toHaveBeenCalledWith("Hidden Gorge", expect.anything());
  });

  // Mutation: drop the timeout (a request per keystroke), or the abort in the
  // effect's cleanup, and this goes red.
  it("asks the registry once typing pauses, aborting the request before", async () => {
    const input = renderBox();
    type(input, "K");
    type(input, "Ka");
    type(input, "Kat");
    await act(() => vi.advanceTimersByTimeAsync(PLACE_SEARCH_DEBOUNCE_MS - 1));
    expect(searchPlaceRegistry).not.toHaveBeenCalled();
    await settle();
    expect(searchPlaceRegistry).toHaveBeenCalledOnce();
    expect(searchPlaceRegistry).toHaveBeenLastCalledWith(
      "Kat",
      expect.any(Number),
      expect.any(AbortSignal),
    );

    const first = searchPlaceRegistry.mock.calls[0][2] as AbortSignal;
    type(input, "Kato");
    expect(first.aborted).toBe(true);
    await settle();
    expect(searchPlaceRegistry).toHaveBeenCalledTimes(2);
    expect(searchPlaceRegistry).toHaveBeenLastCalledWith(
      "Kato",
      expect.any(Number),
      expect.any(AbortSignal),
    );
  });

  // Mutation: list the registry before the user's places, or after the
  // geocoder row, or drop the registry row's aria-label, and this goes red.
  it("lists your places, then the registry, then the geocoder row", async () => {
    const onSelectLocation = vi.fn();
    const input = renderBox({
      places: [
        {
          id: "p1",
          name: "Katoomba camp",
          altNames: [],
        } as unknown as TPlace,
      ],
      onSelectLocation,
    });
    type(input, "Katoomba");
    await settle();
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual([
      "Katoomba camp",
      "Katoomba FallsWaterfall near Katoomba",
      "Search locations for “Katoomba”",
    ]);
    expect(screen.getByText(PLACE_REGISTRY_ATTRIBUTION)).toBeTruthy();

    // Said as one phrase, in the words Logjam GPS uses (placeResultDetail).
    const falls = screen.getByRole("option", {
      name: "Katoomba Falls, Waterfall near Katoomba",
    });
    fireEvent.pointerDown(falls);
    expect(onSelectLocation).toHaveBeenCalledWith(FALLS.lat, FALLS.lon);
  });

  // Mutation: stop clearing the answer in `reset` and this goes red; drop
  // the `startsWith` check and the next one does.
  it("never shows an answer for another query", async () => {
    const input = renderBox();
    type(input, "Katoomba");
    await settle();
    fireEvent.pointerDown(screen.getByRole("option", { name: /Falls/ }));

    fireEvent.focus(input);
    type(input, "Wollangambe");
    expect(screen.queryByRole("option", { name: /Katoomba Falls/ })).toBeNull();
    // Picking ended that search: its answer is gone even for a query that
    // extends it.
    type(input, "Katoomba F");
    expect(screen.queryByRole("option", { name: /Katoomba Falls/ })).toBeNull();
  });

  it("keeps an answer while the query only grows, and no further", async () => {
    const input = renderBox();
    type(input, "Kat");
    await settle();
    type(input, "Kato");
    expect(screen.getByRole("option", { name: /Katoomba Falls/ })).toBeTruthy();
    type(input, "Wollangambe");
    expect(screen.queryByRole("option", { name: /Katoomba Falls/ })).toBeNull();
  });

  // Mutation: reset the highlight when an answer lands and this goes red.
  it("keeps the highlight on your own place when an answer lands", async () => {
    const input = renderBox({
      places: [
        { id: "p1", name: "Katoomba camp", altNames: [] } as unknown as TPlace,
      ],
    });
    type(input, "Katoomba");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    await settle();
    expect(
      screen.getByRole("option", { name: "Katoomba camp" }).ariaSelected,
    ).toBe("true");
  });

  it("says why when the registry search fails, and keeps working", async () => {
    searchPlaceRegistry.mockRejectedValue(
      new ApiError(
        503,
        "/places/search",
        "POST",
        "Location search isn't available right now. Try again in a few minutes.",
      ),
    );
    const input = renderBox();
    type(input, "Katoomba");
    await settle();
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Search locations for “Katoomba”"]);
    expect(screen.getByRole("status").textContent).toBe(
      "Location search isn't available right now. Try again in a few minutes.",
    );
  });
});
