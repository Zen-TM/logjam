import { describe, it, expect } from "vitest";
import {
  isThemeSchemeId,
  isNotificationPreferences,
  normalizeUserUiPreferences,
  DEFAULT_THEME_SCHEME_ID,
  DEFAULT_NOTIFICATION_PREFERENCES,
  THEME_SCHEME_ORDER,
} from "./themeSchemes.js";

describe("isThemeSchemeId", () => {
  it("accepts every known scheme id", () => {
    for (const id of THEME_SCHEME_ORDER) {
      expect(isThemeSchemeId(id)).toBe(true);
    }
  });
  it("rejects unknown strings and non-strings", () => {
    expect(isThemeSchemeId("granite")).toBe(false);
    expect(isThemeSchemeId("")).toBe(false);
    expect(isThemeSchemeId(null)).toBe(false);
    expect(isThemeSchemeId(42)).toBe(false);
    // Must not be fooled by inherited Object prototype props.
    expect(isThemeSchemeId("toString")).toBe(false);
  });
});

describe("isNotificationPreferences", () => {
  it("accepts a full valid object", () => {
    expect(
      isNotificationPreferences({
        topoEmail: false,
        friendRequestInApp: true,
        shareInApp: false,
      }),
    ).toBe(true);
  });
  it("accepts a partial object (keys optional)", () => {
    expect(isNotificationPreferences({ topoEmail: true })).toBe(true);
    expect(isNotificationPreferences({})).toBe(true);
  });
  it("rejects when a present key is the wrong type", () => {
    expect(isNotificationPreferences({ topoEmail: "yes" })).toBe(false);
    expect(isNotificationPreferences({ shareInApp: 1 })).toBe(false);
  });
  it("rejects non-objects", () => {
    expect(isNotificationPreferences(null)).toBe(false);
    expect(isNotificationPreferences("x")).toBe(false);
  });
});

describe("normalizeUserUiPreferences", () => {
  it("returns defaults for non-object input", () => {
    const result = normalizeUserUiPreferences(null);
    expect(result.themeSchemeId).toBe(DEFAULT_THEME_SCHEME_ID);
    expect(result.tripLogCustomFields).toEqual([]);
    expect(result.notifications).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it("clamps an invalid themeSchemeId to the default", () => {
    const result = normalizeUserUiPreferences({ themeSchemeId: "granite" });
    expect(result.themeSchemeId).toBe(DEFAULT_THEME_SCHEME_ID);
  });

  it("keeps a valid themeSchemeId", () => {
    const result = normalizeUserUiPreferences({ themeSchemeId: "basalt" });
    expect(result.themeSchemeId).toBe("basalt");
  });

  it("filters out malformed custom field entries", () => {
    const result = normalizeUserUiPreferences({
      tripLogCustomFields: [
        { key: "k1", label: "L1", type: "text" },
        { key: "k2", label: "missing type" }, // dropped
        "not an object", // dropped
        { key: 3, label: "bad key", type: "text" }, // dropped
      ],
    });
    expect(result.tripLogCustomFields).toEqual([
      { key: "k1", label: "L1", type: "text" },
    ]);
  });

  it("defaults tripLogCustomFields to [] when not an array", () => {
    const result = normalizeUserUiPreferences({ tripLogCustomFields: "nope" });
    expect(result.tripLogCustomFields).toEqual([]);
  });

  it("falls back per-key for partial notifications", () => {
    const result = normalizeUserUiPreferences({
      notifications: { topoEmail: false, shareInApp: "bad" },
    });
    expect(result.notifications).toEqual({
      topoEmail: false,
      friendRequestInApp: DEFAULT_NOTIFICATION_PREFERENCES.friendRequestInApp,
      shareInApp: DEFAULT_NOTIFICATION_PREFERENCES.shareInApp,
    });
  });

  it("uses all notification defaults when notifications missing", () => {
    const result = normalizeUserUiPreferences({ themeSchemeId: "ironbark" });
    expect(result.notifications).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });
});
