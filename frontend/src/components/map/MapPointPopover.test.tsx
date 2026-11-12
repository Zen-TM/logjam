import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAP_POINT,
  NSW_FIRE,
  WEATHER,
  type ElevationPoint,
  type FlowNetworkLookup,
} from "@logjam/shared";
import { takeDismissingPress } from "../../ui";
import forecastJson from "../../../../shared/src/__fixtures__/openMeteoForecast.json";
import { COVERAGE_FILL_LAYER, FIRE_FILL_LAYER } from "./layerOrder";
import MapPointPopover from "./MapPointPopover";

const placed = vi.hoisted(() => ({ order: [] as string[] }));
// Every marker put on the map, with its options and where it went.
const markers = vi.hoisted(
  () => [] as { options: Record<string, unknown>; at?: [number, number] }[],
);
vi.mock("maplibre-gl", () => ({
  Marker: class {
    entry: { options: Record<string, unknown>; at?: [number, number] };
    constructor(options: Record<string, unknown> = {}) {
      this.entry = { options };
      markers.push(this.entry);
    }
    setLngLat(at: [number, number]) {
      this.entry.at = at;
      return this;
    }
    addTo() {
      placed.order.push("marker");
      return this;
    }
    remove() {}
  },
}));
const terrain = vi.hoisted(() => ({
  checking: false,
  reading: {
    elevationM: 1013,
    slopeDegrees: null,
    demSourceIds: [],
  } as ElevationPoint | null,
}));
const flow = vi.hoisted(() => ({
  lookup: null as FlowNetworkLookup | null,
  error: null as string | null,
  loading: true,
}));
vi.mock("../../placeUtils", () => ({
  useElevationPoint: () => ({
    reading: terrain.checking ? null : terrain.reading,
    loading: terrain.checking,
  }),
  useFlowNetworkLookup: () => ({ ...flow }),
}));
const layers = vi.hoisted(() => ({ showSnap: vi.fn(), clearSnap: vi.fn() }));
vi.mock("./flowNetworkLayers", () => layers);
vi.mock("../../useIsMobile", () => ({ useIsMobile: () => false }));
const toast = vi.hoisted(() => ({ done: vi.fn(), error: vi.fn() }));
vi.mock("../feedback/ToastProvider", () => ({ useToast: () => toast }));

const point = { latitude: -33.71234, longitude: 150.31188 };
// The map's own element: a press on it is a press on the map.
const mapElement = document.createElement("div");
const map = {
  on: vi.fn(),
  off: vi.fn(),
  getContainer: () => mapElement,
  getCanvas: () => ({ focus: vi.fn() }),
  project: () => ({ x: 10, y: 20 }),
  getLayer: () => undefined,
};

function mount(
  handlers: {
    onAddPlace?: () => void;
    onClose?: () => void;
    onDrawRoute?: () => void;
    onShowUpstream?: () => void;
    startAt?: "options";
  } = {},
) {
  render(
    <MapPointPopover
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map={map as any}
      point={point}
      from={null}
      coverageCarrier="optus"
      {...(handlers.startAt ? { startAt: handlers.startAt } : {})}
      onClose={handlers.onClose ?? vi.fn()}
      onAddPlace={handlers.onAddPlace ?? vi.fn()}
      onMeasure={vi.fn()}
      onDrawRoute={handlers.onDrawRoute ?? vi.fn()}
      onShowUpstream={handlers.onShowUpstream ?? vi.fn()}
    />,
  );
}

/** The verbs are behind Options: open it, as a user does. */
function openOptions() {
  fireEvent.click(
    screen.getByRole("button", {
      name: MAP_POINT.copy.options,
      hidden: true,
    }),
  );
}

