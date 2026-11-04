// Adding a way to a place says the same thing on both clients. The words are
// `ADD_WAY`'s; this holds the decisions in them and reads each client's source
// to see it draws from them rather than typing its own.
//
// Mutations that turn it red: type "Choose a route you drew" into either
// client's file instead of `ADD_WAY.copy.routeTitle`; reword the
// uploaded-file confirm to say "kept"; make `routeSlotDisplaceConfirm` return
// a confirm for a free slot.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADD_WAY,
  addWayFileRow,
  addWayImportSubtitle,
  routeSlotDisplaceConfirm,
} from "./addWay.js";
import { contractSectionKeys } from "./types.js";

const repo = join(import.meta.dirname, "..", "..", "..");
const read = (file: string) => readFileSync(join(repo, file), "utf8");

describe("the Add a way panel's sources", () => {
  it("lists the same sources on both clients, but the pen on the phone only", () => {
    expect(contractSectionKeys(ADD_WAY, "web")).toEqual([
      "route",
      "track",
      "import",
      "file",
    ]);
    expect(contractSectionKeys(ADD_WAY, "gps")).toEqual([
      "route",
      "draw",
      "track",
      "import",
      "file",
    ]);
  });

  it("names the home of an import by client, and says the file row's different doing", () => {
    expect(addWayImportSubtitle("gps")).toContain("Saved");
    expect(addWayImportSubtitle("web")).toContain("Ways");
    expect(addWayFileRow("gps").subtitle).toContain("phone");
    expect(addWayFileRow("web").subtitle).toContain("computer");
  });
});

describe("what replacing a way costs", () => {
  it("asks nothing of a free slot", () => {
    expect(routeSlotDisplaceConfirm("web", "Claustral", null)).toBeNull();
  });

  it("promises a route or an imported file is kept, and says where", () => {
    expect(
      routeSlotDisplaceConfirm("gps", "Claustral", { kind: "route", name: "A" })
        ?.confirmBody,
    ).toBe("“A” will be unlinked, but the route is kept.");
    const file = routeSlotDisplaceConfirm("web", "Claustral", {
      kind: "file",
      name: "b.gpx",
    });
    expect(file?.confirmBody).toBe(
      "“b.gpx” will be unlinked, but the file is kept in Ways.",
    );
    expect(file?.tone).toBe("filled");
  });

  // An upload has no life apart from its place: calling it "kept" would lie.
  it("says an uploaded file is deleted, in the destructive tone", () => {
    const upload = routeSlotDisplaceConfirm("web", "Claustral", {
      kind: "upload",
      name: "c.gpx",
    });
    expect(upload?.confirmBody).toContain("will be deleted");
    expect(upload?.confirmBody).not.toContain("kept");
    expect(upload?.tone).toBe("destructive");
  });
});

describe("both clients draw the panel's words from the contract", () => {
  const web = read("frontend/src/components/dialogs/AddWayDialog.tsx");
  const gps = read("mobile/src/places/AddWaySheet.tsx");
  const slot = read("mobile/src/places/routeSlot.ts");

  it.each([
    ["Logjam Web", web],
    ["Logjam GPS", gps],
  ])("%s types none of the shared sentences itself", (_name, source) => {
    for (const words of [
      ADD_WAY.copy.routeTitle,
      ADD_WAY.copy.trackTitle,
      ADD_WAY.copy.importTitle,
      ADD_WAY.copy.findRoute,
      ADD_WAY.copy.alreadyHere,
      ADD_WAY.copy.routeDone,
      ADD_WAY.copy.linkedDone,
      ADD_WAY.copy.failed,
    ])
      expect(source, words).not.toContain(words);
    expect(source).toContain("ADD_WAY.copy.routeTitle");
  });

  it("builds the displacement confirm in one place", () => {
    expect(slot).toContain("routeSlotDisplaceConfirm");
    expect(slot).not.toContain("will be unlinked");
  });
});
