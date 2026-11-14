import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TERRAIN_LAYER_DEFAULTS } from "@logjam/shared";
import { ToastProvider } from "../feedback/ToastProvider";
import LayersPopover from "./LayersPopover";

// The simulated regions are read once, when @logjam/shared loads, so the
// switch is set before the imports above run.
vi.hoisted(() => {
  (globalThis as Record<string, unknown>).LOGJAM_SIM_REGIONS = true;
});

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

const SYDNEY = { lng: 151.2, lat: -33.87, zoom: 12 };
const WANAKA = { west: 169.0, south: -44.7, east: 169.2, north: -44.5 };

function popover(
  mapView: typeof SYDNEY | null,
  mapBounds: typeof WANAKA | null,
) {
  const noop = vi.fn();
  return (
    <ToastProvider>
      <LayersPopover
        open
        onClose={noop}
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
        mapView={mapView}
        mapBounds={mapBounds}
        onImportFile={noop}
        startView={null}
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

const showOverlays = () =>
  fireEvent.click(screen.getByRole("radio", { name: /^Overlays/ }));

// The grid lines are drawn from the bounds' middle, so the row is named from
// it: a pitched map near a region's border reports a centre that is not the
// middle of the ground it shows.
// Mutation: name the row from `mapView`'s centre in LayersPopover, and a view
// centred in Sydney reads "MGA grid" over New Zealand's ground.
describe("the Layers popover's grid row", () => {
  it("is named for the grid of the ground the map's bounds cover", () => {
    render(popover(SYDNEY, WANAKA));
    showOverlays();
    expect(screen.getByText("NZTM grid")).toBeTruthy();
    expect(screen.queryByText("MGA grid")).toBeNull();
  });

  // Mutation: read `mapView` when there are no bounds, and "NZTM grid" names a
  // view nothing has reported yet.
  it("names the first region's grid until the map reports its bounds", () => {
    render(popover({ ...SYDNEY, lng: 169.1, lat: -44.6 }, null));
    showOverlays();
    expect(screen.getByText("MGA grid")).toBeTruthy();
  });
});
