import { describe, expect, it } from "vitest";
import { wayProperties, wayVerbs, type WaySurface } from "./wayActions";
import type { WayItem } from "./waysModel";

type Subject = Pick<WayItem, "kind" | "shared" | "placeId">;

const route = (over: Partial<Subject> = {}): Subject => ({
  kind: "route",
  shared: false,
  placeId: null,
  ...over,
});
const importFile = (over: Partial<Subject> = {}): Subject => ({
  kind: "import",
  shared: false,
  placeId: null,
  ...over,
});
const ids = (subject: Subject, surface: WaySurface = "row") =>
  wayVerbs(subject, surface).map((verb) => verb.id);

describe("wayVerbs", () => {
  // The rule the three surfaces were drifting away from.
  it("gives a row and a detail page the same verbs but for Open", () => {
    const subject = route({ placeId: "p1" });
    expect(ids(subject, "row")).toEqual(["open", ...ids(subject, "detail")]);
  });

  it("offers a detail page no Open, because you are looking at it", () => {
    expect(ids(route(), "detail")).not.toContain("open");
  });

  it("withholds every write verb on a way shared with you", () => {
    const shared = ids(route({ shared: true }));
    expect(shared).not.toContain("edit");
    expect(shared).not.toContain("share");
    expect(shared).not.toContain("delete");
    expect(shared).not.toContain("rename");
  });

  // Reading is what a share allows, and a route's geometry is already here.
  it("still lets a sharee export a route", () => {
    expect(ids(route({ shared: true }))).toEqual(expect.arrayContaining(["exportGpx", "exportKml"]));
  });

  // The endpoint has existed since sharing shipped; nothing on the web offered
  // it, so a sharee's only way to keep a route was export-and-reimport.
  it("lets a sharee take their own copy of a route", () => {
    expect(ids(route({ shared: true }))).toContain("copy");
  });

  it("offers no copy of something already yours", () => {
    expect(ids(route())).not.toContain("copy");
  });

  // A file on a shared place is media, and no copy endpoint takes one — so the
  // verb would 404 rather than do nothing.
  it("offers no copy of a shared file, which no endpoint can copy", () => {
    expect(ids(importFile({ shared: true }))).not.toContain("copy");
  });

  // It is a button in the draw tool now: it changes the geometry you are
  // looking at, so it belongs beside the other edits to that geometry.
  it("keeps Reverse out of every menu", () => {
    expect(ids(route())).not.toContain("reverse");
    expect(ids(route(), "detail")).not.toContain("reverse");
  });

  it("offers no editing of a file", () => {
    expect(ids(importFile())).not.toContain("edit");
  });

  // A file's bytes are in S3 and this page has not downloaded them.
  it("offers export only where the geometry is already here", () => {
    expect(ids(importFile())).not.toContain("exportGpx");
    expect(ids(route())).toContain("exportGpx");
  });

  it("renames a file in place, and leaves a route to its own form", () => {
    expect(ids(importFile())).toContain("rename");
    expect(ids(route())).not.toContain("rename");
  });

  it("offers its place only when it has one", () => {
    expect(ids(route({ placeId: "p1" }))).toContain("openPlace");
    expect(ids(route())).not.toContain("openPlace");
  });

  it("marks only the destructive verb", () => {
    const danger = wayVerbs(route(), "row").filter((verb) => verb.danger);
    expect(danger.map((verb) => verb.id)).toEqual(["delete"]);
  });

  it("puts the destructive verb last", () => {
    const list = ids(route());
    expect(list[list.length - 1]).toBe("delete");
  });
});

describe("wayProperties", () => {
  it("lets the owner change a route's colour and nobody else", () => {
    expect(wayProperties(route()).colour).toBe(true);
    expect(wayProperties(route({ shared: true })).colour).toBe(false);
  });

  // PATCH /media/:id takes a display name and nothing else, so a picker on a
  // file would set a colour the server never stores.
  it("offers no colour on a file, which the API cannot change", () => {
    expect(wayProperties(importFile()).colour).toBe(false);
  });

  it("always says where a way lives", () => {
    expect(wayProperties(route()).place).toBe(true);
    expect(wayProperties(importFile({ shared: true })).place).toBe(true);
  });

  // The Layers overlays draw these files now, so a per-item switch buried on a
  // detail page has nothing left to do (operator, 2026-09-17).
  it("has no per-item visibility switch left to offer", () => {
    expect(wayProperties(importFile())).not.toHaveProperty("visibility");
  });
});
