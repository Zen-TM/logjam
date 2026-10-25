import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAP_TERRAIN, TERRAIN_LAYER_DEFAULTS } from "@logjam/shared";
import { TerrainPane } from "./LayersPopover";

afterEach(cleanup);

const copy = MAP_TERRAIN.copy;

function draw(
  activeLayerId = "protomaps",
  layers: typeof TERRAIN_LAYER_DEFAULTS = TERRAIN_LAYER_DEFAULTS,
  hasVegetation = false,
) {
  const props = {
    layers,
    onChange: vi.fn(),
    activeLayerId,
    onOpenSlopeBands: vi.fn(),
    hasVegetation,
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
    expect(props.onChange).toHaveBeenCalledWith("slope", false);
    fireEvent.click(screen.getByRole("switch", { name: "Show hillshade" }));
    expect(props.onChange).toHaveBeenCalledWith("hillshade", true);
    fireEvent.click(screen.getByRole("switch", { name: "Show contours" }));
    expect(props.onChange).toHaveBeenCalledWith("contours", false);
  });

  // Mutation: draw the row unconditionally, and a user with no vegetation
  // layer is offered a switch that draws nothing.
  it("offers Vegetation only when a sharpened area has the layer", () => {
    draw();
    expect(
      screen.queryByRole("switch", { name: "Show vegetation" }),
    ).toBeNull();
    cleanup();
    const props = draw("protomaps", undefined, true);
    expect(screen.getAllByRole("switch")).toHaveLength(4);
    fireEvent.click(screen.getByRole("switch", { name: "Show vegetation" }));
    expect(props.onChange).toHaveBeenCalledWith("vegetation", false);
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
    const contours = screen.getByRole("switch", { name: "Show contours" });
    expect((contours as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(copy.contoursPrinted)).toBeTruthy();
  });

  // Mutation: drop `shadowed` from the Hillshade row, and imagery offers a
  // shading over photographs that carry their own.
  it("says imagery has its own shadows, and offers Hillshade elsewhere", () => {
    draw("six-imagery");
    const hillshade = screen.getByRole("switch", { name: "Show hillshade" });
    expect((hillshade as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(copy.hillshadeImagery)).toBeTruthy();
    cleanup();
    draw("six-topo");
    expect(
      (
        screen.getByRole("switch", {
          name: "Show hillshade",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  // Mutation: read `layers[key]` alone as `checked`, and a stored-on switch
  // shows ON over a basemap that draws nothing for it.
  it("reads off while a basemap disables it, and on again elsewhere", () => {
    const on = (name: string) =>
      (screen.getByRole("switch", { name }) as HTMLButtonElement).getAttribute(
        "aria-checked",
      );
    const stored = {
      contours: true,
      slope: true,
      hillshade: true,
      vegetation: true,
    };
    draw("six-imagery", stored);
    expect(on("Show hillshade")).toBe("false");
    cleanup();
    draw("six-topo", stored);
    expect(on("Show contours")).toBe("false");
    expect(on("Show slope")).toBe("true");
    cleanup();
    draw("protomaps", stored);
    expect(on("Show contours")).toBe("true");
    expect(on("Show hillshade")).toBe("true");
  });
});
