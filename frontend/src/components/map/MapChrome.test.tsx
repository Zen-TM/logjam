import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type * as maplibregl from "maplibre-gl";
import { ToastProvider } from "../feedback/ToastProvider";
import MapChrome from "./MapChrome";

afterEach(cleanup);

// Just enough of a loaded map for MapChrome's own effects.
const stubMap = {
  on() {},
  off() {},
  getContainer: () => document.createElement("div"),
  getBearing: () => 0,
  getZoom: () => 10,
  getMinZoom: () => 0,
  getMaxZoom: () => 20,
} as unknown as maplibregl.Map;

function chrome(selectingArea = false, map: maplibregl.Map | null = null) {
  return render(
    <ToastProvider>
      <MapChrome
        map={map}
        geolocate={null}
        is3D={false}
        onToggle3D={() => {}}
        search={null}
        tools={[{ id: "m", label: "Measure", icon: "add", onSelect() {} }]}
        selectingArea={selectingArea}
      />
      <div data-testid="map" />
    </ToastProvider>,
  );
}

describe("the Tools tray's light dismiss", () => {
  // Mutation: remove the `useOutsidePress` call in MapChrome.
  it("closes on a press outside, and stays open on one in the tray", () => {
    chrome();
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Measure" }));
    expect(screen.queryByRole("group", { name: "Tools" })).toBeTruthy();
    fireEvent.pointerDown(screen.getByTestId("map"));
    expect(screen.queryByRole("group", { name: "Tools" })).toBeNull();
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
