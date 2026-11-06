import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// "Copy photos too" is one contract entry (`COPY_MEDIA_SETTING`). Mutation: type
// the label back into the Privacy page or the copy sheet, or put the row back on
// Offline and storage.
const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

describe("Copy photos too", () => {
  it("is read from the contract where it is drawn and where it defaults from", () => {
    for (const file of [
      "./PrivacySettingsScreen.tsx",
      "../../sharing/CopySheet.tsx",
    ]) {
      const source = read(file);
      expect(source, file).toContain("COPY_MEDIA_SETTING.label");
      expect(source, file).not.toMatch(/title="Copy photos too"/);
    }
  });

  it("is no longer a row of Offline and storage", () => {
    expect(read("./OfflineSettingsScreen.tsx")).not.toContain("copyPlaceMedia");
  });
});
