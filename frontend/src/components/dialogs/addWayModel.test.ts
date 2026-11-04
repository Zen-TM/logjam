import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  WayRemovalError,
  type MediaItem,
  type StandaloneFile,
} from "@logjam/shared";
import type { TRoute } from "../../placeUtils";

const api = vi.hoisted(() => ({
  deleteMedia: vi.fn(async () => {}),
  linkMediaToPlace: vi.fn(async () => ({})),
  updateRoute: vi.fn(async () => ({})),
}));
vi.mock("../../placeUtils", () => api);

import {
  attachableFiles,
  ownAttachableRoutes,
  fillWaySlot,
  slotIncumbent,
} from "./addWayModel";

const route = (over: Partial<TRoute>) =>
  ({ id: "r", ownerId: "me", placeId: null, name: "Line", ...over }) as TRoute;
const gpx = (over: Partial<MediaItem>) =>
  ({
    id: "m",
    mediaType: "application/gpx+xml",
    filename: "walk.gpx",
    displayName: null,
    origin: null,
    ...over,
  }) as MediaItem;
const stored = (over: Partial<StandaloneFile>) =>
  ({
    id: "f",
    mediaType: "application/gpx+xml",
    filename: "walk.gpx",
    displayName: null,
    origin: "import",
    linkedPlaceId: null,
    ...over,
  }) as StandaloneFile;

beforeEach(() => vi.clearAllMocks());

describe("slotIncumbent", () => {
  it("is nobody on a free slot, and ignores photos and other places' routes", () => {
    expect(
      slotIncumbent(
        "p",
        [route({ placeId: "other" })],
        [gpx({ mediaType: "image/jpeg" })],
      ),
    ).toBeNull();
  });

  // Mutation: read `media` before `routes` and a drawn route is shown the
  // file's confirm.
  it("puts the drawn route ahead of a file, as the place page does", () => {
    expect(
      slotIncumbent("p", [route({ id: "r1", placeId: "p" })], [gpx({})]),
    ).toEqual({ kind: "route", id: "r1", name: "Line" });
  });

  // Mutation: call every file "file" and replacing an uploaded GPX asks the
  // API to unlink a row it refuses to move (400), leaving two routes.
  it("tells a kept import from a file uploaded onto the place", () => {
    expect(slotIncumbent("p", [], [gpx({ origin: "track" })])?.kind).toBe(
      "file",
    );
    expect(slotIncumbent("p", [], [gpx({ origin: null })])?.kind).toBe(
      "upload",
    );
  });
});

describe("ownAttachableRoutes", () => {
  // Mutation: drop the owner test, and a route shared with the user is
  // offered although the API refuses to re-link it.
  it("offers only the user's own routes, narrowed by name", () => {
    const list = [
      route({ id: "a", name: "Claustral" }),
      route({ id: "b", name: "Other", ownerId: "them" }),
      route({ id: "c", name: "Tiger" }),
    ];
    const ids = (q: string, user: string | null = "me") =>
      ownAttachableRoutes(list, user, "p", q).map((r) => r.id);
    expect(ids("")).toEqual(["a", "c"]);
    expect(ids(" clau")).toEqual(["a"]);
    expect(ids("", null)).toEqual([]);
  });

  // Mutation: drop the placeId test, and a route on another place is moved
  // off it, revoking that place's sharees' sight of it, without being asked.
  it("leaves out routes on another place, and keeps this place's own", () => {
    const list = [
      route({ id: "free" }),
      route({ id: "here", placeId: "p" }),
      route({ id: "away", placeId: "q" }),
    ];
    expect(ownAttachableRoutes(list, "me", "p", "").map((r) => r.id)).toEqual([
      "free",
      "here",
    ]);
  });
});