beforeEach(() => {
  document.body.appendChild(mapElement);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  // jsdom has no Popover API, and treats a closed `popover` as unrendered, so
  // nothing inside can take focus: showing it drops the attribute.
  Object.assign(HTMLElement.prototype, {
    showPopover(this: HTMLElement) {
      this.removeAttribute("popover");
    },
    hidePopover() {},
    togglePopover() {},
  });
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => {
  mapElement.remove();
  terrain.checking = false;
  terrain.reading = { elevationM: 1013, slopeDegrees: null, demSourceIds: [] };
  cleanup();
  flow.lookup = null;
  flow.error = null;
  flow.loading = true;
  layers.showSnap.mockClear();
  layers.clearSnap.mockClear();
  markers.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MapPointPopover weather", () => {
  // Mutation that turns it red: fetch when the popover opens, or close the
  // popover on the weather verb instead of swapping its body.
  it("fetches on the press, swaps the body in place and backs out to the facts", async () => {
    const fetch = vi.fn(async () => Response.json(forecastJson));
    vi.stubGlobal("fetch", fetch);
    mount();
    openOptions();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: WEATHER.copy.show, hidden: true }),
    );
    await act(async () => {});
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(WEATHER.copy.pastModel)).toBeTruthy();
    // The facts are gone while the forecast is up, and Back returns to Options.
    expect(screen.queryByText(MAP_POINT.copy.position)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Back to options", hidden: true }),
    );
    expect(screen.queryByText(WEATHER.copy.pastModel)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: MAP_POINT.copy.backToPoint,
        hidden: true,
      }),
    );
    expect(screen.getByText(MAP_POINT.copy.position)).toBeTruthy();
  });

  it("disables the verb offline and says why", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    mount();
    openOptions();
    const show = screen.getByRole("button", {
      name: WEATHER.copy.show,
      hidden: true,
    });
    expect((show as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(WEATHER.copy.needsConnection)).toBeTruthy();
    fireEvent.click(show);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("MapPointPopover weather, keyboard and height", () => {
  // Mutation that turns it red: drop the focus effect on `view`, or the
  // `checkingHeight` condition on the verb row.
  it("moves focus to Back on the way in and to the opened row on the way out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(forecastJson)),
    );
    mount();
    openOptions();
    const backToPoint = screen.getByRole("button", {
      name: MAP_POINT.copy.backToPoint,
      hidden: true,
    });
    expect(document.activeElement).toBe(backToPoint);
    fireEvent.click(
      screen.getByRole("button", { name: WEATHER.copy.show, hidden: true }),
    );
    await act(async () => {});
    const back = screen.getByRole("button", {
      name: "Back to options",
      hidden: true,
    });
    expect(document.activeElement).toBe(back);
    fireEvent.click(back);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: WEATHER.copy.show, hidden: true }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: MAP_POINT.copy.backToPoint,
        hidden: true,
      }),
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", {
        name: MAP_POINT.copy.options,
        hidden: true,
      }),
    );
  });

  it("holds the verb until the height is known, so the request carries one", () => {
    terrain.checking = true;
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    mount();
    openOptions();
    const show = screen.getByRole("button", {
      name: WEATHER.copy.show,
      hidden: true,
    });
    expect((show as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(show);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("the point popover's first paint", () => {
  // Mutation: add the marker in a plain effect (or in the parent), and the
  // panel measures its anchor before the dot is on the map: it opens in the
  // top left of the screen until something resizes it.
  it("puts the dot on the map before the panel measures where to open", () => {
    placed.order = [];
    const measure = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        // The anchor is the one detached div (the mocked marker never mounts it).
        if (this.tagName === "DIV" && this.parentElement === null)
          placed.order.push("measure");
        return new DOMRect();
      });
    mount();
    measure.mockRestore();
    expect(placed.order[0]).toBe("marker");
    expect(placed.order).toContain("measure");
  });
});

describe("the point popover's way out", () => {
  // Mutation: drop `suppressAskWithin` (or `dismissOnOutsidePress`) from the
  // panel, and the press that closes it also reaches the map, which asks about
  // a new point; stop the click, and a route or place under it no longer acts.
  it("closes on a press on the map and marks the click for the map, without stopping it", () => {
    const onClose = vi.fn();
    const heard = vi.fn();
    document.body.addEventListener("click", heard);
    mount({ onClose });
    fireEvent.pointerDown(mapElement);
    fireEvent.pointerUp(mapElement);
    fireEvent.click(mapElement);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(takeDismissingPress()).toBe(true);
    document.body.removeEventListener("click", heard);
  });

  // Mutation: let Escape close the panel from Options or the forecast, instead
  // of undoing one layer.
  it("undoes one layer per Escape: forecast, Options, facts, closed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(forecastJson)),
    );
    const onClose = vi.fn();
    mount({ onClose });
    const escape = () =>
      fireEvent.keyDown(screen.getByRole("dialog", { hidden: true }), {
        key: "Escape",
      });
    openOptions();
    fireEvent.click(
      screen.getByRole("button", { name: WEATHER.copy.show, hidden: true }),
    );
    await act(async () => {});
    expect(screen.queryByText(WEATHER.copy.pastModel)).toBeTruthy();
    escape();
    expect(screen.queryByText(WEATHER.copy.pastModel)).toBeNull();
    expect(
      screen.getByRole("button", { name: WEATHER.copy.show, hidden: true }),
    ).toBeTruthy();
    escape();
    expect(screen.getByText(MAP_POINT.copy.position)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    escape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("the point popover's panel", () => {
  // Mutation: draw a verb (or a Copy coordinates button) on the facts view
  // again, or put back the Close button.
  it("shows the facts and one Options button, and no Close", () => {
    mount();
    const names = screen
      .getAllByRole("button", { hidden: true })
      .map((button) => button.getAttribute("aria-label") ?? button.textContent);
    expect(names).toEqual([
      expect.stringMatching(/^Position: .*\. Copy$/),
      MAP_POINT.copy.options,
    ]);
  });

  it("holds the verbs behind Options, and no copy verb", () => {
    mount();
    openOptions();
    const names = screen
      .getAllByRole("button", { hidden: true })
      .map((button) => button.getAttribute("aria-label") ?? button.textContent);
    expect(names).toEqual([
      MAP_POINT.copy.backToPoint,
      expect.stringContaining("Draw a route from here"),
      expect.stringContaining("Add a place here"),
      expect.stringContaining("Measure from here"),
      expect.stringContaining(WEATHER.copy.show),
    ]);
  });

  it("hands a verb's point to its flow and closes", () => {
    const onAddPlace = vi.fn();
    const onClose = vi.fn();
    mount({ onAddPlace, onClose });
    openOptions();
    fireEvent.click(
      screen.getByRole("button", { name: /Add a place here/, hidden: true }),
    );
    expect(onAddPlace).toHaveBeenCalledWith(point);
    expect(onClose).toHaveBeenCalled();
  });

  // Mutation: draw the back arrow when the panel opened on Options (a
  // right-click), or let Escape step back to facts it never showed.
  it("opens on Options with no way back, and Escape closes it", () => {
    const onClose = vi.fn();
    mount({ startAt: "options", onClose });
    expect(
      screen.queryByRole("button", {
        name: MAP_POINT.copy.backToPoint,
        hidden: true,
      }),
    ).toBeNull();
    expect(screen.queryByText(MAP_POINT.copy.position)).toBeNull();
    expect(
      screen.getByRole("button", {
        name: /Draw a route from here/,
        hidden: true,
      }),
    ).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog", { hidden: true }), {
      key: "Escape",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hands Draw a route from here its point and closes", () => {
    const onDrawRoute = vi.fn();
    const onClose = vi.fn();
    mount({ onDrawRoute, onClose });
    openOptions();
    fireEvent.click(
      screen.getByRole("button", {
        name: /Draw a route from here/,
        hidden: true,
      }),
    );
    expect(onDrawRoute).toHaveBeenCalledWith(point);
    expect(onClose).toHaveBeenCalled();
  });

  // Mutation: copy from a separate button, or stop wiring `onCopy` to the
  // fact that is `copyable`.
  it("copies the coordinates when they are pressed", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    mount();
    fireEvent.click(
      screen.getByRole("button", {
        name: /^Position: .*\. Copy$/,
        hidden: true,
      }),
    );
    await act(async () => {});
    expect(writeText).toHaveBeenCalledWith("-33.71234, 150.31188");
    expect(toast.done).toHaveBeenCalledWith(MAP_POINT.copy.coordinatesCopied);
  });
});

describe("the point popover's slope", () => {
  // Mutation: stop passing `slopeDegrees` to `mapPointFacts`, and the first
  // case loses its Slope; show 0° for null, and the second gains one.
  it("shows Slope beside Elevation when the API has one", () => {
    terrain.reading = {
      elevationM: 412.4,
      slopeDegrees: 37.6,
      demSourceIds: [],
    };
    mount();
    expect(screen.getByText("Slope")).toBeTruthy();
    expect(screen.getByText("38°")).toBeTruthy();
    expect(screen.getByText("412 m")).toBeTruthy();
  });

  it("shows no Slope where the API has none", () => {
    terrain.reading = {
      elevationM: 412.4,
      slopeDegrees: null,
      demSourceIds: [],
    };
    mount();
    expect(screen.getByText("412 m")).toBeTruthy();
    expect(screen.queryByText("Slope")).toBeNull();
  });
});

describe("MapPointPopover fire history", () => {
  const fireFeature = {
    properties: {
      [NSW_FIRE.yearProperty]: 2019,
      [NSW_FIRE.monthProperty]: 12,
      [NSW_FIRE.typeProperty]: 1,
    },
  };

  // Mutation: stop passing `fire` to `mapPointFacts`, or read it with the
  // overlay off, and the figure goes missing or answers from nothing.
  it("shows the last burnt figure while the layer is on, and none when off", () => {
    const layered = map as unknown as Record<string, unknown>;
    layered.getLayer = (id: string) =>
      id === FIRE_FILL_LAYER ? {} : undefined;
    layered.queryRenderedFeatures = () => [fireFeature];
    mount();
    expect(screen.getByText(MAP_POINT.copy.fire)).toBeTruthy();
    expect(screen.getByText("Wildfire, Dec 2019")).toBeTruthy();
    cleanup();

    layered.getLayer = () => undefined;
    mount();
    expect(screen.queryByText(MAP_POINT.copy.fire)).toBeNull();
    delete layered.queryRenderedFeatures;
  });
});

describe("MapPointPopover coverage", () => {
  // Mutation: stop passing `coverage` to `mapPointFacts`, or name a carrier
  // other than the one the map draws, and the figure goes missing or answers
  // for the wrong network.
  it("names the drawn carrier's reception while the layer is on, and nothing when off", () => {
    const layered = map as unknown as Record<string, unknown>;
    layered.getLayer = (id: string) =>
      id === COVERAGE_FILL_LAYER ? {} : undefined;
    layered.queryRenderedFeatures = () => [
      { properties: { carrier: "optus", level: "none" } },
    ];
    mount();
    expect(screen.getByText(MAP_POINT.copy.coverage)).toBeTruthy();
    expect(screen.getByText("Optus: no mobile reception")).toBeTruthy();
    cleanup();

    layered.getLayer = () => undefined;
    mount();
    expect(screen.queryByText(MAP_POINT.copy.coverage)).toBeNull();
    delete layered.queryRenderedFeatures;
  });
});

const snapped = { latitude: -33.7123, longitude: 150.3119 };
const attribution = "credit";

const catchmentValue = () =>
  screen.getByText(MAP_POINT.copy.catchment).nextSibling?.textContent;
const upstreamVerb = () =>
  screen.queryByRole("button", {
    name: /Show the creeks upstream/,
    hidden: true,
  });

function found(over: Partial<FlowNetworkLookup & { status: "found" }> = {}) {
  flow.loading = false;
  flow.lookup = {
    status: "found",
    snapped,
    distanceM: 21,
    catchmentKm2: 4.23,
    streamOrder: 3,
    attribution,
    ...over,
  };
}

// Mutations that turn these red: leave the figure out of the panel, show a
// dash for "no creek" or "not built here yet", reword the API's sentence, or
// offer the creeks upstream of a point with no creek.
describe("What is here?: the catchment", () => {
  it("says it is checking until the lookup answers, with nothing upstream yet", () => {
    mount();
    expect(catchmentValue()).toBe("Checking…");
    expect(layers.showSnap).not.toHaveBeenCalled();
    openOptions();
    expect(upstreamVerb()).toBeNull();
  });

  it("shows the catchment, marks the creek point, and offers the creeks upstream", () => {
    found();
    const onShowUpstream = vi.fn();
    const onClose = vi.fn();
    mount({ onShowUpstream, onClose });
    expect(catchmentValue()).toContain("4.2 km²");
    // The order is a tag on the figure, said in full out loud.
    expect(screen.getByText("Stream order 3")).toBeTruthy();
    expect(layers.showSnap).toHaveBeenCalledWith(
      map,
      point,
      snapped,
      expect.any(String),
    );
    openOptions();
    fireEvent.click(upstreamVerb()!);
    expect(onShowUpstream).toHaveBeenCalledWith(point);
    // The map moves to fit the creeks, so the panel goes first.
    expect(onClose).toHaveBeenCalled();
  });

  // Mutation: draw the arrow at a fixed angle, or turn it with the screen
  // rather than the map, and it points somewhere the water does not run.
  it("marks the creek point with a drop, and an arrow the way the water runs", () => {
    found({ downstreamBearing: 120 });
    mount();
    const atCreek = markers.filter(
      (marker) => marker.at?.[0] === snapped.longitude,
    );
    expect(atCreek).toHaveLength(2);
    expect(atCreek.map((marker) => marker.options)).toContainEqual(
      expect.objectContaining({ rotation: 120, rotationAlignment: "map" }),
    );
  });

  it("leaves the arrow off when the API cannot tell which way", () => {
    found();
    mount();
    const atCreek = markers.filter(
      (marker) => marker.at?.[0] === snapped.longitude,
    );
    expect(atCreek).toHaveLength(1);
    expect(atCreek[0].options).not.toHaveProperty("rotation");
  });

  it("takes the creek point away with the panel", () => {
    found();
    mount();
    cleanup();
    expect(layers.clearSnap).toHaveBeenCalled();
  });

  it("mentions a much bigger creek in range", () => {
    found({ biggerNearby: { catchmentKm2: 14.2 } });
    mount();
    expect(
      screen.getByText("A creek draining 14 km² is also nearby."),
    ).toBeTruthy();
  });

  it("says when no creek is near, and offers nothing upstream", () => {
    flow.loading = false;
    flow.lookup = { status: "no-creek", attribution };
    mount();
    expect(catchmentValue()).toBe("No creek within 50 m");
    expect(layers.showSnap).not.toHaveBeenCalled();
    openOptions();
    expect(upstreamVerb()).toBeNull();
  });

  it("says when the point is outside what has been built so far", () => {
    flow.loading = false;
    flow.lookup = { status: "not-covered", attribution };
    mount();
    expect(catchmentValue()).toBe("Not covered yet");
    openOptions();
    expect(upstreamVerb()).toBeNull();
  });

  it("shows the API's sentence as it is when the lookup fails", () => {
    flow.loading = false;
    flow.error = "Too many requests. Wait a minute and try again.";
    mount();
    expect(catchmentValue()).toBe(
      "Too many requests. Wait a minute and try again.",
    );
    openOptions();
    expect(upstreamVerb()).toBeNull();
  });
});
