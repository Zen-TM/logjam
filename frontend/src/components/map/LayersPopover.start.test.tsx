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

function popover(open: boolean, startView: Start) {
  const noop = vi.fn();
  return (
    <ToastProvider>
      <LayersPopover
        open={open}
        onClose={noop}
        anchorRef={createRef<HTMLElement>()}
        showPlaces
        setShowPlaces={noop}
        showWays
        setShowWays={noop}
        placeCount={0}
        wayCount={0}
        completedTopoJobs={[]}
        baseLayers={[]}
        activeLayerId="protomaps"
        onActiveLayerChange={noop}
        terrainLayers={TERRAIN_LAYER_DEFAULTS}
        onTerrainLayerChange={noop}
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
  it("reopens on Overlays however it was closed", () => {
    const start = { view: "sharpened" } as const;
    const { rerender } = render(popover(false, null));
    rerender(popover(true, start));
    rerender(popover(false, start));
    rerender(popover(true, start));
    expect(onSharpened()).toBeNull();
  });
});
