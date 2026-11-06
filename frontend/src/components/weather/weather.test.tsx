import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WEATHER,
  WEATHER_MODELS,
  contractSectionKeys,
  parseForecast,
  weatherCell,
} from "@logjam/shared";
import forecastJson from "../../../../shared/src/__fixtures__/openMeteoForecast.json";
import { PlaceWeather } from "./PlaceWeather";
import { WeatherView } from "./WeatherView";

// A made-up spot near Katoomba, a published town.
const spot = { latitude: -33.71234, longitude: 150.31188 };
const now = new Date(2026, 9, 18, 9).getTime();
const forecast = parseForecast(forecastJson, weatherCell(spot, 1013), now);

// jsdom has no Popover API (see ui/Menu.test.tsx), which the model menu uses.
Object.assign(HTMLElement.prototype, {
  showPopover(this: HTMLElement) {
    this.removeAttribute("popover");
  },
  hidePopover() {},
});
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const modelProps = { model: "best_match", onModel: vi.fn() } as const;

function stubFetch() {
  const fetch = vi.fn(async () => Response.json(forecastJson));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function setOnline(online: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  setOnline(true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("WeatherView", () => {
  const ready = { status: "ready", forecast, now } as const;

  // Mutation that turns it red: leave a contract section out of the renderer
  // map in WeatherView.tsx, or draw one the contract does not name (tsc too).
  it("draws every section of the WEATHER contract", () => {
    render(
      <WeatherView
        {...modelProps}
        state={ready}
        online
        onLoad={vi.fn()}
        now={now}
      />,
    );
    const keys = contractSectionKeys(WEATHER, "web");
    expect(keys).toEqual(["hours", "days", "past", "credit"]);
    for (const title of [
      WEATHER.copy.hours,
      WEATHER.copy.days,
      WEATHER.copy.pastModel,
    ])
      expect(screen.getByRole("list", { name: title })).toBeTruthy();
    expect(screen.getByText("25 mm")).toBeTruthy();
    const credit = screen.getByRole("link", { name: WEATHER.copy.credit });
    expect(credit.getAttribute("href")).toBe("https://open-meteo.com/");
    expect(credit.getAttribute("rel")).toContain("noopener");
  });

  // Mutation that turns it red: draw a row's cards from another list than
  // `weatherRows`, or drop `current` from the card.
  it("starts the hours at Now and the days at today, and names every card", () => {
    render(
      <WeatherView
        {...modelProps}
        state={ready}
        online
        onLoad={vi.fn()}
        now={now}
      />,
    );
    const hours = within(
      screen.getByRole("list", { name: WEATHER.copy.hours }),
    ).getAllByRole("listitem");
    expect(hours).toHaveLength(24);
    expect(hours[0].textContent).toContain(WEATHER.copy.now);
    expect(hours[0].getAttribute("data-current")).toBe("true");
    expect(hours[1].getAttribute("data-current")).toBe("false");
    const days = within(
      screen.getByRole("list", { name: WEATHER.copy.days }),
    ).getAllByRole("listitem");
    expect(days).toHaveLength(forecast.days.length);
    expect(days[0].textContent).toContain(WEATHER.copy.today);
    expect(days[0].getAttribute("data-current")).toBe("true");
    for (const card of [...hours, ...days])
      expect(card.getAttribute("aria-label")).toMatch(/rain/);
    const past = within(
      screen.getByRole("list", { name: WEATHER.copy.pastModel }),
    ).getAllByRole("listitem");
    expect(past).toHaveLength(7);
  });

  it("is a focusable, labelled scroller", () => {
    render(
      <WeatherView
        {...modelProps}
        state={ready}
        online
        onLoad={vi.fn()}
        now={now}
      />,
    );
    const track = screen.getByRole("list", { name: WEATHER.copy.hours });
    expect(track.getAttribute("tabindex")).toBe("0");
  });

  // Three rows, three pairs of buttons: a screen reader's list of buttons must
  // say which row each pages. Mutation that turns it red: pass the same
  // `labels` to every row in WeatherView.tsx.
  it("names each row's buttons after the row", () => {
    render(
      <WeatherView
        {...modelProps}
        state={ready}
        online
        onLoad={vi.fn()}
        now={now}
      />,
    );
    const names = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? "")
      .filter(
        (n) =>
          n.startsWith(WEATHER.copy.earlier) ||
          n.startsWith(WEATHER.copy.later),
      );
    expect(names).toHaveLength(6);
    expect(new Set(names).size).toBe(6);
    expect(names).toContain(`${WEATHER.copy.earlier}: ${WEATHER.copy.days}`);
  });

  it("pages a row by its buttons", () => {
    render(
      <WeatherView
        {...modelProps}
        state={ready}
        online
        onLoad={vi.fn()}
        now={now}
      />,
    );
    const track = screen.getByRole("list", { name: WEATHER.copy.hours });
    const scrollBy = vi.fn();
    track.scrollBy = scrollBy;
    window.matchMedia = vi.fn(() => ({ matches: false })) as never;
    fireEvent.click(
      screen.getByRole("button", {
        name: `${WEATHER.copy.later}: ${WEATHER.copy.hours}`,
      }),
    );
    expect(scrollBy).toHaveBeenCalledTimes(1);
  });

  it("says so when every day has run out", () => {
    const later = new Date(2027, 0, 1).getTime();
    render(
      <WeatherView
        {...modelProps}
        state={ready}
        online
        onLoad={vi.fn()}
        now={later}
      />,
    );
    expect(screen.getByText(WEATHER.copy.outOfDate)).toBeTruthy();
    // Only the rain that fell stays.
    expect(screen.queryByRole("list", { name: WEATHER.copy.hours })).toBeNull();
    expect(screen.queryByRole("list", { name: WEATHER.copy.days })).toBeNull();
  });

  it("refreshes online, and is disabled with its reason offline", () => {
    const onLoad = vi.fn();
    const { rerender } = render(
      <WeatherView
        {...modelProps}
        state={ready}
        online
        onLoad={onLoad}
        now={now}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: WEATHER.copy.refresh }));
    expect(onLoad).toHaveBeenCalledTimes(1);
    rerender(
      <WeatherView
        {...modelProps}
        state={ready}
        online={false}
        onLoad={onLoad}
        now={now}
      />,
    );
    const refresh = screen.getByRole("button", { name: WEATHER.copy.refresh });
    fireEvent.click(refresh);
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(refresh.getAttribute("aria-disabled")).toBe("true");
  });

  it("says loading, and failed with Try again only online", () => {
    const onLoad = vi.fn();
    const { rerender } = render(
      <WeatherView
        {...modelProps}
        state={{ status: "loading" }}
        online
        onLoad={onLoad}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      WEATHER.copy.loading,
    );
    rerender(
      <WeatherView
        {...modelProps}
        state={{ status: "failed" }}
        online
        onLoad={onLoad}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      WEATHER.copy.failed,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onLoad).toHaveBeenCalledTimes(1);
    rerender(
      <WeatherView
        {...modelProps}
        state={{ status: "failed" }}
        online={false}
        onLoad={onLoad}
      />,
    );
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});

describe("PlaceWeather", () => {
  // The privacy boundary of ADR 0038 as this page meets it. Mutation that turns
  // it red: fetch on mount, or pass the place's own coordinates to
  // `fetchForecast` instead of the cell.
  it("asks nothing until pressed, then sends only the cell", async () => {
    const fetch = stubFetch();
    render(<PlaceWeather point={spot} elevationM={1013} />);
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: WEATHER.copy.show }));
    await act(async () => {});
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL((fetch.mock.calls[0] as unknown as [string])[0]);
    expect(url.origin).toBe("https://api.open-meteo.com");
    expect(url.search).not.toContain("71234");
    expect(url.searchParams.get("elevation")).toBe("1010");
    expect(await screen.findByText(WEATHER.copy.pastModel)).toBeTruthy();
  });

  // Mutation that turns it red: drop the focus effect in WeatherView.
  it("keeps focus in the view when Show and Refresh swap their own button away", async () => {
    stubFetch();
    const { container } = render(
      <PlaceWeather point={spot} elevationM={null} />,
    );
    fireEvent.click(screen.getByRole("button", { name: WEATHER.copy.show }));
    await screen.findByText(WEATHER.copy.pastModel);
    expect(container.contains(document.activeElement)).toBe(true);
    const refresh = screen.getByRole("button", { name: WEATHER.copy.refresh });
    refresh.focus();
    fireEvent.click(refresh);
    await screen.findByText(WEATHER.copy.pastModel);
    expect(container.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
  });

  // Mutation that turns it red: drop `hidden` from the row's onOpen, and
  // showing the forecast again asks Open-Meteo a second time.
  it("hides the forecast to its row and shows it again without asking", async () => {
    const fetch = stubFetch();
    render(<PlaceWeather point={spot} elevationM={null} />);
    fireEvent.click(screen.getByRole("button", { name: WEATHER.copy.show }));
    await screen.findByText(WEATHER.copy.pastModel);
    fireEvent.click(screen.getByRole("button", { name: WEATHER.copy.hide }));
    expect(screen.queryByText(WEATHER.copy.pastModel)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: WEATHER.copy.show }));
    expect(await screen.findByText(WEATHER.copy.pastModel)).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shows a failure as the contract's words and logs nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );
    const logged = vi.spyOn(console, "error");
    render(<PlaceWeather point={spot} elevationM={null} />);
    fireEvent.click(screen.getByRole("button", { name: WEATHER.copy.show }));
    expect(await screen.findByText(WEATHER.copy.failed)).toBeTruthy();
    expect(logged).not.toHaveBeenCalled();
  });

  it("is disabled offline, with the reason where a screen reader reads it", () => {
    setOnline(false);
    const fetch = stubFetch();
    render(<PlaceWeather point={spot} elevationM={null} />);
    const show = screen.getByRole("button", { name: WEATHER.copy.show });
    expect((show as HTMLButtonElement).disabled).toBe(true);
    expect(show.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByText(WEATHER.copy.needsConnection)).toBeTruthy();
    fireEvent.click(show);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("the forecast model", () => {
  const choose = (name: string) => {
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(WEATHER.copy.model) }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(name) }));
  };

  // Mutation that turns it red: drop `models` from the request the choice
  // makes, or ask with the old model (a stale closure in `chooseModel`).
  it("asks again with the model chosen, and remembers it for the next view", async () => {
    const fetch = stubFetch();
    const { unmount } = render(<PlaceWeather point={spot} elevationM={null} />);
    fireEvent.click(screen.getByRole("button", { name: WEATHER.copy.show }));
    await screen.findByText(WEATHER.copy.pastModel);
    expect(WEATHER_MODELS.map((m) => m.label)).toContain("ECMWF");
    choose("ECMWF");
    await screen.findByText(WEATHER.copy.pastModel);
    expect(fetch).toHaveBeenCalledTimes(2);
    const url = new URL((fetch.mock.calls[1] as unknown as [string])[0]);
    expect(url.searchParams.get("models")).toBe("ecmwf_ifs");
    unmount();

    // A view opened later asks for that model, with no menu pressed.
    render(<PlaceWeather point={spot} elevationM={null} />);
    fireEvent.click(screen.getByRole("button", { name: WEATHER.copy.show }));
    await screen.findByText(WEATHER.copy.pastModel);
    const next = new URL((fetch.mock.calls[2] as unknown as [string])[0]);
    expect(next.searchParams.get("models")).toBe("ecmwf_ifs");
    expect(
      screen.getByRole("button", { name: `${WEATHER.copy.model}: ECMWF` }),
    ).toBeTruthy();
  });

  it("starts at best match, and a stored id it doesn't know reads as best match", async () => {
    localStorage.setItem("logjam.weatherModel", '"bom_access_global"');
    const fetch = stubFetch();
    render(<PlaceWeather point={spot} elevationM={null} />);
    fireEvent.click(screen.getByRole("button", { name: WEATHER.copy.show }));
    await screen.findByText(WEATHER.copy.pastModel);
    const url = new URL((fetch.mock.calls[0] as unknown as [string])[0]);
    expect(url.searchParams.has("models")).toBe(false);
    expect(
      screen.getByRole("button", { name: `${WEATHER.copy.model}: Best match` }),
    ).toBeTruthy();
  });

  it("can't be chosen offline, and says why", () => {
    const { rerender } = render(
      <WeatherView
        {...modelProps}
        state={{ status: "ready", forecast, now }}
        online={false}
        onLoad={vi.fn()}
        now={now}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(WEATHER.copy.model) }),
    );
    const item = screen.getByRole("menuitem", { name: /ECMWF/ });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(item.textContent).toContain(WEATHER.copy.needsConnection);
    rerender(<div />);
  });
});
