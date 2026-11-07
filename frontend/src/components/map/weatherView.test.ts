import { WEATHER_MAP, parseWeatherMap } from "@logjam/shared";
import { describe, expect, it } from "vitest";
import {
  parseWindFile,
  weatherView,
  type WeatherMapState,
} from "./weatherView";

const hour = 3_600_000;
const T0 = Date.parse("2026-11-07T09:00:00Z");
const file = parseWeatherMap({
  format: 1,
  model: "ecmwf_ifs",
  run: "2026-11-07T00:00Z",
  built: "2026-11-07T09:07Z",
  anchor: "2026-11-07T09:00Z",
  path: "runs/20261107T0000Z/",
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
    chosen: null,
    now: T0 + hour / 2,
    base: "https://x.test",
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

  // Mutation: start at step 0 instead of weatherStepAt, and the map opens on
  // an hour already gone.
  it("starts at the step now falls in, with that step's archive", () => {
    const v = view({ now: T0 + 1.5 * hour });
    expect(v).toMatchObject({
      kind: "ready",
      step: 2,
      first: 2,
      last: 4,
      url: "https://x.test/master/weather/v1/runs/20261107T0000Z/rain/002.pmtiles",
    });
  });

  // Mutation: drop the clamp, and a pick from before a later turn-on (or past
  // the last step) asks for an archive that is gone or doesn't exist.
  it("keeps a picked step inside the steps still to come", () => {
    const at = (chosen: number) => {
      const v = view({ chosen, now: T0 + 0.5 * hour });
      return v.kind === "ready" ? v.step : null;
    };
    expect([at(0), at(3), at(99)]).toEqual([1, 3, 4]);
  });

  // Mutation: draw a run whose last step is past, and it is shown as today's.
  it("draws nothing for a stepped layer once every step is past", () => {
    expect(view({ now: T0 + 10 * hour }).kind).toBe("outOfDate");
  });

  // Mutation: give a total a scrubber (step not null), and it offers steps that
  // change nothing.
  it("gives a total one archive, no step, and its window as the time", () => {
    const v = view({ layerKey: "rainPast24", chosen: 3 });
    expect(v).toMatchObject({
      kind: "ready",
      step: null,
      url: "https://x.test/master/weather/v1/runs/20261107T0000Z/totals/rainPast24.pmtiles",
    });
    expect(v.kind === "ready" && v.shown).toMatch(/^To /);
  });

  // Mutation: draw a total the run lacks from a made-up URL, and every tile 404s.
  it("reads a total this run lacks as failed", () => {
    expect(view({ layerKey: "rainNext72" }).kind).toBe("failed");
  });

  it("says how old the run is", () => {
    const v = view({ now: T0 + 3 * hour });
    expect(v.kind === "ready" && v.age).toBe("Updated 2 h ago");
  });
});

describe("parseWindFile", () => {
  const good = {
    west: 139,
    north: -26,
    step: 0.5,
    columns: 2,
    rows: 1,
    steps: [{ speed: [1, 2], from: [90, 180] }],
  };
  // Mutation: return the raw JSON, and a file with no steps throws in the
  // arrow builder on every frame.
  it("takes a well-formed file and refuses the rest", () => {
    expect(parseWindFile(good)).toEqual(good);
    expect(parseWindFile(null)).toBeNull();
    expect(parseWindFile({ ...good, steps: undefined })).toBeNull();
    expect(parseWindFile({ ...good, columns: "2" })).toBeNull();
    expect(parseWindFile({ ...good, steps: [{ speed: [] }] })).toBeNull();
  });
});
