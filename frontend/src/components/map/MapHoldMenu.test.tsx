import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAP_POINT, mapHoldVerbs } from "@logjam/shared";
import MapHoldMenu from "./MapHoldMenu";

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
vi.mock("../../useIsMobile", () => ({ useIsMobile: () => false }));

const point = { latitude: -33.71234, longitude: 150.31188 };
const map = {
  on: vi.fn(),
  off: vi.fn(),
  getCanvas: () => ({ focus: vi.fn() }),
};

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.assign(HTMLElement.prototype, {
    showPopover(this: HTMLElement) {
      this.removeAttribute("popover");
    },
    hidePopover() {},
    togglePopover() {},
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MapHoldMenu", () => {
  // Mutation that turns it red: draw `mapPointVerbs("web")` (the tap panel's
  // list) or a literal label here, and the menu stops equalling the hold.
  it("draws the contract's hold verbs for Logjam Web, in order, and runs one", () => {
    const run = { addPlace: vi.fn(), measure: vi.fn() };
    const onClose = vi.fn();
    render(
      <MapHoldMenu
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map={map as any}
        point={point}
        onClose={onClose}
        run={run}
      />,
    );
    const names = screen
      .getAllByRole("button", { hidden: true })
      .map((button) => button.textContent)
      .filter((name) => name);
    expect(names).toEqual(mapHoldVerbs("web").map((verb) => verb.label));
    expect(
      screen.getByRole("dialog", { hidden: true }).getAttribute("aria-label"),
    ).toBe(MAP_POINT.copy.holdTitle);
    fireEvent.click(
      screen.getByRole("button", { name: "Add a place here", hidden: true }),
    );
    expect(run.addPlace).toHaveBeenCalledWith(point);
    expect(run.measure).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
