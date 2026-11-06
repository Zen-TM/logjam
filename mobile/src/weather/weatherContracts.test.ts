// Logjam GPS draws exactly the sections `WEATHER` and `PLACE_PAGE` name, and
// the weather verb swaps the map panel's body instead of closing it.
//
// Mutations that turn it red: add `{ key: "wind" }` to `WEATHER.sections`;
// delete `credit` from `WEATHER_SECTIONS`; draw a row's cards from anywhere but
// `weatherRows` in `WeatherView.tsx`; drop the `return` after
// `weather.refresh()` in `MapPointSheet.tsx` (the panel then closes on the press);
// drop the `mayFetch` guard from `fetchCell` in `useWeather.ts`;
// move the `fetchForecast` call out of `fetchCell` in `useWeather.ts` (a fetch on
// opening); draw the model chips from anything but `WEATHER_MODELS`, or call
// `refresh` rather than `chooseModel` from them (the choice then asks nothing).
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { contractSectionKeys, PLACE_PAGE, WEATHER } from "@logjam/shared";

import { WEATHER_SECTIONS } from "./WeatherView";

vi.mock("react-native", () => ({
  Linking: {},
  Pressable: "Pressable",
  Text: "Text",
  View: "View",
}));
vi.mock("../theme", () => ({
  hitSlop: 8,
  makeStyles: () => () => ({}),
  muted: () => ({}),
  radius: {},
  spacing: (n: number) => n * 8,
  useTheme: () => ({}),
}));
vi.mock("../ui", () => ({}));

const read = (file: string) =>
  readFileSync(new URL(file, import.meta.url), "utf8");

describe("Logjam GPS draws what the weather contracts name", () => {
  it("the weather view's sections", () => {
    expect(Object.keys(WEATHER_SECTIONS).sort()).toEqual(
      WEATHER.sections.map(({ key }) => key).sort(),
    );
  });

  it("draws the rows the shared module shapes, with the shared card", () => {
    const view = read("./WeatherView.tsx");
    expect(view).toContain("weatherRows(forecast, now)");
    expect(view).toContain("cards={found.cards}");
    // A horizontal scroller that hands the sheet its vertical drags.
    const rail = read("../ui/ForecastRail.tsx");
    expect(rail).toMatch(/<ScrollView\s+horizontal\s+nestedScrollEnabled/);
    // A larger font widens the cards, and the snap follows. Mutation: size
    // the cards from CARD_WIDTH alone, and "10 km/h" wraps at font 1.5.
    expect(rail).toContain(
      "forecastCardWidth(useWindowDimensions().fontScale)",
    );
    expect(rail).toContain("snapToInterval={width + GAP}");
    expect(rail).toContain("{ width }");
  });

  it("offers the shared models and asks on the press that chose one", () => {
    const view = read("./WeatherView.tsx");
    expect(view).toContain("WEATHER_MODELS.map");
    expect(view).toContain("onChange={weather.chooseModel}");
    // One sideways line, never a wrapped block (maintainer). Mutation: drop
    // `scroll` from the model ChipRail.
    const rail = view.slice(view.indexOf("<ChipRail"));
    expect(rail.slice(0, rail.indexOf("/>"))).toMatch(/^\s*scroll$/m);
    const hook = read("./useWeather.ts");
    expect(hook).toContain("weatherCell(point, elevationM, model)");
    expect(hook).toContain("fetchCell(weatherCell(point, elevationM, next))");
  });

  it("the place page has a weather section, drawn", () => {
    expect(contractSectionKeys(PLACE_PAGE, "gps")).toContain("weather");
    expect(read("../places/PlaceDetailScreen.tsx")).toContain(
      "weather: () => <PlaceWeatherSection",
    );
  });
});

describe("the press is what asks for the weather", () => {
  it("swaps the map panel's body and keeps the panel open", () => {
    const source = read("../map/MapPointSheet.tsx");
    expect(source).toMatch(
      /onView\("weather"\);\s*weather\.refresh\(\);\s*return;/,
    );
    expect(source).toContain('if (view === "weather") return <WeatherView');
  });

  it("asks mayFetch before sending anything", () => {
    const source = read("./useWeather.ts");
    expect(source.indexOf("mayFetch(")).toBeGreaterThan(
      source.indexOf("const fetchCell"),
    );
    expect(source.indexOf("mayFetch(")).toBeLessThan(
      source.indexOf("fetchForecast("),
    );
  });

  it("fetches only inside fetchCell, which only a press calls", () => {
    const source = read("./useWeather.ts");
    expect(source.match(/fetchForecast\(/g)).toHaveLength(1);
    expect(source.indexOf("fetchForecast(")).toBeGreaterThan(
      source.indexOf("const fetchCell"),
    );
    expect(source.match(/fetchCell\(/g)).toHaveLength(2);
    expect(source.indexOf("fetchCell(cell)")).toBeGreaterThan(
      source.indexOf("const refresh"),
    );
  });
});
