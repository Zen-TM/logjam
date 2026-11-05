import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as maplibregl from "maplibre-gl";
import { ToastProvider } from "../feedback/ToastProvider";
import MapChrome from "./MapChrome";

afterEach(cleanup);

// Just enough of a loaded map for MapChrome's own effects.
const stubMap = {
  on() {},
  off() {},
  getBearing: () => 0,
  getZoom: () => 10,
  getMinZoom: () => 0,
  getMaxZoom: () => 20,
  getContainer: () => mapContainer,
} as unknown as maplibregl.Map;
// The element MapLibre draws in: a press on it is a press on the map.
const mapContainer = document.createElement("div");

function chrome(selectingArea = false, map: maplibregl.Map | null = null) {
  return render(
    <ToastProvider>
      <MapChrome
        map={map}
        geolocate={null}
        is3D={false}
        onToggle3D={() => {}}
        search={null}
        tools={[
          {
            id: "m",
            label: "Measure",
            icon: "add",
            onSelect() {},
          },
        ]}
        selectingArea={selectingArea}
      />
      <div data-testid="map" />
    </ToastProvider>,
  );
}

const tray = () => screen.queryByRole("group", { name: "Tools" });

describe("the Tools tray's light dismiss", () => {
  // Mutation: remove the `useOutsidePress` call in MapChrome.
  it("closes on a press outside, and stays open on one in the tray", async () => {
    chrome();
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: /^Measure/ }));
    expect(tray()).toBeTruthy();
    fireEvent.pointerDown(screen.getByTestId("map"));
    await waitFor(() => expect(tray()).toBeNull());
  });

  // Mutation: drop the fourth argument (`map?.getContainer()`) of
  // useOutsidePress in MapChrome, and a press on the map also reaches the map;
  // swallow every outside press, and the second case goes red.
  it("closes on a press on the map and the map hears nothing more", async () => {
    document.body.appendChild(mapContainer);
    const heard = vi.fn();
    mapContainer.addEventListener("click", heard);
    chrome(false, stubMap);
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    fireEvent.pointerDown(mapContainer);
    fireEvent.click(mapContainer);
    await waitFor(() => expect(tray()).toBeNull());
    expect(heard).not.toHaveBeenCalled();
    mapContainer.removeEventListener("click", heard);
    mapContainer.remove();
  });

  it("closes on a press on another control, which still acts", async () => {
    chrome(false, stubMap);
    const elsewhere = document.body.appendChild(
      document.createElement("button"),
    );
    const acted = vi.fn();
    elsewhere.addEventListener("click", acted);
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    fireEvent.pointerDown(elsewhere);
    fireEvent.click(elsewhere);
    await waitFor(() => expect(tray()).toBeNull());
    expect(acted).toHaveBeenCalledTimes(1);
    elsewhere.remove();
  });

  // Mutation: unmount the tray at once (drop `trayDrawn`), and it is gone
  // before the fade can show.
  it("is still drawn, inert, while it fades", () => {
    chrome();
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    fireEvent.pointerDown(screen.getByTestId("map"));
    expect(tray()?.hasAttribute("inert")).toBe(true);
  });
});

describe("the Tools button during an area selection", () => {
  // Mutation: drop `disabled={selectingArea}` from the Tools MapButton.
  it("is disabled, so no second tool starts over the selection", () => {
    chrome(true);
    const button = screen.getByRole("button", { name: "Tools" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(screen.queryByRole("group", { name: "Tools" })).toBeNull();
  });
});

describe("3D and the compass during an area selection", () => {
  // Mutation: drop `|| selectingArea` from the 3D terrain or Reset north
  // button's `disabled`; Map.tsx holds the map north-up and flat meanwhile.
  it("are disabled", () => {
    chrome(true, stubMap);
    for (const name of ["3D terrain", "Reset north"])
      expect(
        (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(true);
  });
});
