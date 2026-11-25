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
  weatherScale,
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
  totals: ["rainPast24", "rainPast168"],
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
  const onDismiss = vi.fn();
  const onChooseLayer = vi.fn();
  const props = {
    onSettle,
    online: over.online ?? true,
    onRetry,
    onDismiss,
    onChooseLayer,
  };
  const view = (layerKey: WeatherLayerKey) => (
    <WeatherBar
      state={over.state ?? ready}
      layerKey={layerKey}
      now={over.now ?? T0 + 1.5 * hour}
      settled={over.settled ?? null}
      {...props}
    />
  );
  const { rerender } = render(view(over.layerKey ?? "rain"));
  return {
    onSettle,
    onRetry,
    onDismiss,
    onChooseLayer,
    changeLayer: (key: WeatherLayerKey) => rerender(view(key)),
  };
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

  // Mutation: put the layer and the time back on one line, and a long time or
  // a total's title wraps it to a second line: the card changes height.
  it("keeps the layer and the time on lines of their own", () => {
    for (const layerKey of ["rain", "rainPast168"] as const) {
      bar({ layerKey });
      const title = screen.getByText((_, el) =>
        Boolean(
          el?.tagName === "SPAN" &&
            el.textContent?.trim().startsWith("Rain") &&
            !el.textContent.includes("Updated") &&
            el.parentElement?.textContent?.includes("Updated"),
        ),
      );
      const time = title.nextElementSibling as HTMLElement;
      expect(time.textContent).toMatch(/· Updated/);
      cleanup();
    }
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
    expect(
      screen.queryByRole("button", { name: WEATHER.copy.tryAgain }),
    ).toBeNull();
  });

  it("says a run that has run out has", () => {
    bar({ now: T0 + 20 * hour });
    expect(document.body.textContent).toBe(copy.weatherOutOfDate);
  });

  // Mutation: offer Try again for a total the run left out, and the button
  // asks for the same manifest, which still lacks it.
  it("offers nothing to try again for a total the run left out", () => {
    bar({ layerKey: "rainNext72" });
    expect(document.body.textContent).toBe(copy.weatherFailed);
    expect(
      screen.queryByRole("button", { name: WEATHER.copy.tryAgain }),
    ).toBeNull();
  });

  // Mutation: drop `quiet`, and a screen reader re-reads the bar on every
  // notch over the scrubber's own value.
  it("keeps the moving bar out of the live region, and its states in it", () => {
    bar();
    expect(document.querySelector("[aria-live=off]")).not.toBeNull();
    cleanup();
    bar({ state: { status: "failed" } });
    expect(document.querySelector("[aria-live=off]")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(copy.weatherFailed);
  });
});

describe("the Weather bar's colour scale", () => {
  // Mutation: drop the ColourScale, key it by rain whatever is picked, or show
  // it only beside the scrubber, and the map's colours have no numbers here.
  it("shows the picked layer's scale, a total's included, hidden from a screen reader", () => {
    for (const layerKey of ["rain", "temperature", "rainPast24"] as const) {
      bar({ layerKey });
      const hidden = [...document.querySelectorAll('[aria-hidden="true"]')].map(
        (e) => e.textContent,
      );
      expect(hidden).toContain(
        weatherScale(layerKey)
          .map((s) => s.label)
          .join(""),
      );
      cleanup();
    }
  });
});

