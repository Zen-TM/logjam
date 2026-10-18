import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAP_POINT, WEATHER, type ElevationPoint } from "@logjam/shared";
import forecastJson from "../../../../shared/src/__fixtures__/openMeteoForecast.json";
import MapPointPopover from "./MapPointPopover";

vi.mock("maplibre-gl", () => ({
  Marker: class {
    setLngLat() {
      return this;
    }
    addTo() {
      return this;
    }
    remove() {}
  },
}));
const terrain = vi.hoisted(() => ({
  checking: false,
  reading: { elevationM: 1013, slopeDegrees: null, demSourceIds: [] } as
    | ElevationPoint
    | null,
}));
vi.mock("../../placeUtils", () => ({
  useElevationPoint: () => ({
    reading: terrain.checking ? null : terrain.reading,
    loading: terrain.checking,
  }),
}));
vi.mock("../../useIsMobile", () => ({ useIsMobile: () => false }));
vi.mock("../feedback/ToastProvider", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const point = { latitude: -33.71234, longitude: 150.31188 };
const map = {
  on: vi.fn(),
  off: vi.fn(),
  getCanvas: () => ({ focus: vi.fn() }),
};

function mount() {
  render(
    <MapPointPopover
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map={map as any}
      point={point}
      from={null}
      onClose={vi.fn()}
      onAddPlace={vi.fn()}
      onMeasure={vi.fn()}
    />,
  );
}

beforeEach(() => {
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
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: WEATHER.copy.show, hidden: true }),
    );
    await act(async () => {});
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(WEATHER.copy.pastRain)).toBeTruthy();
    // The facts are gone while the forecast is up.
    expect(screen.queryByText(MAP_POINT.copy.position)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Back to this point", hidden: true }),
    );
    expect(screen.getByText(MAP_POINT.copy.position)).toBeTruthy();
    expect(screen.queryByText(WEATHER.copy.pastRain)).toBeNull();
  });

  it("disables the verb offline and says why", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    mount();
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
  it("moves focus to Back on the way in and to the weather row on the way out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(forecastJson)),
    );
    mount();
    fireEvent.click(
      screen.getByRole("button", { name: WEATHER.copy.show, hidden: true }),
    );
    await act(async () => {});
    const back = screen.getByRole("button", {
      name: "Back to this point",
      hidden: true,
    });
    expect(document.activeElement).toBe(back);
    fireEvent.click(back);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: WEATHER.copy.show, hidden: true }),
    );
  });

  it("holds the verb until the height is known, so the request carries one", () => {
    terrain.checking = true;
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    mount();
    const show = screen.getByRole("button", {
      name: WEATHER.copy.show,
      hidden: true,
    });
    expect((show as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(show);
    expect(fetch).not.toHaveBeenCalled();
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
