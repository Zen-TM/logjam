import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ToastProvider } from "../feedback/ToastProvider";
import MapChrome from "./MapChrome";

afterEach(cleanup);

function chrome(toolsDisabled = false) {
  return render(
    <ToastProvider>
      <MapChrome
        map={null}
        geolocate={null}
        is3D={false}
        onToggle3D={() => {}}
        search={null}
        tools={[{ id: "m", label: "Measure", icon: "add", onSelect() {} }]}
        toolsDisabled={toolsDisabled}
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
  // Mutation: drop `disabled={toolsDisabled}` from the Tools MapButton.
  it("is disabled, so no second tool starts over the selection", () => {
    chrome(true);
    const button = screen.getByRole("button", { name: "Tools" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(screen.queryByRole("group", { name: "Tools" })).toBeNull();
  });
});
