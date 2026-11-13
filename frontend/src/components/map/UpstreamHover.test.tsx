import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpstreamHover } from "./UpstreamHover";

// The tip is a marker: where it went, and whether it is on the map.
const tip = vi.hoisted(() => ({ on: false, at: null as unknown }));
vi.mock("maplibre-gl", () => ({
  Marker: class {
    element: HTMLElement;
    constructor({ element }: { element: HTMLElement }) {
      this.element = element;
    }
    setLngLat(at: unknown) {
      tip.at = at;
      return this;
    }
    addTo() {
      tip.on = true;
      document.body.appendChild(this.element);
      return this;
    }
    remove() {
      tip.on = false;
      this.element.remove();
      return this;
    }
  },
}));

const PIN = "place-circles";

/** A map whose rendered features under the pointer each test sets. */
function fakeMap({
  creeks = [] as number[],
  onPin = false,
}: {
  creeks?: number[];
  onPin?: boolean;
} = {}) {
  const canvas = document.createElement("canvas");
  let onMove: ((event: unknown) => void) | null = null;
  const asked: unknown[] = [];
  const map = {
    canvas,
    asked,
    getCanvas: () => canvas,
    getLayer: () => ({}),
    on: (_: string, handler: (event: unknown) => void) => {
      onMove = handler;
    },
    off: vi.fn(),
    queryRenderedFeatures: (
      geometry: unknown,
      { layers }: { layers: string[] },
    ) => {
      if (layers.includes(PIN)) return onPin ? [{ properties: {} }] : [];
      asked.push(geometry);
      return creeks.map((catchmentKm2) => ({ properties: { catchmentKm2 } }));
    },
    move: (x: number, y: number) =>
      act(() => onMove!({ point: { x, y }, lngLat: { lng: 150, lat: -33 } })),
  };
  return map;
}

function mount(map: ReturnType<typeof fakeMap>, armed = () => false) {
  render(
    <UpstreamHover
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      map={map as any}
      pressable={[PIN]}
      armed={armed}
    />,
  );
}

afterEach(() => {
  cleanup();
  tip.on = false;
  tip.at = null;
});

describe("the figure over a creek upstream", () => {
  // Mutation: query the pointer's own pixel, and a one-pixel hairline is
  // all but impossible to point at.
  it("gives the pointer a few pixels of slack either side", () => {
    const map = fakeMap({ creeks: [1.2] });
    mount(map);
    map.move(100, 50);
    expect(map.asked).toEqual([
      [
        [96, 46],
        [104, 54],
      ],
    ]);
    expect(screen.getByText("1.2 km²")).toBeTruthy();
    expect(tip.on).toBe(true);
    expect(map.canvas.style.cursor).toBe("pointer");
  });

  // Mutation: take the first feature under the pointer, and at a junction the
  // tip names a tributary while the trunk is the line drawn on top.
  it("names the biggest creek under the pointer at a junction", () => {
    const map = fakeMap({ creeks: [1.2, 14.2, 0.3] });
    mount(map);
    map.move(10, 10);
    expect(screen.getByText("14 km²")).toBeTruthy();
  });

  // Mutation: test the creeks before the pins, and a pin on a creek shows a
  // figure and loses its own cursor.
  it("gives way to a pin under the pointer", () => {
    const map = fakeMap({ creeks: [3], onPin: true });
    mount(map);
    map.canvas.style.cursor = "grab";
    map.move(10, 10);
    expect(screen.queryByText("3.0 km²")).toBeNull();
    expect(tip.on).toBe(false);
    expect(map.canvas.style.cursor).toBe("grab");
  });

  // Mutation: drop the `armed` check, and a route being drawn over the creeks
  // gets a figure chasing the pen.
  it("stays out of the way while a tool owns the pointer", () => {
    const map = fakeMap({ creeks: [3] });
    mount(map, () => true);
    map.move(10, 10);
    expect(screen.queryByText("3.0 km²")).toBeNull();
    expect(tip.on).toBe(false);
  });

  it("goes when the pointer leaves the creeks", () => {
    const map = fakeMap({ creeks: [3] });
    mount(map);
    map.move(10, 10);
    expect(screen.getByText("3.0 km²")).toBeTruthy();
    map.asked.length = 0;
    const empty = fakeMap();
    Object.assign(map, { queryRenderedFeatures: empty.queryRenderedFeatures });
    map.move(30, 30);
    expect(screen.queryByText("3.0 km²")).toBeNull();
    expect(tip.on).toBe(false);
    expect(map.canvas.style.cursor).toBe("");
  });
});
