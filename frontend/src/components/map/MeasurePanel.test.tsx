import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAP_MEASURE,
  MAP_MEASURE_START_NOTE,
  mapMeasureVerbs,
  mapPointVerbs,
} from "@logjam/shared";
import { PANEL_TITLES } from "../sidebar/panels";
import { MeasurePanel } from "./MeasurePanel";

const terrain = vi.hoisted(() => ({
  profile: null as null | {
    gainM: number;
    lossM: number;
    minM: number;
    maxM: number;
  },
}));
vi.mock("../../placeUtils", () => ({
  useElevationProfile: () => ({
    profile: terrain.profile,
    loading: false,
    error: null,
  }),
}));

afterEach(() => {
  cleanup();
  terrain.profile = null;
});

// ~1.11 km due north.
const line: [number, number][] = [
  [150.35, -33.66],
  [150.35, -33.65],
];

function draw(over: Partial<Parameters<typeof MeasurePanel>[0]> = {}) {
  const props = {
    points: [] as [number, number][],
    anchorCount: 0,
    canUndo: false,
    atCap: false,
    onUndo: vi.fn(),
    onClear: vi.fn(),
    onClose: vi.fn(),
    snapMode: "off" as const,
    onSnapModeChange: vi.fn(),
    ...over,
  };
  render(<MeasurePanel {...props} />);
  return props;
}

// The web measure tool is drawn from `MAP_MEASURE`, so it says what Logjam
// GPS's says. Mutations that turn these red: write a title, a label or a verb
// in the panel instead of reading the contract; give it a Save or a Cancel.
describe("the measure tool's page", () => {
  it("is named by the contract, and says what the map is for until a point lands", () => {
    draw();
    expect(
      screen.getByRole("heading", { name: MAP_MEASURE.title }),
    ).toBeTruthy();
    expect(PANEL_TITLES.measure).toBe(MAP_MEASURE.title);
    expect(screen.getByRole("status").textContent).toBe(
      MAP_MEASURE_START_NOTE.web,
    );
    expect(screen.getByText("Distance").nextSibling?.textContent).toBe("—");
    expect(screen.queryByText("Ascent")).toBeNull();
  });

  it("shows the distance along the line, the point count and the terrain once read", () => {
    terrain.profile = { gainM: 212.4, lossM: 87.6, minM: 411.7, maxM: 655.2 };
    draw({ points: line, anchorCount: 2, canUndo: true });
    expect(screen.getByRole("status").textContent).toBe("2 points");
    expect(screen.getByText("Distance").nextSibling?.textContent).toBe(
      "1.1 km",
    );
    expect(screen.getByText("Ascent").nextSibling?.textContent).toBe("↑ 212 m");
    expect(screen.getByText("Descent").nextSibling?.textContent).toBe("↓ 88 m");
    expect(screen.getByText("412–655 m above sea level")).toBeTruthy();
  });

  it("draws exactly the contract's verbs for Logjam Web, and leaves by the ×", () => {
    const props = draw({ points: line, anchorCount: 2, canUndo: true });
    const [undo, clear] = mapMeasureVerbs("web");
    fireEvent.click(screen.getByRole("button", { name: undo.label }));
    fireEvent.click(screen.getByRole("button", { name: clear.label }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(props.onUndo).toHaveBeenCalledTimes(1);
    expect(props.onClear).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    // Nothing is kept, so nothing is saved or cancelled.
    expect(
      screen
        .getAllByRole("button")
        .map(
          (button) => button.textContent || button.getAttribute("aria-label"),
        ),
    ).toEqual(["Close", undo.label, clear.label]);
  });

  it("undoes on Ctrl+Z, as the route tool does", () => {
    const props = draw({ points: line, anchorCount: 2, canUndo: true });
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(props.onUndo).toHaveBeenCalledTimes(1);
  });

  it("is what the point panel's verb arms", () => {
    expect(
      mapPointVerbs("web").find((verb) => verb.id === "measure")?.label,
    ).toBe(MAP_MEASURE.copy.fromHere);
  });
});
