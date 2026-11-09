import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TERRAIN_LAYER_DEFAULTS } from "@logjam/shared";
import { ToastProvider } from "../feedback/ToastProvider";
import LayersPopover from "./LayersPopover";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);
Element.prototype.scrollIntoView = () => {};
Object.assign(HTMLElement.prototype, {
  showPopover(this: HTMLElement) {
    this.removeAttribute("popover");
  },
  hidePopover() {},
  togglePopover() {},
});

afterEach(cleanup);

type Start = { view: "sharpened" } | null;

function popover(
  open: boolean,
  startView: Start,
  onClose: () => void = vi.fn(),
) {
  const noop = vi.fn();
  return (
    <ToastProvider>
      <LayersPopover
        open={open}
        onClose={onClose}
        anchorRef={createRef<HTMLElement>()}
        showPlaces
        setShowPlaces={noop}
        showWays
        setShowWays={noop}
        showGauges={false}
        setShowGauges={noop}
        showMgaGrid={false}
        setShowMgaGrid={noop}
        placeCount={0}
        wayCount={0}
        completedTopoJobs={[]}
        baseLayers={[]}
        activeLayerId="protomaps"
        onActiveLayerChange={noop}
        terrainLayers={TERRAIN_LAYER_DEFAULTS}
        onTerrainLayerChange={noop}
        coverageCarrier="telstra"
        onCoverageCarrierChange={noop}
        slopeBands={[]}
        onSlopeBandsChange={noop}
        mapView={null}
        onImportFile={noop}
        startView={startView}
        sharpenedLoaded
        activeTopoJobs={[]}
        friends={[]}
        onSharpen={noop}
        onExportArea={noop}
        onFlyToArea={noop}
        onRefetchCompletedTopoJobs={noop}
        onDismissActiveJob={noop}
        onQuotaChanged={noop}
      />
    </ToastProvider>
  );
}

const chip = (name: string) =>
  screen.getByRole("radio", { name: new RegExp(`^${name}`) });

const onSharpened = () =>
  screen.queryByRole("button", { name: "Back to terrain" });

describe("the Layers popover's start view", () => {
  it("opens on the sharpened areas when asked", () => {
    const { rerender } = render(popover(false, null));
    rerender(popover(true, { view: "sharpened" }));
    expect(onSharpened()).toBeTruthy();
  });

  // Mutation: compare the request by value, and a second Show after Back
  // finds nothing new to navigate to.
  it("navigates again on a repeat request after Back", () => {
    const { rerender } = render(popover(false, null));
    rerender(popover(true, { view: "sharpened" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to terrain" }));
    expect(onSharpened()).toBeNull();
    rerender(popover(true, { view: "sharpened" }));
    expect(onSharpened()).toBeTruthy();
  });

  // Mutation: reset the view only in `close()`, and closing with the Layers
  // button (which flips `open` itself) reopens on the sharpened areas.
  it("reopens a sub-view on its tab however it was closed", () => {
    const start = { view: "sharpened" } as const;
    const { rerender } = render(popover(false, null));
    rerender(popover(true, start));
    rerender(popover(false, start));
    rerender(popover(true, start));
    expect(onSharpened()).toBeNull();
    expect(chip("Terrain").getAttribute("aria-checked")).toBe("true");
  });
});

describe("the Layers popover's last tab", () => {
  // Mutation: start `view` on "overlays" in LayersPopover, and the first open
  // is not on Map (as Logjam GPS's sheet is).
  it("opens on Map the first time", () => {
    render(popover(true, null));
    expect(chip("Map").getAttribute("aria-checked")).toBe("true");
  });

  // Mutation: reset the view to "overlays" when the popover closes (the old
  // behaviour), and it reopens on the first tab instead of the last one used.
  it.each(["Map", "Terrain"])(
    "reopens on %s after the Layers button closes it",
    (tab) => {
      const { rerender } = render(popover(true, null));
      fireEvent.click(chip(tab));
      expect(chip(tab).getAttribute("aria-checked")).toBe("true");
      rerender(popover(false, null));
      rerender(popover(true, null));
      expect(chip(tab).getAttribute("aria-checked")).toBe("true");
    },
  );

  it("reopens on the tab after the in-popover close too", () => {
    const { rerender } = render(popover(true, null));
    fireEvent.click(chip("Map"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    rerender(popover(false, null));
    rerender(popover(true, null));
    expect(chip("Map").getAttribute("aria-checked")).toBe("true");
  });
});

describe("the Layers popover's light dismiss", () => {
  // Mutation: drop `dismissOnOutsidePress` from the Popover in LayersPopover.
  it("closes on a press outside it, not on one inside", () => {
    const onClose = vi.fn();
    render(popover(true, null, onClose));
    fireEvent.pointerDown(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("the Layers popover's overlays", () => {
  // Mutation: list the overlay rows in OVERLAY_TERRAIN_KEYS (stacking) order,
  // and Fire history comes above Land tenure, against the contract.
  it("lists each statewide overlay once, in the contract's order", () => {
    render(popover(true, null));
    fireEvent.click(chip("Overlays"));
    const names = screen
      .getAllByRole("switch")
      .map((s) => s.getAttribute("aria-label"))
      .filter((n) => n === "Show land tenure" || n === "Show fire history");
    expect(names).toEqual(["Show land tenure", "Show fire history"]);
  });
});
