import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CARRIERS,
  fireLegendRows,
  NSW_COVERAGE,
  MAP_TERRAIN,
  NSW_REGION,
  NSW_FIRE,
  OVERLAY_LEGENDS,
  RASTER_TEMPLATE_DEFAULTS,
  TERRAIN_LAYER_DEFAULTS,
} from "@logjam/shared";
import { OverlayLegendRow, TerrainPane } from "./LayersPopover";

// jsdom has no ResizeObserver, which the Coverage legend's ChipRail uses.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);

// jsdom has no modal <dialog>; the kit's Dialog calls both.
HTMLDialogElement.prototype.showModal = function showModal() {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function close() {
  this.removeAttribute("open");
};

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
    slopeBands: RASTER_TEMPLATE_DEFAULTS.slope.bands,
    hasVegetation,
    sharpenedCount: 2,
    onOpenSharpened: vi.fn(),
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

  // Mutation: drop a hint from the row, or the help button from Slope, and a
  // user who never opened the bands editor has nothing saying what the colours mean.
  it("says what each layer is, and opens the slope key from Slope's help", () => {
    draw();
    expect(screen.getByText(copy.contoursHint)).toBeTruthy();
    expect(screen.getByText(copy.slopeHint)).toBeTruthy();
    expect(screen.getByText(copy.hillshadeHint)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: copy.slopeAbout }));
    expect(screen.getByText(copy.slopeLegend)).toBeTruthy();
    expect(screen.getByText("40–50°")).toBeTruthy();
    expect(screen.getByText("70°+")).toBeTruthy();
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

  // Mutation: drop the help button or the Dialog, and the legend the short
  // hint stands in for is nowhere to be read.
  it("opens the vegetation legend from the row's help button", () => {
    draw("protomaps", undefined, true);
    expect(screen.queryByText(copy.vegetationLegend)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: copy.vegetationAbout }));
    expect(
      screen.getByRole("dialog", { name: copy.vegetation }).textContent,
    ).toContain(copy.vegetationLegend);
  });

  it("counts the sharpened areas and opens them", () => {
    const props = draw();
    fireEvent.click(screen.getByText(`${copy.sharpenedAreas} · 2`));
    expect(props.onOpenSharpened).toHaveBeenCalled();
  });

  // Mutation: drop `onPress` from `row`, and only the small switch toggles.
  // Mutation: let the help button's press reach the card, and reading about a
  // layer also switches it.
  it("switches a layer from anywhere on its card but a button inside it", () => {
    const props = draw("protomaps", undefined, true);
    fireEvent.click(screen.getByText(copy.hillshade));
    expect(props.onChange).toHaveBeenCalledWith("hillshade", true);
    fireEvent.click(screen.getByText(copy.vegetationHint));
    expect(props.onChange).toHaveBeenCalledWith("vegetation", false);
    props.onChange.mockClear();
    fireEvent.click(screen.getByRole("button", { name: copy.vegetationAbout }));
    fireEvent.click(screen.getByRole("button", { name: copy.slopeBands }));
    expect(props.onChange).not.toHaveBeenCalled();
    expect(props.onOpenSlopeBands).toHaveBeenCalled();
  });

  // Mutation: drop `|| shadowed` from the card's press, and a press on imagery's
  // Hillshade card switches a layer that cannot draw.
  it("leaves a disabled layer's card alone", () => {
    const props = draw("six-imagery");
    fireEvent.click(screen.getByText(copy.hillshade));
    expect(props.onChange).not.toHaveBeenCalled();
  });

  // Mutation: drop the help button or the Dialog, and a sharpened area is a
  // row nobody can read about.
  it("opens the sharpened areas' about dialog without opening the areas", () => {
    const props = draw();
    fireEvent.click(
      screen.getByRole("button", { name: copy.sharpenedAreasAbout }),
    );
    expect(
      screen.getByRole("dialog", { name: copy.sharpenedAreas }).textContent,
    ).toContain(copy.sharpenedAreasLegend);
    expect(props.onOpenSharpened).not.toHaveBeenCalled();
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
      coverage: false,
      fire: false,
      slope: true,
      land: false,
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

describe("the Land tenure row on Logjam Web", () => {
  // Mutation: start it on, and every map opens under a layer nobody asked for.
  it("is off by default, and switches the land key", () => {
    const onToggle = vi.fn();
    render(
      <OverlayLegendRow
        legend={OVERLAY_LEGENDS.land}
        checked={TERRAIN_LAYER_DEFAULTS.land}
        onToggle={onToggle}
      />,
    );
    const land = screen.getByRole("switch", { name: "Show land tenure" });
    expect(land.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(land);
    expect(onToggle).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByText(copy.land));
    expect(onToggle).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: copy.landAbout }));
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  // Mutation: drop the caveat, and Sydney's gaps and Land Council freehold
  // read as fact. The credit is a CC BY term of the data.
  it("opens its legend with the classes, caveat and credit", () => {
    render(
      <OverlayLegendRow
        legend={OVERLAY_LEGENDS.land}
        checked={false}
        onToggle={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: copy.landAbout }));
    const legend = screen.getByRole("dialog", { name: copy.land }).textContent;
    expect(legend).toContain(copy.landLegend);
    expect(legend).toContain("Private land");
    expect(legend).toContain(copy.landCaveat);
    expect(legend).toContain(NSW_REGION.terrain.land.credit);
  });
});

