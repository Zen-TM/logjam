// Adding a way to a place says the same thing on both clients. The words are
// `ADD_WAY`'s; this holds the decisions in them and reads each client's source
// to see it draws from them rather than typing its own.
//
// Mutations that turn it red: type "Choose a route you drew" into either
// client's file instead of `ADD_WAY.copy.routeTitle`; reword the
// uploaded-file confirm to say "kept"; make `routeSlotDisplaceConfirm` return
// a confirm for a free slot; name an import, or a route write's incumbent, in
// `replacedUploadId`; type that rule into either client instead of calling it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADD_WAY,
  WayRefusedError,
  WayRemovalError,
  addWayFileRow,
  attachableRoutes,
  routesMatching,
  wayFailureMessage,
  addWayImportSubtitle,
  replacedUploadId,
  routeSlotDisplaceConfirm,
} from "./addWay.js";
import { contractSectionKeys } from "./types.js";

const repo = join(import.meta.dirname, "..", "..", "..");
const read = (file: string) => readFileSync(join(repo, file), "utf8");

describe("the Add a way panel's sources", () => {
  it("lists the same sources, in the same order, on both clients", () => {
    expect(contractSectionKeys(ADD_WAY, "web")).toEqual([
      "route",
      "draw",
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
      ADD_WAY.copy.drawTitle,
      ADD_WAY.copy.trackTitle,
      ADD_WAY.copy.importTitle,
      ADD_WAY.copy.findRoute,
      ADD_WAY.copy.alreadyHere,
      ADD_WAY.copy.routeDone,
      ADD_WAY.copy.linkedDone,
      ADD_WAY.copy.failed,
      ADD_WAY.copy.fileDone,
      ADD_WAY.copy.notRouteFile,
      ADD_WAY.copy.noRoutes,
      ADD_WAY.copy.noRouteMatch,
      ADD_WAY.copy.removalFailed,
    ])
      expect(source, words).not.toContain(words);
    expect(source).toContain("ADD_WAY.copy.routeTitle");
  });

  it("builds the displacement confirm in one place", () => {
    expect(slot).toContain("routeSlotDisplaceConfirm");
    expect(slot).not.toContain("will be unlinked");
  });
});

describe("which routes the panel offers", () => {
  // Mutation: drop the placeId test, and a route on another place is moved off
  // it, revoking that place's sharees' sight, on either client.
  it("leaves out a route on another place and keeps this place's own", () => {
    const list = [
      { name: "Free", placeId: null },
      { name: "Here", placeId: "p" },
      { name: "Away", placeId: "q" },
    ];
    expect(attachableRoutes(list, "p", "").map((r) => r.name)).toEqual([
      "Free",
      "Here",
    ]);
    expect(attachableRoutes(list, "p", " fr").map((r) => r.name)).toEqual([
      "Free",
    ]);
  });

  // Mutation: filter a trip's routes through attachableRoutes and a route that
  // sits on a place cannot be copied onto a trip.
  it("offers a trip every route of the user's, narrowed by the query", () => {
    const list = [
      { name: "Free", placeId: null },
      { name: "Away", placeId: "q" },
    ];
    expect(routesMatching(list, "").map((r) => r.name)).toEqual([
      "Free",
      "Away",
    ]);
    expect(routesMatching(list, " AW").map((r) => r.name)).toEqual(["Away"]);
  });

  it("is what both clients ask, not a filter of their own", () => {
    expect(read("frontend/src/components/dialogs/addWayModel.ts")).toContain(
      "attachableRoutes(",
    );
    expect(read("mobile/src/places/AddWaySheet.tsx")).toContain(
      "attachableRoutes(",
    );
  });
});

describe("telling a failure", () => {
  // Mutation: say `failed` for a removal after the write, and the user is told
  // nothing was set when the new route is already on the place.
  it("says the new way landed when only the removal failed", () => {
    expect(wayFailureMessage(new WayRemovalError(new Error("x")))).toBe(
      "The new route is in place; the old one couldn't be removed.",
    );
    expect(wayFailureMessage(new WayRefusedError("Too big."))).toBe("Too big.");
    expect(wayFailureMessage(new Error("x"))).toBe(ADD_WAY.copy.failed);
  });

  it("is told the same way by both clients", () => {
    expect(read("mobile/src/places/fillRouteSlot.ts")).toContain(
      "WayRemovalError",
    );
    expect(read("frontend/src/components/dialogs/addWayModel.ts")).toContain(
      "WayRemovalError",
    );
  });
});

describe("which incumbent a write names as `replaces`", () => {
  const upload = { kind: "upload", id: "u" } as const;

  // Mutation: drop the kind test, and an import is named and the API refuses it
  // (it is unlinked, never deleted); drop the writes test, and a route write
  // names a file it never replaces.
  it("names an uploaded file for a file write and nothing else", () => {
    expect(replacedUploadId("media", upload)).toBe("u");
    expect(
      replacedUploadId("media", { kind: "file", id: "f" }),
    ).toBeUndefined();
    expect(
      replacedUploadId("media", { kind: "route", id: "r" }),
    ).toBeUndefined();
    expect(replacedUploadId("route", upload)).toBeUndefined();
    expect(replacedUploadId("media", null)).toBeUndefined();
  });

  // Mutation: declare the rule again in either client (or stop calling the
  // shared one), and the two can drift.
  it("is called by both clients and declared by neither", () => {
    const clients = [
      read("frontend/src/components/dialogs/addWayModel.ts"),
      read("mobile/src/places/fillRouteSlot.ts"),
      read("mobile/src/places/routeSlot.ts"),
    ];
    expect(clients[0]).toContain("replacedUploadId(");
    expect(clients[1]).toContain("replacedUploadId(");
    for (const source of clients)
      expect(source).not.toContain("function replacedUploadId");
  });
});

describe("the file row", () => {
  // Mutation: drop the trip target and Logjam GPS tells a user logging a trip
  // that a picked file is imported, which it is not.
  it("says a trip's file is chosen, not imported, and a place's is imported", () => {
    expect(addWayFileRow("gps", "trip").title).toBe("Choose a file");
    expect(addWayFileRow("gps").title).toBe("Import a new file");
    expect(addWayFileRow("web", "trip").title).toBe("Upload a file");
  });
});
