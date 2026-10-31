// Logjam GPS draws exactly the sections `GAUGES` names, and a gauge press
// stops the source press first and yields to a pin.
//
// Mutations that turn it red: add `{ key: "wind" }` to `GAUGES.sections`;
// delete `credit` from `GAUGE_SECTIONS`; drop `stopSourcePress(event)` from
// `handleGaugePress`; mount `GaugesLayer` without `showGauges &&`; give the
// layer a `useGauges(true)`.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { contractSectionKeys, GAUGES } from "@logjam/shared";

import { fromZero, GAUGE_SECTIONS } from "./GaugeSheet";

vi.mock("react-native", () => ({ Text: "Text", View: "View" }));
vi.mock("../theme", () => ({
  makeStyles: () => () => ({}),
  muted: () => ({}),
  spacing: (n: number) => n * 8,
}));
vi.mock("../ui", () => ({}));

// Mutation: return the series unshifted; the chart then draws a week that
// starts at epoch time as a flat block.
describe("the chart's x axis", () => {
  it("starts at zero and gives its start back", () => {
    const { series, start } = fromZero({
      points: [
        { x: 5000, value: 1 },
        { x: 9000, value: 2 },
      ],
      min: 1,
      max: 2,
    });
    expect(series.points.map((p) => p.x)).toEqual([0, 4000]);
    expect(start).toBe(5000);
  });
});

const read = (file: string) =>
  readFileSync(new URL(file, import.meta.url), "utf8");

describe("Logjam GPS draws what GAUGES names", () => {
  it("the sheet's sections", () => {
    expect(Object.keys(GAUGE_SECTIONS).sort()).toEqual(
      contractSectionKeys(GAUGES, "gps").sort(),
    );
  });
});

describe("the map's gauge layer", () => {
  const screen = read("../map/MapScreen.tsx");
  it("stops the source press first, then yields to a pin", () => {
    expect(screen).toMatch(
      /const handleGaugePress = useCallback\(\s*\(event[^)]*\) => \{\s*stopSourcePress\(event\);/,
    );
    expect(screen).toContain("Date.now() - pinPressedAt.current < 250");
  });
  it("mounts only while the layer is on", () => {
    expect(screen).toContain("{showGauges && gaugeFile ? (");
  });
  it("is fetched only while on", () => {
    expect(read("./useGauges.ts")).toContain("if (!enabled) return;");
  });
});

describe("a place's gauge section", () => {
  const section = read("./PlaceGaugeSection.tsx");
  // Mutation: call `onChange(` anywhere but a Row's onPress (say, an effect
  // that picks the nearest), or draw the Rows without `owned &&`.
  it("changes the gauge only on a press, and only for the owner", () => {
    expect(section.match(/onChange\(/g)).toHaveLength(2);
    expect(section).not.toContain("useEffect");
    expect(section).toContain("{owned && (");
    expect(section).toContain("{owned && gaugeId && (");
  });
  it("loads the file only for the owner or a place that has a gauge", () => {
    expect(section).toContain("useGauges(owned || !!gaugeId)");
  });
});

// Mutations that turn it red: pass `tripDates` to the reading for a sharee;
// drop the section from either screen; fetch histories on a timer.
describe("the trip reading's wiring", () => {
  it("shows a sharee none: the place section passes dates only when owned", () => {
    expect(read("./PlaceGaugeSection.tsx")).toContain(
      "dates={tripDatesFor(owned, tripDates)}",
    );
  });
  it("draws it on both pages", () => {
    expect(read("../logs/TripDetailScreen.tsx")).toContain("<TripGaugeReading");
    expect(read("./PlaceGaugeSection.tsx")).toContain("<TripGaugeReading");
  });
  it("keeps the saved places' histories only at start and on return to the front", () => {
    const src = read("./savedPlaceHistories.ts");
    expect(src).toContain('state === "active"');
    expect(src).not.toMatch(/setInterval|setTimeout/);
  });
});