describe("the Weather bar's Play", () => {
  const play = () =>
    fireEvent.click(screen.getByRole("button", { name: copy.weatherPlay }));
  const tick = (n = 1) =>
    act(() => vi.advanceTimersByTime(n * WEATHER_MAP.playMs));

  // Mutation: advance by `settleMs`, never arm the timer, or never loop, and
  // Play stands still, runs too fast, or stops at the end of the week.
  it("steps on every playMs and loops from the last step to the first allowed", () => {
    bar({ settled: { path: file.path, step: 8 } });
    play();
    expect(slider().value).toBe("8");
    tick();
    expect(slider().value).toBe("9");
    tick();
    expect(slider().value).toBe("2");
    tick();
    expect(slider().value).toBe("3");
  });

  it("offers Pause while it plays, and Play again after", () => {
    bar();
    play();
    fireEvent.click(screen.getByRole("button", { name: copy.weatherPause }));
    expect(screen.getByRole("button", { name: copy.weatherPlay })).toBeTruthy();
  });

  // Mutation: leave the interval armed after Pause: a timer ticks while paused.
  it("arms nothing while paused", () => {
    bar();
    play();
    fireEvent.click(screen.getByRole("button", { name: copy.weatherPause }));
    act(() => vi.advanceTimersByTime(WEATHER_MAP.settleMs));
    expect(vi.getTimerCount()).toBe(0);
    tick(3);
    expect(slider().value).toBe("2");
  });

  // Mutation: drop `pause()` from `onStep`, and the user's own drag or press
  // fights Play for the scrubber.
  it("stops when the user drags the scrubber or presses Earlier or Later", () => {
    bar();
    play();
    fireEvent.change(slider(), { target: { value: "5" } });
    tick(2);
    expect(slider().value).toBe("5");
    play();
    fireEvent.click(screen.getByRole("button", { name: copy.weatherEarlier }));
    tick(2);
    expect(slider().value).toBe("4");
    play();
    fireEvent.click(screen.getByRole("button", { name: copy.weatherLater }));
    tick(2);
    expect(slider().value).toBe("5");
  });

  // Mutation: hold `playing` as a boolean, and a new layer plays on.
  it("stops when the layer changes", () => {
    const { changeLayer } = bar();
    play();
    changeLayer("temperature");
    expect(screen.getByRole("button", { name: copy.weatherPlay })).toBeTruthy();
    tick(2);
    expect(
      (
        screen.getByRole("slider", {
          name: "Temperature",
        }) as HTMLInputElement
      ).value,
    ).toBe("2");
  });

  // Mutation: drop the `visibilitychange` listener, and a hidden tab keeps
  // fetching archives.
  it("stops when the page is hidden", () => {
    bar();
    play();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    tick(2);
    expect(slider().value).toBe("2");
    vi.restoreAllMocks();
  });

  // Mutation: clear no interval on cleanup, and Weather off keeps a timer.
  it("leaves no timer when the bar goes away", () => {
    bar();
    play();
    cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("has no Play for a total", () => {
    bar({ layerKey: "rainPast24" });
    expect(screen.queryByRole("button", { name: copy.weatherPlay })).toBeNull();
  });
});

describe("the Weather bar's X and title", () => {
  // Mutation: leave the X out of one state, and a user whose weather map is
  // stuck loading, failed or out of date has to find the switch in Layers.
  it("hides the weather map from every state", () => {
    const cases: Parameters<typeof bar>[0][] = [
      {},
      { layerKey: "rainPast24" },
      { state: { status: "loading" } },
      { state: { status: "failed" } },
      { state: { status: "failed" }, online: false },
      { now: T0 + 20 * hour },
    ];
    for (const over of cases) {
      const { onDismiss } = bar(over);
      fireEvent.click(screen.getByRole("button", { name: copy.weatherHide }));
      expect(onDismiss, JSON.stringify(over)).toHaveBeenCalledOnce();
      cleanup();
    }
  });

  it("keeps Try again beside the X", () => {
    bar({ state: { status: "failed" } });
    expect(
      screen.getByRole("button", { name: WEATHER.copy.tryAgain }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: copy.weatherHide })).toBeTruthy();
  });

  // Mutation: wire the title to nothing, and the layer's name is a dead label.
  it("opens the layer choice from the title", () => {
    const { onChooseLayer } = bar();
    const title = screen.getByTitle(copy.weatherChoose);
    expect(title.textContent).toContain("Rain");
    fireEvent.click(title);
    expect(onChooseLayer).toHaveBeenCalledOnce();
  });
});

describe("the Weather bar's width", () => {
  // jsdom has no layout, so the guard is what sets the width: the ready card
  // is a fixed-width Notice whatever it says (Notice.test.tsx holds the rule).
  // Mutation: drop `fixedWidth` from the ready card, and "Today, 9 pm" and
  // "Sat 28, 11 am" size it differently again.
  it("is one fixed-width card for a short title, a long one and a total", () => {
    const cards = (["rain", "rainPast168", "wind"] as const).map((layerKey) => {
      bar({ layerKey });
      const card = document.querySelector("[data-tone]")!.className;
      cleanup();
      return card;
    });
    expect([...new Set(cards)]).toHaveLength(1);
    expect(cards[0]).toMatch(/fixedWidth/);
  });
});
