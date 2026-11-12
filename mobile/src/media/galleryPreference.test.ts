import { describe, expect, it, vi } from "vitest";

const stored = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("../prefsDb", () => ({
  readPref: () => stored.value,
  writePref: () => true,
}));

const { savesCapturesToGallery } = await import("./galleryPreference");

describe("savesCapturesToGallery", () => {
  // Mutation: read anything but the exact "on" as on (`!== "off"`, truthy).
  it("is on only for an explicit on, and off for anything absent or unexpected", () => {
    for (const value of [null, "", "off", "true", "ON", "1"]) {
      stored.value = value;
      expect(savesCapturesToGallery()).toBe(false);
    }
    stored.value = "on";
    expect(savesCapturesToGallery()).toBe(true);
  });
});
