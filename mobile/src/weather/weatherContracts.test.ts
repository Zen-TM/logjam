// Logjam GPS draws exactly the sections `WEATHER` and `PLACE_PAGE` name, and
// the weather verb swaps the map panel's body instead of closing it.
//
// Mutations that turn it red: add `{ key: "wind" }` to `WEATHER.sections`;
// delete `credit` from `WEATHER_SECTIONS`; drop the `return` after
// `onShowWeather()` in `MapPointSheet.tsx` (the panel then closes on the press);
// move the `fetchForecast` call out of `refresh` in `useWeather.ts` (a fetch on
// opening).
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
      /onShowWeather\(\);\s*weather\.refresh\(\);\s*return;/,
    );
    expect(source).toContain("if (weatherOpen) return <WeatherView");
  });

  it("fetches only inside refresh", () => {
    const source = read("./useWeather.ts");
    expect(source.match(/fetchForecast\(/g)).toHaveLength(1);
    expect(source.indexOf("fetchForecast(")).toBeGreaterThan(
      source.indexOf("const refresh"),
    );
  });
});
