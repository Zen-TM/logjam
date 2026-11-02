import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyAccountScheme,
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

  // Mutation: a Settings pick of Ghost Gum is read as Bright light (the switch
  // from the scheme id, not the flag), and off then goes dark with no way back.
  it("is off when Ghost Gum was picked by name", () => {
    setThemeSchemeId(BRIGHT_LIGHT_SCHEME_ID);
    expect(isBrightLight()).toBe(false);
    setBrightLight(false);
    expect(getThemeSchemeId()).toBe(BRIGHT_LIGHT_SCHEME_ID);
  });
});

describe("the account's scheme while Bright light is on", () => {
  // Mutation: drop the isBrightLight() check in applyAccountScheme, and a
  // launch or a refetch turns the sun off.
  it("waits instead of painting", () => {
    setBrightLight(true);
    applyAccountScheme("basalt");
    expect(getThemeSchemeId()).toBe(BRIGHT_LIGHT_SCHEME_ID);
    expect(isBrightLight()).toBe(true);
  });

  // Mutation: restore the scheme remembered when it went on, and a scheme
  // changed on Logjam Web meanwhile never comes back to this phone.
  it("is what off returns to", () => {
    setThemeSchemeId("sandstone");
    setBrightLight(true);
    applyAccountScheme("scribblyGum");
    setBrightLight(false);
    expect(getThemeSchemeId()).toBe("scribblyGum");
  });

  it("is painted when Bright light is off", () => {
    applyAccountScheme("basalt");
    expect(getThemeSchemeId()).toBe("basalt");
  });

  it("ignores what is not a scheme", () => {
    applyAccountScheme("not-a-scheme");
    applyAccountScheme(undefined);
    expect(getThemeSchemeId()).toBe("sandstone");
  });
});
