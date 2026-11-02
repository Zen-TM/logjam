import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BRIGHT_LIGHT_SCHEME_ID,
  getThemeSchemeId,
  isBrightLight,
  setBrightLight,
  setThemeSchemeId,
} from "./theme";

const store = vi.hoisted(() => new Map<string, string>());
vi.mock("./prefsDb", () => ({
  readPref: (key: string) => store.get(key) ?? null,
  writePref: (key: string, value: string) => {
    store.set(key, value);
    return true;
  },
}));

beforeEach(() => {
  store.clear();
  setThemeSchemeId("sandstone");
});

describe("Bright light", () => {
  it("flips to the sunlight scheme and back to the dark one it left", () => {
    setThemeSchemeId("basalt");
    setBrightLight(true);
    expect(getThemeSchemeId()).toBe(BRIGHT_LIGHT_SCHEME_ID);
    expect(isBrightLight()).toBe(true);
    setBrightLight(false);
    expect(getThemeSchemeId()).toBe("basalt");
    expect(isBrightLight()).toBe(false);
  });

  // Mutation: restore DEFAULT_THEME_SCHEME_ID instead of the remembered one,
  // and a Basalt user comes back to Sandstone.
  it("remembers a different dark scheme each time", () => {
    setThemeSchemeId("scribblyGum");
    setBrightLight(true);
    setBrightLight(false);
    expect(getThemeSchemeId()).toBe("scribblyGum");
  });

  // Mutation: drop the clear in setThemeSchemeId, and the account's scheme is
  // skipped for as long as the flag stays set.
  it("lets go when a scheme is picked by name", () => {
    setBrightLight(true);
    setThemeSchemeId("basalt");
    expect(isBrightLight()).toBe(false);
  });

  it("goes to a dark scheme when the sunlight one was already the pick", () => {
    setThemeSchemeId(BRIGHT_LIGHT_SCHEME_ID);
    setBrightLight(true);
    setBrightLight(false);
    expect(getThemeSchemeId()).toBe("sandstone");
  });
});
