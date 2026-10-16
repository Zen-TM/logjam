import { describe, it, expect } from "vitest";

import { fileNameWithoutExtension, importDisplayName } from "./importName";

describe("fileNameWithoutExtension", () => {
  it("drops the extension and nothing else", () => {
    expect(fileNameWithoutExtension("Ridge approach.gpx")).toBe(
      "Ridge approach",
    );
    expect(fileNameWithoutExtension("a.b.geojson")).toBe("a.b");
    expect(fileNameWithoutExtension("no-extension")).toBe("no-extension");
  });
});

describe("importDisplayName", () => {
  // THE RULE THIS FILE EXISTS FOR: the inbox promises a name, so Saved shows
  // that name. Otherwise, a file accepted as "Ridge approach.gpx" would appear as
  // whatever the GPX internally called itself, giving the recipient no way to tell
  // it is the same object.
  it("names a received copy for the file, not for what the file calls itself", () => {
    expect(
      importDisplayName({
        contentName: "Track 001",
        filename: "Ridge approach.gpx",
        sentBy: "bob",
      }),
    ).toBe("Ridge approach");
  });

  it("keeps preferring the content name on every other import path", () => {
    expect(
      importDisplayName({
        contentName: "Claustral exit",
        filename: "export-2026-08-30.gpx",
        sentBy: null,
      }),
    ).toBe("Claustral exit");
  });

  it("falls back to the file name when the file is nameless", () => {
    expect(
      importDisplayName({
        contentName: null,
        filename: "waypoints.kml",
        sentBy: null,
      }),
    ).toBe("waypoints");
    expect(
      importDisplayName({
        contentName: null,
        filename: "waypoints.kml",
        sentBy: "bob",
      }),
    ).toBe("waypoints");
  });
});
