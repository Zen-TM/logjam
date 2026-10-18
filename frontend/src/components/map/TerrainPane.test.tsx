import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAP_TERRAIN, TERRAIN_LAYER_DEFAULTS } from "@logjam/shared";
import { TerrainPane } from "./LayersPopover";

afterEach(cleanup);

const copy = MAP_TERRAIN.copy;

function draw(activeLayerId = "protomaps") {
  const props = {
    layers: TERRAIN_LAYER_DEFAULTS,
    onChange: vi.fn(),
    activeLayerId,
    onOpenSlopeBands: vi.fn(),
  };
  render(<TerrainPane {...props} />);
  return props;
}

describe("the Terrain group on Logjam Web", () => {
  it("lists contours, slope and hillshade in the contract's order", () => {
    draw();
    expect(screen.getAllByRole("switch")).toHaveLength(3);
    const text = document.body.textContent ?? "";
    expect(text.indexOf(copy.contours)).toBeLessThan(text.indexOf(copy.slope));
    expect(text.indexOf(copy.slope)).toBeLessThan(text.indexOf(copy.hillshade));
  });

  it("switches each layer by its key", () => {
    const props = draw();
    fireEvent.click(screen.getByRole("switch", { name: "Show slope" }));
    expect(props.onChange).toHaveBeenCalledWith("slope", true);
    fireEvent.click(screen.getByRole("switch", { name: copy.hillshade }));
    expect(props.onChange).toHaveBeenCalledWith("hillshade", true);
    fireEvent.click(screen.getByRole("switch", { name: copy.contours }));
    expect(props.onChange).toHaveBeenCalledWith("contours", false);
  });

  it("opens the slope bands from the Slope row", () => {
    const props = draw();
    fireEvent.click(screen.getByRole("button", { name: copy.slopeBands }));
    expect(props.onOpenSlopeBands).toHaveBeenCalled();
  });

  // Mutation: drop `disabled` from the Contours row, and over a topographic
  // sheet it offers a switch that draws nothing.
  it("says a topographic sheet prints its own contours", () => {
    draw("six-topo");
    const contours = screen.getByRole("switch", { name: copy.contours });
    expect((contours as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(copy.contoursPrinted)).toBeTruthy();
  });
});
