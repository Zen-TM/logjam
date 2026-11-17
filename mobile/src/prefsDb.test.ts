// In plain node expo-sqlite cannot load, which is the "store unavailable" path.
import { describe, expect, it } from "vitest";
import { lastPrefWriteError, readPref, writePref } from "./prefsDb";
import { prefWriteErrorSentence } from "./prefWriteErrorSentence";

describe("prefsDb without a store", () => {
  // Mutation: return true (or leave lastWriteError null) when there is no db.
  it("reports a write it could not keep instead of dropping it silently", () => {
    expect(writePref("scheme", "dark")).toBe(false);
    expect(lastPrefWriteError()).toBe("unavailable");
    expect(prefWriteErrorSentence("unavailable")).toBe(
      "This phone's preference store isn't available.",
    );
    expect(prefWriteErrorSentence("not_stored")).toBe(
      "This phone wouldn't store that preference.",
    );
  });

  it("reads every key as unrecorded, so callers fall back to their default", () => {
    expect(readPref("scheme")).toBeNull();
  });
});
