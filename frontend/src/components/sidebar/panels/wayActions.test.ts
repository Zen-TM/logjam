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
    expect(shared).not.toContain("reverse");
    expect(shared).not.toContain("share");
    expect(shared).not.toContain("delete");
    expect(shared).not.toContain("rename");
  });

  // Reading is what a share allows, and a route's geometry is already here.
  it("still lets a sharee export a route", () => {
    expect(ids(route({ shared: true }))).toEqual(expect.arrayContaining(["exportGpx", "exportKml"]));
  });

  it("offers no direction to reverse on a file", () => {
    expect(ids(importFile())).not.toContain("reverse");
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

  // A switch that would do nothing is worse than no switch: both of these are
  // already drawn by a layer of their own.
  it("offers a visibility switch only to a file that has no layer of its own", () => {
    expect(wayProperties(importFile()).visibility).toBe(true);
    expect(wayProperties(route()).visibility).toBe(false);
    expect(wayProperties(importFile({ placeId: "p1" })).visibility).toBe(false);
    expect(wayProperties(importFile({ shared: true })).visibility).toBe(false);
  });

  it("always says where a way lives", () => {
    expect(wayProperties(route()).place).toBe(true);
    expect(wayProperties(importFile({ shared: true })).place).toBe(true);
  });
});
