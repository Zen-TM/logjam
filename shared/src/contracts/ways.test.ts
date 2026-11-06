import { describe, expect, it } from "vitest";
import { MAP_LAYERS } from "./mapLayers.js";
import { WAY_IMPORT, WAY_KINDS, WAY_KIND_WORDS } from "./ways.js";

describe("WAY_KINDS", () => {
  // Mutation: add a kind to WAY_KINDS without words for it (tsc also refuses).
  it("has words for every kind", () => {
    expect(Object.keys(WAY_KIND_WORDS).sort()).toEqual([...WAY_KINDS].sort());
  });

  // Where a way lives is a property of the row, not a kind.
  it("names only what a way IS", () => {
    expect([...WAY_KINDS]).toEqual(["route", "track", "import"]);
  });
});

describe("WAY_IMPORT", () => {
  // Mutation: reword one entry. Logjam Web and Logjam GPS both read these, so
  // a change here is a change of words on both and must be made on purpose.
  it("pins the words both clients show", () => {
    expect(WAY_IMPORT.menu).toBe("Import GPX, KML or GeoJSON");
    expect(WAY_IMPORT.file).toBe("Import a file");
    expect(WAY_IMPORT.saved("Ridge")).toBe(
      "\u201cRidge\u201d is saved under Imports.",
    );
    expect(WAY_IMPORT.failed).toBe("Couldn't import that file.");
  });

  // Mutation: give the Layers row its own literal again.
  it("is the Layers row's name too", () => {
    expect(MAP_LAYERS.copy.importFile).toBe(WAY_IMPORT.file);
  });
});
