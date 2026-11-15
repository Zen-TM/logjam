// Logjam GPS draws exactly the sections `GAUGES` names, and a gauge press
// stops the source press first and yields to a pin.
//
// Mutations that turn it red: add `{ key: "wind" }` to `GAUGES.sections`;
// delete `credit` from `GAUGE_SECTIONS`; drop `stopSourcePress(event)` from
// `handleGaugePress`; mount `GaugesLayer` on `showGauges` alone; give the
// layer a `useGauges(GAUGE_PREFIX)`; gate `openGauge` on `gaugesShown`.
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
  // Mutation: mount on `showGauges` alone, and the layer draws over a region
  // that has no feed, though its row reads OFF.
  it("mounts only while the layer is on and the region has a feed", () => {
    expect(screen).toContain("const gaugesShown = showGauges && gaugesHere;");
    expect(screen).toContain("{gaugesShown && gaugeFile ? (");
  });
  // Mutation: set `inert` in place of `disabled` on the gauges entry, or wrap
  // the row in a dimming View again, and a screen reader is told nothing and
  // can still switch it, or the reason dims with the title.
  it("says why it is unavailable through the row's disabled state", () => {
    expect(screen).toContain("disabled: !gaugesHere,");
    const sheet = read("../map/MapLayersSheet.tsx");
    expect(sheet).toContain("disabled={entry.disabled}");
    expect(sheet).not.toContain("entry.inert");
  });
  // Mutation: pass `gaugeFeedOf(terrainRegion)` whatever the layer's state, or
  // `GAUGE_PREFIX` in its place, and the feed is fetched while the layer is
  // off or over a region that has none.
  it("reads the feed of the region the map shows, only while the layer is on", () => {
    expect(read("./useGauges.ts")).toContain("if (feed === null) return;");
    expect(screen).toContain("const gaugeFeed = gaugeFeedOf(terrainRegion);");
    expect(screen).toContain("} = useGauges(showGauges ? gaugeFeed : null);");
    expect(read("../map/MapSearchBar.tsx")).toContain(
      "useGauges(expanded ? gaugeFeedIn(view) : null)",
    );
  });
  // Mutation: return `held.file` whatever feed it came from, and a map that
  // moves into another region draws the last region's gauges for it.
  it("never reads one feed's file as another's", () => {
    expect(read("./useGauges.ts")).toContain(
      "file: held?.feed === feed ? held.file : null",
    );
  });
  // Mutation: gate `openGauge` on `gaugesShown`, and a gauge picked in search
  // does not open its sheet at the pick while the layer is still turning on.
  it("opens a picked gauge's sheet without waiting for the layer to draw", () => {
    expect(screen).toMatch(/const openGauge = showGauges\s*\?/);
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
  // Mutation: read `GAUGE_PREFIX` here in place of the `feed` prop, or ask for
  // the file when neither the owner nor a gauge is there.
  it("loads the feed of the place's region only for the owner or a place that has a gauge", () => {
    expect(section).toContain("useGauges(owned || !!gaugeId ? feed : null)");
    expect(read("../places/PlaceDetailScreen.tsx")).toContain(
      "gaugeFeed !== null && (place.gaugeId || isOwner)",
    );
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
