import { describe, expect, it } from "vitest";

import {
  removeOccupantFirst,
  routeSlotDisplaceConfirm,
  routeSlotOccupant,
  waySourceWrites,
} from "./routeSlot";
import type { MirrorMedia } from "../sync/mirrorStore";

const route = (id: string, name: string, canyonId: string | null) => ({
  id,
  name,
  canyonId,
});

const media = (
  id: string,
  linkedId: string,
  mediaType: string,
  filename: string | null,
): MirrorMedia => ({
  id,
  linkedType: "canyon",
  linkedId,
  mediaType,
  filename,
  color: null,
  displayName: null,
  origin: null,
  metadata: {},
  fileSizeBytes: null,
  createdAt: "2026-08-22T00:00:00.000Z",
  syncState: "synced",
  localThumbPath: null,
  localDisplayPath: null,
});

const GPX = "application/gpx+xml";

describe("routeSlotOccupant", () => {
  it("is null on an empty slot", () => {
    expect(routeSlotOccupant("c1", [route("r1", "Elsewhere", "c2")], [])).toBeNull();
  });

  it("finds the drawn route linked to this canyon", () => {
    expect(
      routeSlotOccupant("c1", [route("r1", "Claustral", "c1")], []),
    ).toEqual({ kind: "route", id: "r1", name: "Claustral" });
  });

  it("finds the attached track file", () => {
    const file = media("m1", "c1", GPX, "claustral.gpx");
    expect(routeSlotOccupant("c1", [], [file])).toEqual({ kind: "file", media: file });
  });

  it("ignores photos and other canyons' attachments", () => {
    expect(
      routeSlotOccupant("c1", [], [
        media("m1", "c1", "image/jpeg", "photo.jpg"),
        media("m2", "c2", GPX, "other.gpx"),
      ]),
    ).toBeNull();
  });

  it("ignores the route being moved, so it never displaces itself", () => {
    expect(
      routeSlotOccupant("c1", [route("r1", "Claustral", "c1")], [], "r1"),
    ).toBeNull();
  });

  it("still reports another route when the moved one is elsewhere", () => {
    expect(
      routeSlotOccupant(
        "c1",
        [route("r1", "Mine", "c2"), route("r2", "Incumbent", "c1")],
        [],
        "r1",
      ),
    ).toEqual({ kind: "route", id: "r2", name: "Incumbent" });
  });

  it("prefers the drawn route when both somehow occupy the slot", () => {
    expect(
      routeSlotOccupant(
        "c1",
        [route("r1", "Drawn", "c1")],
        [media("m1", "c1", GPX, "file.gpx")],
      ),
    ).toEqual({ kind: "route", id: "r1", name: "Drawn" });
  });
});

describe("routeSlotDisplaceConfirm", () => {
  it("asks nothing about a free slot", () => {
    expect(routeSlotDisplaceConfirm("Claustral", null)).toBeNull();
  });

  it("promises a displaced route survives", () => {
    expect(
      routeSlotDisplaceConfirm("Claustral", {
        kind: "route",
        id: "r1",
        name: "Old line",
      }),
    ).toEqual({
      confirmTitle: "Claustral already has a route",
      confirmBody: "“Old line” will be unlinked, but the route is kept.",
    });
  });

  it("promises a displaced file is KEPT — it is unlinked, not deleted", () => {
    // The whole point of linking rather than copying. This sentence used to
    // say the file would be deleted and that can't be undone, because it was
    // true: the canyon held a COPY and displacing it destroyed it.
    const confirm = routeSlotDisplaceConfirm("Claustral", {
      kind: "file",
      media: media("m1", "c1", GPX, "old.gpx"),
    });
    expect(confirm?.confirmBody).toBe(
      "“old.gpx” will be unlinked, but the file is kept in Saved.",
    );
    expect(confirm?.confirmBody).not.toContain("deleted");
  });

  it("names an unnamed file rather than saying “null”", () => {
    const confirm = routeSlotDisplaceConfirm("Claustral", {
      kind: "file",
      media: media("m1", "c1", GPX, null),
    });
    expect(confirm?.confirmBody).toContain("“Untitled file”");
  });
});

describe("waySourceWrites", () => {
  it("uploads media only for the two file sources", () => {
    expect(waySourceWrites("import")).toBe("media");
    expect(waySourceWrites("file")).toBe("media");
    expect(waySourceWrites("route")).toBe("route");
    expect(waySourceWrites("track")).toBe("route");
    expect(waySourceWrites("draw")).toBe("route");
  });
});

describe("removeOccupantFirst", () => {
  const file = { kind: "file", media: media("m1", "c1", GPX, "old.gpx") } as const;
  const drawn = { kind: "route", id: "r1", name: "Old line" } as const;

  it("removes a file first when another file is going in — the API 409s otherwise", () => {
    expect(removeOccupantFirst("media", file)).toBe(true);
  });

  it("writes the link first in every other case", () => {
    expect(removeOccupantFirst("route", file)).toBe(false);
    expect(removeOccupantFirst("media", drawn)).toBe(false);
    expect(removeOccupantFirst("route", drawn)).toBe(false);
    expect(removeOccupantFirst("media", null)).toBe(false);
    expect(removeOccupantFirst("route", null)).toBe(false);
  });
});
