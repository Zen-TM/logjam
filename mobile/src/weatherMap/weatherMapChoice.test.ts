import { describe, expect, it } from "vitest";

import { weatherFixture as run } from "./weatherMapFixture";
import { chooseWeatherRun } from "./weatherMapChoice";

const kept = { ...run, path: "runs/20261106T1800Z/" } as const;
const base = { enabled: true, online: true, settled: true } as const;

// Mutation: fall back to the kept run before the CDN has answered, and a
// phone with a kept run draws it and then swaps to the new one, re-reading
// every archive; return `kept` when online and fetched, and the overlay
// shows a day-old run beside a fresh one on the CDN.
describe("chooseWeatherRun", () => {
  it("draws nothing while the overlay is off", () => {
    expect(
      chooseWeatherRun({ ...base, enabled: false, fetched: run, kept }),
    ).toBeNull();
  });

  it("draws the CDN's run online, whatever is kept", () => {
    expect(chooseWeatherRun({ ...base, fetched: run, kept })).toBe(run);
  });

  it("waits for the CDN's first answer online", () => {
    expect(
      chooseWeatherRun({ ...base, settled: false, fetched: null, kept }),
    ).toBeNull();
  });

  it("falls back to the kept run when the CDN gave nothing", () => {
    expect(chooseWeatherRun({ ...base, fetched: null, kept })).toBe(kept);
    expect(chooseWeatherRun({ ...base, fetched: null, kept: null })).toBeNull();
  });

  it("draws the kept run offline, never the CDN's", () => {
    expect(
      chooseWeatherRun({ ...base, online: false, fetched: run, kept }),
    ).toBe(kept);
    expect(
      chooseWeatherRun({ ...base, online: false, fetched: run, kept: null }),
    ).toBeNull();
  });
});
