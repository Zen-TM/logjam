import { WEATHER_MAP, parseWeatherMap } from "@logjam/shared";
import { describe, expect, it } from "vitest";
import { weatherView, type WeatherMapState } from "./weatherView";

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
  steps: [0, 1, 2, 3, 4].map((i) => ({
    time: new Date(T0 + i * hour).toISOString(),
    hours: 1,
  })),
  totals: ["rainPast24"],
  attribution: WEATHER_MAP.credit,
})!;
const ready: WeatherMapState = { status: "ready", file };
const view = (over: Partial<Parameters<typeof weatherView>[0]> = {}) =>
  weatherView({
    on: true,
    state: ready,
    layerKey: "rain",
    pick: null,
    now: T0 + hour / 2,
    ...over,
  });

describe("weatherView", () => {
  // Mutation: return the view while off, and a hidden overlay draws and asks.
  it("is off while the switch is, whatever the files say", () => {
    expect(view({ on: false })).toEqual({ kind: "off" });
  });

  it("passes loading and failed through", () => {
    expect(view({ state: { status: "loading" } }).kind).toBe("loading");
    expect(view({ state: { status: "failed" } }).kind).toBe("failed");
  });

  // Mutation: use the pick whatever run it was made in, and the first turn-on
  // after a new run opens on a time the user never chose.
  it("counts a pick only in the run it was made in", () => {
    const at = (path: string) => {
      const v = view({ pick: { path, step: 3 }, now: T0 + 0.5 * hour });
      return v.kind === "ready" ? v.step : null;
    };
    expect(at(file.path)).toBe(3);
    expect(at("runs/20261106T1800Z-20261107T0300Z/")).toBe(1);
  });

  // Mutation: map shared's `outOfDate` to `ready`, and a forecast that has run
  // out is drawn as today's.
  it("passes a run that has run out through", () => {
    expect(view({ now: T0 + 10 * hour })).toEqual({ kind: "outOfDate" });
  });

  // Mutation: draw a total the run lacks from a made-up URL, and every tile 404s.
  it("reads a total this run lacks as missing", () => {
    expect(view({ layerKey: "rainNext72" }).kind).toBe("missing");
  });
});
