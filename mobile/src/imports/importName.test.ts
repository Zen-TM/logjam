import { describe, it, expect } from "vitest";

import { fileNameWithoutExtension, importDisplayName } from "./importName";

describe("fileNameWithoutExtension", () => {
  it("drops the extension and nothing else", () => {
    expect(fileNameWithoutExtension("Ridge approach.gpx")).toBe("Ridge approach");
    expect(fileNameWithoutExtension("a.b.geojson")).toBe("a.b");
    expect(fileNameWithoutExtension("no-extension")).toBe("no-extension");
  });
});

describe("importDisplayName", () => {
  // THE RULE THIS FILE EXISTS FOR: the inbox promised a name, so Saved shows
  // that name. Without this a file accepted as "Ridge approach.gpx" appeared as
  // whatever the GPX called itself, and the recipient had no way to tell it was
  // the same object.
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
      importDisplayName({ contentName: null, filename: "waypoints.kml", sentBy: null }),
    ).toBe("waypoints");
    expect(
      importDisplayName({ contentName: null, filename: "waypoints.kml", sentBy: "bob" }),
    ).toBe("waypoints");
  });
});
