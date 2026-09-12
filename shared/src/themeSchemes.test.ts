import { describe, it, expect } from "vitest";
import {
  isThemeSchemeId,
  isNotificationPreferences,
  normalizeUserUiPreferences,
  normalizeImportMergePolicy,
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

  // The direction of the default is the whole point: an account that predates
  // the field, or one whose stored value is junk, COPIES media. Not copying is
  // the silent loss — the sharee's photos go, and on the phone so do the cached
  // blobs — while copying fails loudly at the quota with a 507 they can read.
  it("defaults copyPlaceMedia to true, including for junk and absent values", () => {
    expect(normalizeUserUiPreferences(null).copyPlaceMedia).toBe(true);
    expect(normalizeUserUiPreferences({}).copyPlaceMedia).toBe(true);
    expect(normalizeUserUiPreferences({ copyPlaceMedia: "no" }).copyPlaceMedia).toBe(true);
  });

  it("keeps an explicit copyPlaceMedia of false", () => {
    expect(normalizeUserUiPreferences({ copyPlaceMedia: false }).copyPlaceMedia).toBe(
      false,
    );
  });

  it("clamps an invalid themeSchemeId to the default", () => {
    const result = normalizeUserUiPreferences({ themeSchemeId: "granite" });
    expect(result.themeSchemeId).toBe(DEFAULT_THEME_SCHEME_ID);
  });

  it("keeps a valid themeSchemeId", () => {
    const result = normalizeUserUiPreferences({ themeSchemeId: "basalt" });
    expect(result.themeSchemeId).toBe("basalt");
  });

  it("repairs the legacy type:\"text\" alias to \"string\"", () => {
    const result = normalizeUserUiPreferences({
      tripLogCustomFields: [{ key: "water_level", label: "Water Level", type: "text" }],
    });
    // Legacy "text" is repaired to the canonical "string" so the def passes the
    // strict write-side guard and can round-trip without a 400.
    expect(result.tripLogCustomFields).toEqual([
      { key: "water_level", label: "Water Level", type: "string" },
    ]);
  });

  it("drops defs the strict guard rejects, repairs the rest", () => {
    const result = normalizeUserUiPreferences({
      tripLogCustomFields: [
        { key: "k1", label: "L1", type: "text" }, // repaired -> "string"
        { key: "k2", label: "missing type" }, // dropped
        "not an object", // dropped
        { key: 3, label: "bad key", type: "text" }, // dropped (non-string key)
        { key: "k5", label: "", type: "string" }, // dropped (empty label)
        { key: "k6", label: "bad type", type: "frobnicate" }, // dropped (invalid type)
      ],
    });
    expect(result.tripLogCustomFields).toEqual([
      { key: "k1", label: "L1", type: "string" },
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
      exportEmail: DEFAULT_NOTIFICATION_PREFERENCES.exportEmail,
      geoPdfEmail: DEFAULT_NOTIFICATION_PREFERENCES.geoPdfEmail,
      friendRequestInApp: DEFAULT_NOTIFICATION_PREFERENCES.friendRequestInApp,
      shareInApp: DEFAULT_NOTIFICATION_PREFERENCES.shareInApp,
    });
  });

  it("uses all notification defaults when notifications missing", () => {
    const result = normalizeUserUiPreferences({ themeSchemeId: "ironbark" });
    expect(result.notifications).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });
});

describe("normalizeImportMergePolicy", () => {
  const POLICY = {
    notes: "keepExisting" as const,
    v_grade: "keepExisting" as const,
    water_temp: "useIncoming" as const,
  };

  it("round-trips a policy keyed by field keys", () => {
    expect(normalizeImportMergePolicy(POLICY)).toEqual(POLICY);
  });

  // A key the normalizer does not know has to survive the round trip: the
  // policy is keyed by the user's own definition keys, and an earlier
  // normalizer silently dropped anything it could not find in a field list it
  // rebuilt from — losing the user's per-field "use file" choice.
  it("preserves an entry keyed by a definition it does not know", () => {
    expect(normalizeImportMergePolicy(POLICY)?.water_temp).toBe("useIncoming");
  });

  // BEHAVIOUR CHANGE, deliberate. The policy used to be a fixed seven-entry
  // union of grade columns, so demanding every entry was meaningful. Its keys
  // are field KEYS now — an open set that differs per user and per place type —
  // and rejecting a partial policy would silently revert every merge choice the
  // user had made the moment they added or deleted a field. A missing entry
  // already means keepExisting, which is the safe direction.
  it("accepts a partial policy instead of rejecting it", () => {
    expect(normalizeImportMergePolicy({ notes: "useIncoming" })).toEqual({
      notes: "useIncoming",
    });
  });

  it("drops a malformed entry rather than the whole policy", () => {
    expect(
      normalizeImportMergePolicy({ notes: "useFile", v_grade: "useIncoming" }),
    ).toEqual({ v_grade: "useIncoming" });
  });

  // Unknown keys are KEPT, because with an open key set there is no way to tell
  // an unknown key from a field this reader has not been told about. An entry
  // for a field that does not exist is inert — nothing merges it.
  it("keeps an entry whose field it cannot verify", () => {
    expect(normalizeImportMergePolicy({ somethingElse: "useIncoming" })).toEqual({
      somethingElse: "useIncoming",
    });
  });

  it("rejects a non-object", () => {
    expect(normalizeImportMergePolicy("nope")).toBeUndefined();
    expect(normalizeImportMergePolicy(null)).toBeUndefined();
    expect(normalizeImportMergePolicy(["a"])).toBeUndefined();
  });
});
