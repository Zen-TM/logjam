import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  MAP_TERRAIN,
  WEATHER,
  WEATHER_MAP,
  parseWeatherMap,
  type WeatherLayerKey,
} from "@logjam/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WeatherBar from "./WeatherBar";
import type { WeatherMapState, WeatherPick } from "./weatherView";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const copy = MAP_TERRAIN.copy;

const hour = 3_600_000;
const T0 = Date.parse("2026-11-07T09:00:00Z");
const file = parseWeatherMap({
  format: 1,
  model: "ecmwf_ifs",
  run: "2026-11-07T00:00Z",
  built: "2026-11-07T09:07Z",
  anchor: "2026-11-07T09:00Z",
  path: "runs/20261107T0000Z-20261107T0900Z/",
  bounds: [139, -39.5, 156, -26],
  zoom: 5,
  steps: Array.from({ length: 10 }, (_, i) => ({
    time: new Date(T0 + i * hour).toISOString(),
    hours: 1,
  })),
  totals: ["rainPast24"],
  attribution: WEATHER_MAP.credit,
})!;
const ready: WeatherMapState = { status: "ready", file };

const bar = (
  over: {
    state?: WeatherMapState;
    layerKey?: WeatherLayerKey;
    online?: boolean;
    settled?: WeatherPick | null;
    now?: number;
  } = {},
) => {
  const onSettle = vi.fn();
  const onRetry = vi.fn();
  render(
    <WeatherBar
      state={over.state ?? ready}
      layerKey={over.layerKey ?? "rain"}
      now={over.now ?? T0 + 1.5 * hour}
      settled={over.settled ?? null}
      onSettle={onSettle}
      online={over.online ?? true}
      onRetry={onRetry}
    />,
  );
  return { onSettle, onRetry };
};
const slider = () =>
  screen.getByRole("slider", { name: "Rain" }) as HTMLInputElement;

describe("the Weather bar", () => {
  // Mutation: drop the unit, the time or the age, and the colours have no
  // scale, the user can't tell which hour they see, or how old the run is.
  it("names the layer and its unit, the time shown and the run's age", () => {
    bar();
    const text = document.body.textContent;
    expect(text).toContain("Rain");
    expect(text).toContain("mm/h");
    expect(text).toContain(slider().getAttribute("aria-valuetext"));
    expect(text).toContain("Updated 1 h ago");
  });

  // Mutation: use a div for the scrubber, or drop aria-valuetext, and the
  // keyboard can't drive it, or a screen reader hears 2 and not the time.
  it("scrubs with a native range over the steps to come, spoken as the time", () => {
    bar();
    expect(slider().type).toBe("range");
    expect([slider().min, slider().max, slider().value]).toEqual([
      "2",
      "9",
      "2",
    ]);
    expect(slider().getAttribute("aria-valuetext")).not.toBe("");
  });

  // Mutation: tell the app on every notch, and a drag across the week
  // re-renders it, and asks the map for an archive, per notch.
  it("holds a step on the bar at once and tells the app once it rests", () => {
    const { onSettle } = bar();
    fireEvent.change(slider(), { target: { value: "5" } });
    fireEvent.change(slider(), { target: { value: "6" } });
    expect(slider().value).toBe("6");
    act(() => vi.advanceTimersByTime(WEATHER_MAP.settleMs - 1));
    expect(onSettle).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(onSettle).toHaveBeenCalledWith({ path: file.path, step: 6 });
  });

  // Mutation: start from step 0 instead of the app's settled pick, and a bar
  // remounted by a later turn-on jumps back to the hour now falls in.
  it("opens on the step the app settled on", () => {
    bar({ settled: { path: file.path, step: 7 } });
    expect(slider().value).toBe("7");
  });

  // Mutation: step past the ends, and the map asks for an archive that doesn't exist.
  it("steps by one with Earlier and Later, and stays inside the ends", () => {
    bar({ settled: { path: file.path, step: 5 } });
    fireEvent.click(screen.getByRole("button", { name: copy.weatherEarlier }));
    expect(slider().value).toBe("4");
    fireEvent.click(screen.getByRole("button", { name: copy.weatherLater }));
    fireEvent.click(screen.getByRole("button", { name: copy.weatherLater }));
    expect(slider().value).toBe("6");
  });

  it("holds at the first and last steps", () => {
    bar();
    for (let i = 0; i < 3; i++)
      fireEvent.click(
        screen.getByRole("button", { name: copy.weatherEarlier }),
      );
    expect(slider().value).toBe("2");
    for (let i = 0; i < 12; i++)
      fireEvent.click(screen.getByRole("button", { name: copy.weatherLater }));
    expect(slider().value).toBe("9");
  });

  // Mutation: draw the scrubber for a total, and it moves nothing.
  it("gives a total its window and no scrubber", () => {
    bar({ layerKey: "rainPast24" });
    expect(document.body.textContent).toMatch(/Rain, past 24 h.* To /);
    expect(screen.queryByRole("slider")).toBeNull();
    expect(
      screen.queryByRole("button", { name: copy.weatherLater }),
    ).toBeNull();
  });

  it("says it is loading", () => {
    bar({ state: { status: "loading" } });
    expect(document.body.textContent).toBe(copy.weatherLoading);
  });

  // Mutation: offer Try again offline, and it fails again at once.
  it("offers Try again to an online user whose files failed, and not offline", () => {
    const { onRetry } = bar({ state: { status: "failed" } });
    expect(document.body.textContent).toContain(copy.weatherFailed);
    fireEvent.click(
      screen.getByRole("button", { name: WEATHER.copy.tryAgain }),
    );
    expect(onRetry).toHaveBeenCalledOnce();
    cleanup();
    bar({ state: { status: "failed" }, online: false });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says a run that has run out has", () => {
    bar({ now: T0 + 20 * hour });
    expect(document.body.textContent).toBe(copy.weatherOutOfDate);
  });
});
