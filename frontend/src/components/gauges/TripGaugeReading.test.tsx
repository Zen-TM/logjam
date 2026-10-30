// Mutations that turn it red: fetch a history on every render or timer tick;
// draw an error for a 404; draw the trip reading for a sharee (`owned &&` in
// PlaceGauge); drop the credit from the reading.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GAUGES } from "@logjam/shared";
import historyJson from "../../../../shared/src/__fixtures__/gauge-history.json";
import latestJson from "../../../../shared/src/__fixtures__/gauges-latest.json";
import { PlaceGauge } from "./PlaceGauge";
import { TripGaugeReading } from "./TripGaugeReading";

const HISTORY = "/master/gauges/v1/history/900001.json";
let fetched: string[];
let historyStatus: number;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-10-30T12:00:00Z"));
  fetched = [];
  historyStatus = 200;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      fetched.push(url);
      return Promise.resolve(
        url === HISTORY
          ? historyStatus === 200
            ? Response.json(historyJson)
            : new Response("", { status: historyStatus })
          : Response.json(latestJson),
      );
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const trip = "2026-10-01T00:00:00.000Z";

describe("a trip's river gauge reading", () => {
  it("shows the trip's date beside now, with the credit, from one history request", async () => {
    const { rerender } = render(
      <TripGaugeReading
        gaugeIds={["900001"]}
        dates={[trip]}
        when="trip"
        title="River gauge"
      />,
    );
    await screen.findByText(
      /0\.91 m and 121 ML\/d on this trip, 0\.95 m and 130 ML\/d now\./,
    );
    expect(
      screen.getByText(/History via the Bureau of Meteorology/),
    ).toBeTruthy();
    rerender(
      <TripGaugeReading
        gaugeIds={["900001"]}
        dates={[trip]}
        when="trip"
        title="River gauge"
      />,
    );
    expect(fetched.filter((u) => u === HISTORY)).toHaveLength(1);
  });

  it("draws nothing for a history that is not published yet", async () => {
    historyStatus = 404;
    const { container } = render(
      <TripGaugeReading
        gaugeIds={["900001"]}
        dates={[trip]}
        when="trip"
        title="River gauge"
      />,
    );
    await vi.waitFor(() => expect(fetched).toContain(HISTORY));
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe("");
    expect(screen.queryByText(GAUGES.copy.failed)).toBeNull();
  });

  it("asks for nothing when no place has a gauge", () => {
    render(<TripGaugeReading gaugeIds={[]} dates={[trip]} when="trip" />);
    expect(fetched).toEqual([]);
  });
});

describe("the place page's reading", () => {
  const place = { latitude: -33.5, longitude: 150.3, gaugeId: "900001" };

  it("shows the owner the latest trip's reading", async () => {
    render(
      <PlaceGauge {...place} owned tripDates={[trip]} onChange={vi.fn()} />,
    );
    await screen.findByText(/0\.91 m and 121 ML\/d on your last trip here/);
  });

  it("shows a sharee none, and asks for no history", async () => {
    render(
      <PlaceGauge
        {...place}
        owned={false}
        tripDates={[trip]}
        onChange={vi.fn()}
      />,
    );
    await screen.findByText("Made Up River at One");
    expect(screen.queryByText(/on your last trip here/)).toBeNull();
    expect(fetched).not.toContain(HISTORY);
  });
});