describe("attachableFiles", () => {
  // Mutation: drop the linkedPlaceId test, and linking moves a file off the
  // place it is on without that place's owner being asked.
  it("leaves out files already on another place, and keeps this place's own", () => {
    const list = [
      stored({ id: "free" }),
      stored({ id: "here", linkedPlaceId: "p" }),
      stored({ id: "away", linkedPlaceId: "q" }),
      stored({ id: "rec", origin: "track" }),
    ];
    expect(attachableFiles(list, "import", "p").map((f) => f.id)).toEqual([
      "free",
      "here",
    ]);
    expect(attachableFiles(list, "track", "p").map((f) => f.id)).toEqual([
      "rec",
    ]);
  });
});

describe("fillWaySlot", () => {
  const order: string[] = [];
  const write = async () => {
    order.push("write");
  };
  beforeEach(() => {
    order.length = 0;
    api.updateRoute.mockImplementation(async () => {
      order.push("unlink route");
      return {};
    });
    api.linkMediaToPlace.mockImplementation(async () => {
      order.push("unlink file");
      return {};
    });
    api.deleteMedia.mockImplementation(async () => {
      order.push("delete upload");
    });
  });

  it("just writes into a free slot", async () => {
    await fillWaySlot({ incumbent: null, source: "route", write });
    expect(order).toEqual(["write"]);
  });

  // Mutation: remove first for every source, and a failed write leaves the
  // place with no route at all.
  it("writes first, then removes the incumbent, for a route", async () => {
    await fillWaySlot({
      incumbent: { kind: "file", id: "m", name: "x" },
      source: "route",
      write,
    });
    expect(order).toEqual(["write", "unlink file"]);
  });

  // Mutation: write first for a file over a file, and the API answers 409
  // "This place already has a track".
  it("removes the incumbent file before writing another", async () => {
    await fillWaySlot({
      incumbent: { kind: "file", id: "m", name: "x" },
      source: "import",
      write,
    });
    expect(order).toEqual(["unlink file", "write"]);
  });

  it("removes an uploaded file by deleting it, never by unlinking", async () => {
    await fillWaySlot({
      incumbent: { kind: "upload", id: "m", name: "x" },
      source: "file",
      write,
    });
    expect(order).toEqual(["delete upload", "write"]);
    expect(api.linkMediaToPlace).not.toHaveBeenCalled();
  });

  it("unlinks a displaced drawn route after a file lands", async () => {
    await fillWaySlot({
      incumbent: { kind: "route", id: "r", name: "x" },
      source: "file",
      write,
    });
    expect(order).toEqual(["write", "unlink route"]);
    expect(api.updateRoute).toHaveBeenCalledWith("r", { placeId: null });
  });
});

describe("fillWaySlot failures", () => {
  const upload = { kind: "upload", id: "m", name: "x" } as const;
  const link = { kind: "file", id: "m", name: "x" } as const;

  // Mutation: run the preflight after the removal, and a file that fails its
  // checks has already cost the user the upload it was to replace.
  it("refuses before deleting anything when the preflight fails", async () => {
    await expect(
      fillWaySlot({
        incumbent: upload,
        source: "file",
        write: vi.fn(),
        preflight: async () => {
          throw new Error("too big");
        },
      }),
    ).rejects.toThrow("too big");
    expect(api.deleteMedia).not.toHaveBeenCalled();
    expect(api.updateRoute).not.toHaveBeenCalled();
    expect(api.linkMediaToPlace).not.toHaveBeenCalled();
  });

  it("rejects, and removes nothing more, when the write fails after the removal", async () => {
    const write = vi.fn().mockRejectedValue(new Error("network"));
    await expect(
      fillWaySlot({ incumbent: link, source: "import", write }),
    ).rejects.toThrow("network");
    expect(api.linkMediaToPlace).toHaveBeenCalledTimes(1);
  });

  // Mutation: let the removal's own error through, and the user reads "couldn't
  // set that" about a route that is already on the place.
  it("reports a failed removal after the write as WayRemovalError", async () => {
    const write = vi.fn(async () => {});
    api.linkMediaToPlace.mockRejectedValueOnce(new Error("503"));
    await expect(
      fillWaySlot({ incumbent: link, source: "route", write }),
    ).rejects.toBeInstanceOf(WayRemovalError);
    expect(write).toHaveBeenCalledTimes(1);
  });
});
