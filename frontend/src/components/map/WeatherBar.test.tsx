import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MAP_TERRAIN, WEATHER, weatherLayer } from "@logjam/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import WeatherBar from "./WeatherBar";
import type { WeatherView } from "./weatherView";

afterEach(cleanup);
const copy = MAP_TERRAIN.copy;

const stepped: WeatherView = {
  kind: "ready",
  layer: weatherLayer("rain"),
  step: 5,
  first: 2,
  last: 9,
  shown: "Sat 8, 2 pm",
  age: "Updated 3 h ago",
  url: "u",
};
const bar = (view: WeatherView, over: { online?: boolean } = {}) => {
  const onStep = vi.fn();
  const onRetry = vi.fn();
  render(
    <WeatherBar
      view={view}
      online={over.online ?? true}
      onStep={onStep}
      onRetry={onRetry}
    />,
  );
  return { onStep, onRetry };
};

describe("the Weather bar", () => {
  // Mutation: render something while off, and the map wears a bar nobody asked for.
  it("draws nothing while off", () => {
    bar({ kind: "off" });
    expect(document.body.textContent).toBe("");
  });

  // Mutation: drop the unit, the time or the age, and the colours have no
  // scale, the user can't tell which hour they see, or how old the run is.
  it("names the layer and its unit, the time shown and the run's age", () => {
    bar(stepped);
    const region = screen.getByRole("region", { name: copy.weather });
    expect(region.textContent).toContain("Rain");
    expect(region.textContent).toContain("mm/h");
    expect(region.textContent).toContain("Sat 8, 2 pm");
    expect(region.textContent).toContain("Updated 3 h ago");
  });

  // Mutation: use a div for the scrubber, or drop aria-valuetext, and the
  // keyboard can't drive it, or a screen reader hears 5 and not the time.
  it("scrubs with a native range over the steps to come, spoken as the time", () => {
    const { onStep } = bar(stepped);
    const range = screen.getByRole("slider", {
      name: "Rain",
    }) as HTMLInputElement;
    expect(range.type).toBe("range");
    expect([range.min, range.max, range.value]).toEqual(["2", "9", "5"]);
    expect(range.getAttribute("aria-valuetext")).toBe("Sat 8, 2 pm");
    fireEvent.change(range, { target: { value: "7" } });
    expect(onStep).toHaveBeenCalledWith(7);
  });

  // Mutation: step past the ends, and the map asks for an archive that doesn't exist.
  it("steps by one with Earlier and Later, and stays inside the ends", () => {
    const { onStep } = bar(stepped);
    fireEvent.click(screen.getByRole("button", { name: copy.weatherEarlier }));
    fireEvent.click(screen.getByRole("button", { name: copy.weatherLater }));
    expect(onStep.mock.calls).toEqual([[4], [6]]);
  });

  it("holds at the first and last steps", () => {
    cleanup();
    const first = bar({ ...stepped, step: 2 });
    fireEvent.click(screen.getByRole("button", { name: copy.weatherEarlier }));
    expect(first.onStep).toHaveBeenCalledWith(2);
    cleanup();
    const last = bar({ ...stepped, step: 9 });
    fireEvent.click(screen.getByRole("button", { name: copy.weatherLater }));
    expect(last.onStep).toHaveBeenCalledWith(9);
  });

  // Mutation: draw the scrubber for a total, and it moves nothing.
  it("gives a total its window and no scrubber", () => {
    bar({
      ...stepped,
      layer: weatherLayer("rainPast24"),
      step: null,
      shown: "To Today, 6 pm",
    });
    expect(screen.getByText("To Today, 6 pm")).toBeTruthy();
    expect(screen.queryByRole("slider")).toBeNull();
    expect(
      screen.queryByRole("button", { name: copy.weatherLater }),
    ).toBeNull();
  });

  it("says it is loading", () => {
    bar({ kind: "loading" });
    expect(screen.getByRole("status").textContent).toBe(copy.weatherLoading);
  });

  // Mutation: offer Try again offline, and it fails again at once.
  it("offers Try again to an online user whose files failed, and not offline", () => {
    const { onRetry } = bar({ kind: "failed" });
    expect(screen.getByRole("status").textContent).toContain(
      copy.weatherFailed,
    );
    fireEvent.click(
      screen.getByRole("button", { name: WEATHER.copy.tryAgain }),
    );
    expect(onRetry).toHaveBeenCalledOnce();
    cleanup();
    bar({ kind: "failed" }, { online: false });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says a run that has run out has", () => {
    bar({ kind: "outOfDate" });
    expect(screen.getByRole("status").textContent).toBe(copy.weatherOutOfDate);
  });
});
