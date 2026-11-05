import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAP_POINT, WEATHER, type ElevationPoint } from "@logjam/shared";
import { takeDismissingPress } from "../../ui";
import forecastJson from "../../../../shared/src/__fixtures__/openMeteoForecast.json";
import MapPointPopover from "./MapPointPopover";

const placed = vi.hoisted(() => ({ order: [] as string[] }));
vi.mock("maplibre-gl", () => ({
  Marker: class {
    setLngLat() {
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
vi.mock("../../placeUtils", () => ({
  useElevationPoint: () => ({
    reading: terrain.checking ? null : terrain.reading,
    loading: terrain.checking,
  }),
}));
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
    startAt?: "options";
  } = {},
) {
  render(
    <MapPointPopover
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map={map as any}
      point={point}
      from={null}
      {...(handlers.startAt ? { startAt: handlers.startAt } : {})}
      onClose={handlers.onClose ?? vi.fn()}
      onAddPlace={handlers.onAddPlace ?? vi.fn()}
      onMeasure={vi.fn()}
      onDrawRoute={handlers.onDrawRoute ?? vi.fn()}
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