describe("the Fire history row on Logjam Web", () => {
  // Mutation: start it on, and every map opens under a layer nobody asked for.
  it("is off by default, and switches the fire key", () => {
    const onToggle = vi.fn();
    render(
      <OverlayLegendRow
        legend={OVERLAY_LEGENDS.fire}
        checked={TERRAIN_LAYER_DEFAULTS.fire}
        onToggle={onToggle}
      />,
    );
    const fire = screen.getByRole("switch", { name: "Show fire history" });
    expect(fire.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(fire);
    expect(onToggle).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByText(copy.fire));
    expect(onToggle).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: copy.fireAbout }));
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  // Mutation: drop the caveat or the credit, and an unmapped fire reads as no
  // fire, and a CC BY term of the data goes unmet.
  it("opens its legend with the key, caveat and credit", () => {
    render(
      <OverlayLegendRow
        legend={OVERLAY_LEGENDS.fire}
        checked={false}
        onToggle={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: copy.fireAbout }));
    const legend = screen.getByRole("dialog", { name: copy.fire }).textContent;
    expect(legend).toContain(copy.fireLegend);
    for (const { label } of fireLegendRows()) expect(legend).toContain(label);
    expect(legend).toContain(copy.fireCaveat);
    expect(legend).toContain(NSW_FIRE.credit);
  });

  // Mutation: list it among the Terrain rows, and it shows twice.
  it("is an overlay row, not a Terrain one", () => {
    draw();
    expect(
      screen.queryByRole("switch", { name: "Show fire history" }),
    ).toBeNull();
  });
});

describe("the Coverage row on Logjam Web", () => {
  const row = (props: {
    onToggle?: (on: boolean) => void;
    onChange?: (value: string) => void;
    value?: string | null;
  }) =>
    render(
      <OverlayLegendRow
        legend={OVERLAY_LEGENDS.coverage}
        checked={TERRAIN_LAYER_DEFAULTS.coverage}
        onToggle={props.onToggle ?? vi.fn()}
        choice={{
          value: props.value === undefined ? "optus" : props.value,
          onChange: props.onChange ?? vi.fn(),
        }}
      />,
    );

  // Mutation: draw the switch before a carrier is picked, or let the button
  // open anything but the carrier choice, and the overlay can be on with no
  // network to draw; skip turning it on at the first pick, and the user has
  // to find the switch they were never shown.
  it("offers one button to choose the carrier until one is picked", () => {
    const onChange = vi.fn();
    const onToggle = vi.fn();
    row({ onChange, onToggle, value: null });
    expect(screen.queryByRole("switch")).toBeNull();
    expect(
      screen.queryByRole("button", { name: copy.coverageAbout }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: copy.coverageChooseCarrier }),
    );
    screen.getByRole("dialog", { name: copy.coverage });
    expect(
      screen
        .getAllByRole("radio")
        .some((r) => r.getAttribute("aria-checked") === "true"),
    ).toBe(false);
    fireEvent.click(screen.getByRole("radio", { name: "Telstra" }));
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(onChange).toHaveBeenCalledWith("telstra");
  });

  // Mutation: drop the hand-off to help on close, and the first pick, which
  // unmounts the button that opened the legend, leaves keyboard focus on the
  // page's body.
  it("gives focus to the row's help when the first pick's legend closes", async () => {
    function Picking() {
      const [value, setValue] = useState<string | null>(null);
      return (
        <OverlayLegendRow
          legend={OVERLAY_LEGENDS.coverage}
          checked={value !== null}
          onToggle={vi.fn()}
          choice={{ value, onChange: setValue }}
        />
      );
    }
    render(<Picking />);
    const choose = screen.getByRole("button", {
      name: copy.coverageChooseCarrier,
    });
    choose.focus();
    fireEvent.click(choose);
    fireEvent.click(screen.getByRole("radio", { name: "Optus" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: copy.coverageAbout }),
      ),
    );
  });

  // Mutation: start it on, or drop the row's subtitle, and every map opens
  // under a hatch nobody asked for, or for a carrier nobody can see.
  it("is off by default, switches the coverage key, and names its carrier", () => {
    const onToggle = vi.fn();
    row({ onToggle });
    const coverage = screen.getByRole("switch", { name: "Show coverage" });
    expect(coverage.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(coverage);
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(screen.getByText("Optus")).toBeTruthy();
  });

  // Mutation: drop the rail, the caveat or the credit, and a user can't pick
  // their network, a prediction reads as a promise, or a CC BY term goes unmet.
  it("picks the carrier in its legend, beside the key, caveat and credit", () => {
    const onChange = vi.fn();
    const onToggle = vi.fn();
    row({ onChange, onToggle });
    fireEvent.click(screen.getByRole("button", { name: copy.coverageAbout }));
    const legend = screen.getByRole("dialog", { name: copy.coverage });
    for (const { name } of CARRIERS)
      expect(screen.getByRole("radio", { name })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "TPG" }));
    expect(onChange).toHaveBeenCalledWith("tpg");
    expect(onToggle).not.toHaveBeenCalled();
    expect(legend.textContent).toContain(copy.coverageLegend);
    for (const { label } of OVERLAY_LEGENDS.coverage.rows)
      expect(legend.textContent).toContain(label);
    expect(legend.textContent).toContain(copy.coverageCaveat);
    expect(legend.textContent).toContain(NSW_COVERAGE.credit);
  });

  // Mutation: list it among the Terrain rows, and it shows twice.
  it("is an overlay row, not a Terrain one", () => {
    draw();
    expect(screen.queryByRole("switch", { name: "Show coverage" })).toBeNull();
  });
});
