import { beforeEach, describe, expect, it, vi } from "vitest";
import { RASTER_TEMPLATE_DEFAULTS } from "@logjam/shared";

const prefs = vi.hoisted(() => new Map<string, string>());
vi.mock("../prefsDb", () => ({
  readPref: (key: string) => prefs.get(key) ?? null,
  writePref: (key: string, value: string) => (prefs.set(key, value), true),
}));

const bands = [{ fromDeg: 30, toDeg: 90, colour: "#ff0000ff" }];
const load = () => import("./slopeBandsPreference");

beforeEach(() => {
  vi.resetModules();
  prefs.clear();
});

describe("the slope bands on Logjam GPS", () => {
  it("are the defaults until an account brings its own, then kept", async () => {
    const store = await load();
    expect(store.readSlopeBands()).toEqual(
      RASTER_TEMPLATE_DEFAULTS.slope.bands,
    );
    store.keepAccountSlopeBands(bands);
    expect(store.readSlopeBands()).toEqual(bands);
    expect(JSON.parse(prefs.get("mapSlopeBands")!)).toEqual(bands);
  });

  // Mutation: read only what the account sends, and a map opened with no
  // signal draws the default bands, not the user's.
  it("reads the kept bands at the next launch, offline", async () => {
    prefs.set("mapSlopeBands", JSON.stringify(bands));
    expect((await load()).readSlopeBands()).toEqual(bands);
  });

  it("ignores an account without bands, and a damaged copy", async () => {
    prefs.set("mapSlopeBands", "{not json");
    const store = await load();
    store.keepAccountSlopeBands(undefined);
    store.keepAccountSlopeBands([
      { fromDeg: 50, toDeg: 40, colour: "#ff0000ff" },
    ]);
    expect(store.readSlopeBands()).toEqual(
      RASTER_TEMPLATE_DEFAULTS.slope.bands,
    );
  });
});
