import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GAUGES,
  GAUGE_LATEST_PATH,
  contractSectionKeys,
  parseGaugeLatest,
  type Gauge,
} from "@logjam/shared";
import latestJson from "../../../../shared/src/__fixtures__/gauges-latest.json";
import { GaugeLoadNotice } from "./GaugeLoadNotice";
import { GaugeView } from "./GaugeView";
import { GAUGE_REFRESH_MS, useGauges } from "./useGauges";

const file = parseGaugeLatest(latestJson)!;
const [withFlow, noFlow, empty] = file.gauges;
const now = Date.parse(file.generatedAt);

const view = (gauge: Gauge, at = now, generatedAt = file.generatedAt) =>
  render(
    <GaugeView
      gauge={gauge}
      attribution={file.attribution}
      generatedAt={generatedAt}
      now={at}
    />,
  );

afterEach(cleanup);

describe("GaugeView", () => {
  // Mutation that turns it red: leave a contract section out of the renderer
  // map in GaugeView.tsx, or draw one the contract does not name (tsc too).
  it("draws every section of the GAUGES contract, with the file's credit", () => {
    view({
      ...withFlow,
      readings: [
        [now / 1000 - 7200, 0.9, 120],
        [now / 1000 - 3600, 0.95, 130],
      ],
    });
    expect(contractSectionKeys(GAUGES, "web")).toEqual([
      "reading",
      "age",
      "graph",
      "credit",
    ]);
    expect(screen.getByText("Made Up River at One")).toBeTruthy();
    // The stat and its chart.
    expect(screen.getAllByText(GAUGES.copy.level)).toHaveLength(2);
    expect(screen.getAllByText(GAUGES.copy.flow)).toHaveLength(2);
    expect(screen.getByText("0.95 m")).toBeTruthy();
    expect(screen.getByText("130 ML/d")).toBeTruthy();
    expect(screen.getByText(/Latest reading 1 h ago/)).toBeTruthy();
    expect(screen.getByText(GAUGES.copy.graph)).toBeTruthy();
    expect(screen.getByText(file.attribution)).toBeTruthy();
  });

  // Mutation: draw the × outside the heading's row, or whatever `onClose` says.
  it("puts the way out on the name's line, only where it has its own surface", () => {
    const onClose = vi.fn();
    render(
      <GaugeView
        gauge={withFlow}
        attribution={file.attribution}
        generatedAt={file.generatedAt}
        now={now}
        onClose={onClose}
      />,
    );
    const close = screen.getByRole("button", { name: "Close" });
    expect(
      screen.getByRole("heading", { level: 2 }).parentElement?.contains(close),
    ).toBe(true);
    close.click();
    expect(onClose).toHaveBeenCalledOnce();
    cleanup();
    view(withFlow);
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  // Mutation: return a chart from `gaugeWeekCharts` at one reading.
  it("has no chart heading until there is a line to draw", () => {
    view({ ...withFlow, readings: [[now / 1000 - 3600, 0.95, 130]] });
    expect(screen.queryByText(GAUGES.copy.graph)).toBeNull();
  });

  // Mutation: draw the flow row whatever `hasFlow` says.
  it("shows no flow for a gauge without one, and still the credit", () => {
    view(noFlow);
    expect(screen.queryByText(GAUGES.copy.flow)).toBeNull();
    expect(screen.getByText("0.40 m")).toBeTruthy();
    expect(screen.getByText(file.attribution)).toBeTruthy();
  });

  // Mutation: take the level from the newest row, not the newest level.
  it("keeps an earlier level when the newest row has none, and says when a gauge has no level at all", () => {
    view(withFlow);
    expect(screen.getByText("0.95 m")).toBeTruthy();
    expect(screen.getByText("130 ML/d")).toBeTruthy();
    cleanup();
    view({ ...withFlow, readings: [[now / 1000 - 60, null, 12]] });
    expect(screen.getByText(GAUGES.copy.noLevel)).toBeTruthy();
    expect(screen.getByText("12 ML/d")).toBeTruthy();
  });

  // Mutation: draw one "Latest reading" line whatever each value's age.
  it("puts the age under each value when a stale level sits beside a fresh flow", () => {
    const sec = now / 1000;
    view({
      ...withFlow,
      readings: [
        [sec - 5 * 86400, 1.4, 5],
        [sec - 600, null, 7],
      ],
    });
    expect(screen.queryByText(/Latest reading/)).toBeNull();
    expect(screen.getByText("Level, 5 days ago")).toBeTruthy();
    expect(screen.getByText("Flow, 10 min ago")).toBeTruthy();
  });

  // Mutation: choose the chart from the raw readings, not from `latest`.
  it("charts the flow when the level is older than the week", () => {
    const sec = now / 1000;
    const later = now + 0.5 * 86400_000;
    view(
      {
        ...withFlow,
        readings: [
          [sec - 6.9 * 86400, 1.4, 5],
          [sec, null, 7],
        ],
      },
      later,
    );
    expect(screen.getByText(GAUGES.copy.noLevel)).toBeTruthy();
    expect(
      screen.getByRole("img", { name: /^Flow, last 7 days/ }),
    ).toBeTruthy();
  });

  it("says plainly that a gauge with no readings has none", () => {
    view(empty);
    expect(screen.getByText(GAUGES.copy.noRecent)).toBeTruthy();
    expect(screen.queryByText(GAUGES.copy.level)).toBeNull();
    expect(screen.queryByText(GAUGES.copy.graph)).toBeNull();
    expect(screen.getByText(file.attribution)).toBeTruthy();
  });

  it("shows a stale file's age and a reading older than a week as none", () => {
    const later = now + 8 * 86_400_000;
    view(withFlow, later);
    expect(
      screen.getByText(GAUGES.copy.noRecent, { exact: false }),
    ).toBeTruthy();
    expect(screen.getByText(/Readings last refreshed 8 days ago/)).toBeTruthy();
  });
});

describe("useGauges", () => {
  function Probe({ on }: { on: boolean }) {
    const { file: f, failed } = useGauges(on);
    return <p>{failed ? "failed" : f ? f.gauges.length : "none"}</p>;
  }
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // Mutation: never set `failed`, and a layer that could not load is silent.
  it("says a failed first load, and the next timer is the retry", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(Response.json(latestJson));
    vi.stubGlobal("fetch", fetch);
    render(<Probe on />);
    await act(async () => {});
    expect(screen.getByText("failed")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GAUGE_REFRESH_MS);
    });
    expect(screen.getByText("3")).toBeTruthy();
  });

  // Mutation: leave `failed` set when the layer goes off.
  it("does not show an old failure while a new attempt is in flight", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockReturnValue(new Promise(() => {}));
    vi.stubGlobal("fetch", fetch);
    const { rerender } = render(<Probe on />);
    await act(async () => {});
    expect(screen.getByText("failed")).toBeTruthy();
    rerender(<Probe on={false} />);
    rerender(<Probe on />);
    expect(screen.queryByText("failed")).toBeNull();
  });

  it("asks nothing while the layer is off", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<Probe on={false} />);
    expect(fetch).not.toHaveBeenCalled();
  });

  // Mutation: replace the parse with a cast, or clear the file on failure.
  it("fetches the public file, refreshes every five minutes and keeps the last good one", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(latestJson))
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValue(Response.json({ version: 9 }));
    vi.stubGlobal("fetch", fetch);
    render(<Probe on />);
    await act(async () => {});
    expect(screen.getByText("3")).toBeTruthy();
    expect(fetch.mock.calls[0][0]).toBe(`/${GAUGE_LATEST_PATH}`);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GAUGE_REFRESH_MS);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GAUGE_REFRESH_MS);
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(screen.getByText("3")).toBeTruthy();
  });
});

describe("GaugeLoadNotice", () => {
  // Mutation: drop the render, or draw it over a mode banner.
  it("says the layer could not load, and only when no mode banner is up", () => {
    const { rerender } = render(<GaugeLoadNotice failed modeActive={false} />);
    expect(screen.getByText(GAUGES.copy.failed)).toBeTruthy();
    rerender(<GaugeLoadNotice failed modeActive />);
    expect(screen.queryByText(GAUGES.copy.failed)).toBeNull();
    rerender(<GaugeLoadNotice failed={false} modeActive={false} />);
    expect(screen.queryByText(GAUGES.copy.failed)).toBeNull();
  });
});
