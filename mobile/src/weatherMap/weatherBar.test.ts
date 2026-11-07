import { MAP_TERRAIN } from "@logjam/shared";
import { describe, expect, it } from "vitest";

import { weatherFixture as file } from "./weatherMapFixture";
import { weatherBarModel, weatherDrawnStep } from "./weatherBar";

const copy = MAP_TERRAIN.copy;
// 10 am Sydney time on the 7th is 23:00Z the day before; the steps are in UTC,
// so pick `now` by instant: halfway between the first and second step.
const NOW = Date.parse("2026-11-07T09:30Z");
const base = {
  status: "ready",
  file,
  layer: "rain",
  picked: null,
  now: NOW,
  online: true,
} as const;

describe("weatherBarModel", () => {
  // Mutation: start at step 0 instead of the step now falls in, and the bar
  // opens on an hour that is already past.
  it("starts a stepped layer at the step now falls in", () => {
    const model = weatherBarModel(base);
    expect(model.kind).toBe("ready");
    if (model.kind !== "ready") return;
    expect(model.scrub).toMatchObject({ first: 1, last: 3, step: 1 });
    expect(model.title).toBe("Rain (mm/h)");
    expect(model.detail).toContain("Updated");
    expect(weatherDrawnStep(model)).toBe(1);
  });

  // Mutation: let `picked` through unclamped, and a pick from the run before
  // (more steps) indexes past this run's last archive.
  it("holds a pick to the steps the run has and from now on", () => {
    const past = weatherBarModel({
      ...base,
      picked: { path: file.path, step: 99 },
    });
    expect(past.kind === "ready" && past.scrub?.step).toBe(3);
    const early = weatherBarModel({
      ...base,
      picked: { path: file.path, step: -4 },
    });
    expect(early.kind === "ready" && early.scrub?.step).toBe(1);
  });

  // Mutation: draw a stepped layer from a run whose steps are all past, and
  // yesterday's forecast shows as today's.
  it("says a stepped layer has run out and draws nothing", () => {
    const model = weatherBarModel({
      ...base,
      now: Date.parse("2026-11-09T00:00Z"),
    });
    expect(model).toEqual({ kind: "outOfDate", text: copy.weatherOutOfDate });
    expect(weatherDrawnStep(model)).toBeNull();
  });

  // Mutation: give a total a scrubber, and it offers steps its one archive
  // does not have.
  it("shows a total as its window, with no scrubber", () => {
    const model = weatherBarModel({ ...base, layer: "rainNext24" });
    expect(model.kind === "ready" && model.scrub).toBeNull();
    expect(model.kind === "ready" && model.detail).toMatch(/^To /);
    expect(weatherDrawnStep(model)).toBe(0);
  });

  // Mutation: treat a total the run leaves out as ready, and the bar shows a
  // window over a map that draws nothing.
  it("fails, without a retry, for a total the run does not have", () => {
    expect(weatherBarModel({ ...base, layer: "rainPast72" })).toEqual({
      kind: "failed",
      text: copy.weatherFailed,
      canRetry: false,
    });
  });

  // Mutation: offer a retry offline, and it presses a button that can't work.
  it("offers a retry only online", () => {
    const failed = { ...base, status: "failed", file: null } as const;
    expect(weatherBarModel(failed)).toMatchObject({
      kind: "failed",
      canRetry: true,
    });
    expect(weatherBarModel({ ...failed, online: false })).toMatchObject({
      kind: "failed",
      canRetry: false,
    });
  });

  it("says it is loading until the first answer", () => {
    expect(weatherBarModel({ ...base, status: "loading", file: null })).toEqual(
      {
        kind: "loading",
        text: copy.weatherLoading,
      },
    );
  });

  // Mutation: age the run from the clock when it was kept, and an offline run
  // reads "Updated just now" the day it was saved.
  it("ages the run from when it was built", () => {
    const model = weatherBarModel({
      ...base,
      layer: "rainNext24",
      now: Date.parse("2026-11-07T12:30Z"),
    });
    expect(model.kind === "ready" && model.detail).toContain("Updated 3 h ago");
  });
});
