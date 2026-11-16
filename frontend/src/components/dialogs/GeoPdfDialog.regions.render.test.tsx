import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TERRAIN_LAYER_DEFAULTS } from "@logjam/shared";
import type { GeoPdfRenderInput } from "../../geoPdf/types";
import GeoPdfDialog from "./GeoPdfDialog";
import type { TBbox } from "../map/Map";
import { ToastProvider } from "../feedback/ToastProvider";

// The simulated regions are read once, when @logjam/shared loads, so the
// switch is set before the imports above run.
vi.hoisted(() => {
  (globalThis as { LOGJAM_SIM_REGIONS?: boolean }).LOGJAM_SIM_REGIONS = true;
});

vi.mock("../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../placeUtils")>()),
  apiFetch: vi.fn(async () => ({})),
}));
const renderGeoPdf = vi.hoisted(() => vi.fn());
vi.mock("./loadGeoPdfClient", () => ({
  loadGeoPdfClient: async () => ({
    renderGeoPdf,
    prefetchGeoPdf: vi.fn(),
  }),
}));
vi.mock("../../download", () => ({ downloadBlob: vi.fn() }));

// jsdom has no matchMedia, ResizeObserver, scrollIntoView or modal <dialog>.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);
Element.prototype.scrollIntoView = () => {};
vi.stubGlobal("matchMedia", (query: string) => ({
  matches: false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
}));
HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
  this.open = false;
};
Object.assign(HTMLElement.prototype, {
  showPopover(this: HTMLElement) {
    this.removeAttribute("popover");
  },
  hidePopover() {},
  togglePopover() {},
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  renderGeoPdf.mockReset();
  renderGeoPdf.mockResolvedValue({
    ok: true,
    pdf: new Blob(["%PDF"]),
    fileName: "logjam-geopdf.pdf",
  });
});

// Made-up places: Sydney, and the first simulated New Zealand box.
const SYDNEY = { lat: -33.87, lng: 151.21, zoom: 12 };
const MAKARORA = { lat: -44.055, lng: 169.25, zoom: 12 };
const NZ: TBbox = { north: -44.03, south: -44.08, east: 169.28, west: 169.22 };

function dialog(
  props: {
    activeLayerId?: string;
    mapCenter?: typeof SYDNEY;
    pendingExtent?: TBbox | null;
    onSelectOnMap?: (...args: unknown[]) => void;
  } = {},
) {
  return (
    <ToastProvider>
      <GeoPdfDialog
        open
        onClose={() => {}}
        onSelectOnMap={() => {}}
        pendingExtent={props.pendingExtent ?? null}
        pendingScale={props.pendingExtent ? 25000 : null}
        activeLayerId="six-topo"
        terrainLayers={TERRAIN_LAYER_DEFAULTS}
        completedTopoJobs={[]}
        slopeBands={[]}
        {...props}
      />
    </ToastProvider>
  );
}

const baseLayers = () =>
  screen
    .getAllByRole("radio")
    .map((radio) => radio.getAttribute("aria-label") ?? radio.textContent)
    .filter((name) => /^(OSM|SIX)/.test(name ?? ""));
const sent = () =>
  renderGeoPdf.mock.calls.map(([input]) => input as GeoPdfRenderInput);

describe("Make a map, over the ground the sheet covers", () => {
  // Mutation: list `PRINTABLE_BASE_LAYERS` whatever the ground
  // (`printableBaseLayersFor`), and the sheet over New Zealand lists the three
  // SIX maps that print nothing there.
  it("lists the base layers of the region the map is over", () => {
    render(dialog({ mapCenter: MAKARORA }));
    expect(baseLayers()).toEqual(["OSM Vector", "OSM Topo"]);
    cleanup();

    render(dialog({ mapCenter: SYDNEY }));
    expect(baseLayers()).toEqual([
      "OSM Vector",
      "OSM Topo",
      "SIX Maps Topo",
      "SIX Maps Base Map",
      "SIX Maps Imagery",
    ]);
  });

  // Mutation: set `selectedBaseLayer` to `pickedBaseLayer` unchecked, and a SIX
  // map picked over New South Wales is still printed once the area is moved to
  // New Zealand.
  it("prints from the ground's default once the area is moved where the pick is not offered", async () => {
    const { rerender } = render(dialog({ mapCenter: SYDNEY }));
    fireEvent.click(screen.getByRole("radio", { name: "SIX Maps Imagery" }));
    rerender(dialog({ mapCenter: SYDNEY, pendingExtent: NZ }));
    expect(baseLayers()).toEqual(["OSM Vector", "OSM Topo"]);
    fireEvent.click(screen.getByRole("button", { name: "Make it" }));
    await vi.waitFor(() => {
      expect(sent()).toHaveLength(1);
      expect(sent()[0]!.config.baseLayer).toBe("osm-topo");
    });
  });
});
