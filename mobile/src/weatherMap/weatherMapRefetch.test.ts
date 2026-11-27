import { readFileSync } from "node:fs";
import { WEATHER_MAP } from "@logjam/shared";
import { describe, expect, it } from "vitest";

import { weatherFetchDue } from "./weatherMapRefetch";

const NOW = Date.parse("2026-11-07T12:00Z");
const on = { enabled: true, online: true, fetchedAt: null, now: NOW } as const;
const HOUR = WEATHER_MAP.refreshAfterMs;

describe("weatherFetchDue", () => {
  // Mutation: ignore `enabled`, and a layer that is off fetches on every
  // return to the front.
  it("fetches on turn-on when nothing is held, and never while off", () => {
    expect(weatherFetchDue(on)).toBe(true);
    expect(weatherFetchDue({ ...on, enabled: false })).toBe(false);
  });

  // Mutation: ignore `online`, and regained signal and a foreground offline
  // both start a fetch that cannot work.
  it("never fetches offline", () => {
    expect(weatherFetchDue({ ...on, online: false })).toBe(false);
    expect(weatherFetchDue({ ...on, online: false, fetchedAt: 0 })).toBe(false);
  });

  // Mutation: fetch whenever asked, and every return to the front within the
  // hour is a request.
  it("keeps a manifest under an hour old on a return to the front", () => {
    expect(weatherFetchDue({ ...on, fetchedAt: NOW - HOUR + 1 })).toBe(false);
  });

  // Mutation: compare with `>` instead of `>=`, or drop the age, and a tab
  // left in the background an hour keeps drawing the run it had.
  it("fetches again once the manifest is an hour old", () => {
    expect(weatherFetchDue({ ...on, fetchedAt: NOW - HOUR })).toBe(true);
    expect(weatherFetchDue({ ...on, fetchedAt: NOW - 5 * HOUR })).toBe(true);
  });

  // Mutation: treat a Retry's 0 as fresh (`fetchedAt || NOW`), and Retry does
  // nothing.
  it("fetches at once after a Retry", () => {
    expect(weatherFetchDue({ ...on, fetchedAt: 0 })).toBe(true);
  });

  // Regained signal is the same question asked again with `online` true.
  it("fetches when signal returns to a stale or empty overlay, not a fresh one", () => {
    expect(weatherFetchDue({ ...on, fetchedAt: null })).toBe(true);
    expect(weatherFetchDue({ ...on, fetchedAt: NOW - HOUR - 1 })).toBe(true);
    expect(weatherFetchDue({ ...on, fetchedAt: NOW - 60_000 })).toBe(false);
  });
});

// The hook has no renderer here; what it must never do is poll. Mutation: ask
// for the manifest from the clock's interval, and the overlay polls the CDN.
describe("useWeatherMap", () => {
  const source = readFileSync(
    new URL("./useWeatherMap.ts", import.meta.url),
    "utf8",
  );
  it("has one timer, and it only moves the clock", () => {
    expect(source.match(/setInterval\(/g)).toHaveLength(1);
    expect(source).toMatch(
      /setInterval\(\(\) => setNow\(Date\.now\(\)\), WEATHER_MAP\.clockMs\)/,
    );
  });
  it("asks only through weatherFetchDue", () => {
    expect(source.match(/fetchWeatherManifest\(/g)).toHaveLength(1);
    expect(source).toContain("weatherFetchDue(");
  });
});
