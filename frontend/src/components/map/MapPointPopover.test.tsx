import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as maplibregl from "maplibre-gl";
import { MAP_POINT, type FlowNetworkLookup } from "@logjam/shared";

const flow = vi.hoisted(() => ({
  lookup: null as FlowNetworkLookup | null,
  error: null as string | null,
  loading: true,
}));
vi.mock("../../placeUtils", () => ({
  useElevationProfile: () => ({ profile: null, loading: true, error: null }),
  useFlowNetworkLookup: () => ({ ...flow }),
}));
vi.mock("../../useIsMobile", () => ({ useIsMobile: () => false }));
vi.mock("../feedback/ToastProvider", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
const markers = vi.hoisted(
  () => [] as { options: Record<string, unknown>; at?: [number, number] }[],
);
vi.mock("maplibre-gl", () => ({
  Marker: class {
    entry: { options: Record<string, unknown>; at?: [number, number] };
    constructor(options: Record<string, unknown>) {
      this.entry = { options };
      markers.push(this.entry);
    }
    setLngLat(at: [number, number]) {
      this.entry.at = at;
      return this;
    }
    addTo() {
      return this;
    }
    remove() {}
  },
}));
const layers = vi.hoisted(() => ({ showSnap: vi.fn(), clearSnap: vi.fn() }));
vi.mock("./flowNetworkLayers", () => layers);
// The kit's popover is drawn in the browser's top layer, which jsdom lacks;
// what is under test is what goes in it.
vi.mock("../../ui", async (original) => ({
  ...(await original<typeof import("../../ui")>()),
  Popover: ({ label, children }: { label: string; children: ReactNode }) => (
    <section role="dialog" aria-label={label}>
      {children}
    </section>
  ),
}));

import MapPointPopover from "./MapPointPopover";

afterEach(() => {
  cleanup();
  flow.lookup = null;
  flow.error = null;
  flow.loading = true;
  layers.showSnap.mockClear();
  layers.clearSnap.mockClear();
  markers.length = 0;
});

const point = { latitude: -33.6, longitude: 150.3 };
const snapped = { latitude: -33.6002, longitude: 150.3001 };
const attribution = "credit";

function draw() {
  const map = {
    on: vi.fn(),
    off: vi.fn(),
    getCanvas: () => ({ focus: vi.fn() }),
  } as unknown as maplibregl.Map;
  const props = {
    onClose: vi.fn(),
    onAddPlace: vi.fn(),
    onMeasure: vi.fn(),
    onShowUpstream: vi.fn(),
  };
  render(<MapPointPopover map={map} point={point} from={null} {...props} />);
  return { map, ...props };
}

const catchmentValue = () =>
  screen.getByText(MAP_POINT.copy.catchment).nextSibling?.textContent;
const upstreamVerb = () =>
  screen.queryByRole("button", { name: "Show the creeks upstream" });

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
    draw();
    expect(catchmentValue()).toBe("Checking…");
    expect(upstreamVerb()).toBeNull();
    expect(layers.showSnap).not.toHaveBeenCalled();
  });

  it("shows the catchment, marks the creek point, and offers the creeks upstream", () => {
    found();
    const { map, onShowUpstream, onClose } = draw();
    expect(catchmentValue()).toContain("4.2 km²");
    // The order is a tag on the figure, said in full out loud.
    expect(screen.getByText("Stream order 3")).toBeTruthy();
    expect(layers.showSnap).toHaveBeenCalledWith(
      map,
      point,
      snapped,
      expect.any(String),
    );
    fireEvent.click(upstreamVerb()!);
    expect(onShowUpstream).toHaveBeenCalledWith(point);
    // The map moves to fit the creeks, so the panel goes first.
    expect(onClose).toHaveBeenCalled();
  });

  // Mutation: draw the arrow at a fixed angle, or turn it with the screen
  // rather than the map, and it points somewhere the water does not run.
  it("marks the creek point with a drop, and an arrow the way the water runs", () => {
    found({ downstreamBearing: 120 });
    draw();
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
    draw();
    const atCreek = markers.filter(
      (marker) => marker.at?.[0] === snapped.longitude,
    );
    expect(atCreek).toHaveLength(1);
    expect(atCreek[0].options).not.toHaveProperty("rotation");
  });

  it("takes the creek point away with the panel", () => {
    found();
    draw();
    cleanup();
    expect(layers.clearSnap).toHaveBeenCalled();
  });

  it("mentions a much bigger creek in range", () => {
    found({ biggerNearby: { catchmentKm2: 14.2 } });
    draw();
    expect(
      screen.getByText("A creek draining 14 km² is also nearby."),
    ).toBeTruthy();
  });

  it("says when no creek is near, and offers nothing upstream", () => {
    flow.loading = false;
    flow.lookup = { status: "no-creek", attribution };
    draw();
    expect(catchmentValue()).toBe("No creek within 50 m");
    expect(upstreamVerb()).toBeNull();
    expect(layers.showSnap).not.toHaveBeenCalled();
  });

  it("says when the point is outside what has been built so far", () => {
    flow.loading = false;
    flow.lookup = { status: "not-covered", attribution };
    draw();
    expect(catchmentValue()).toBe("Not covered yet");
    expect(upstreamVerb()).toBeNull();
  });

  it("shows the API's sentence as it is when the lookup fails", () => {
    flow.loading = false;
    flow.error = "Too many requests. Wait a minute and try again.";
    draw();
    expect(catchmentValue()).toBe(
      "Too many requests. Wait a minute and try again.",
    );
    expect(upstreamVerb()).toBeNull();
  });
});
