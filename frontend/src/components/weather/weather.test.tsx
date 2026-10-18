import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WEATHER,
  contractSectionKeys,
  formatRainMm,
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

function stubFetch() {
  const fetch = vi.fn(async () => Response.json(forecastJson));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function setOnline(online: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);
}

beforeEach(() => {
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
    render(<WeatherView state={ready} online onLoad={vi.fn()} now={now} />);
    const keys = contractSectionKeys(WEATHER, "web");
    expect(keys).toEqual(["pastRain", "days", "credit"]);
    expect(screen.getByText(WEATHER.copy.pastRain)).toBeTruthy();
    expect(screen.getByText(formatRainMm(forecast.pastRainMm))).toBeTruthy();
    expect(screen.getByRole("list", { name: WEATHER.title })).toBeTruthy();
    const credit = screen.getByRole("link", { name: WEATHER.copy.credit });
    expect(credit.getAttribute("href")).toBe("https://open-meteo.com/");
    expect(credit.getAttribute("rel")).toContain("noopener");
  });

  it("starts at today and says it", () => {
    render(<WeatherView state={ready} online onLoad={vi.fn()} now={now} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows[0].textContent).toContain(WEATHER.copy.today);
    expect(rows[0].getAttribute("data-current")).toBe("true");
    expect(rows[1].getAttribute("data-current")).toBe("false");
    expect(rows).toHaveLength(forecast.days.length);
    // The condition glyph is named, not just drawn.
    expect(
      rows[0].querySelector("[role=img]")?.getAttribute("aria-label"),
    ).toBeTruthy();
  });

  it("says so when every day has run out", () => {
    const later = new Date(2027, 0, 1).getTime();
    render(<WeatherView state={ready} online onLoad={vi.fn()} now={later} />);
    expect(screen.getByText(WEATHER.copy.outOfDate)).toBeTruthy();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("refreshes online, and is disabled with its reason offline", () => {
    const onLoad = vi.fn();
    const { rerender } = render(
      <WeatherView state={ready} online onLoad={onLoad} now={now} />,
    );
    fireEvent.click(screen.getByRole("button", { name: WEATHER.copy.refresh }));
    expect(onLoad).toHaveBeenCalledTimes(1);
    rerender(
      <WeatherView state={ready} online={false} onLoad={onLoad} now={now} />,
    );
    const refresh = screen.getByRole("button", { name: WEATHER.copy.refresh });
    fireEvent.click(refresh);
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(refresh.getAttribute("aria-disabled")).toBe("true");
  });

  it("says loading, and failed with Try again only online", () => {
    const onLoad = vi.fn();
    const { rerender } = render(
      <WeatherView state={{ status: "loading" }} online onLoad={onLoad} />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      WEATHER.copy.loading,
    );
    rerender(
      <WeatherView state={{ status: "failed" }} online onLoad={onLoad} />,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      WEATHER.copy.failed,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onLoad).toHaveBeenCalledTimes(1);
    rerender(
      <WeatherView
        state={{ status: "failed" }}
        online={false}
        onLoad={onLoad}
      />,
    );
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});

describe("PlaceWeather", () => {
  // The privacy boundary of ADR 0035 as this page meets it. Mutation that turns
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
    expect(await screen.findByText(WEATHER.copy.pastRain)).toBeTruthy();
  });

  // Mutation that turns it red: drop the focus effect in WeatherView.
  it("keeps focus in the view when Show and Refresh swap their own button away", async () => {
    stubFetch();
    const { container } = render(
      <PlaceWeather point={spot} elevationM={null} />,
    );
    fireEvent.click(screen.getByRole("button", { name: WEATHER.copy.show }));
    await screen.findByText(WEATHER.copy.pastRain);
    expect(container.contains(document.activeElement)).toBe(true);
    const refresh = screen.getByRole("button", { name: WEATHER.copy.refresh });
    refresh.focus();
    fireEvent.click(refresh);
    await screen.findByText(WEATHER.copy.pastRain);
    expect(container.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
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
