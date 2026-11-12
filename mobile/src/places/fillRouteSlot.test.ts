import { beforeEach, describe, expect, it, vi } from "vitest";
import { WayRemovalError } from "@logjam/shared";

const calls = vi.hoisted(() => ({
  confirm: vi.fn(async () => true),
  deleteMediaLocal: vi.fn(async () => {}),
  linkStandaloneMediaLocal: vi.fn(async () => {}),
  updateRouteLocal: vi.fn(async () => {}),
}));
vi.mock("../ui", () => ({ confirm: calls.confirm }));
vi.mock("../sync/mediaUpload", () => ({
  deleteMediaLocal: calls.deleteMediaLocal,
  linkStandaloneMediaLocal: calls.linkStandaloneMediaLocal,
}));
vi.mock("../sync/outbox", () => ({
  updateRouteLocal: calls.updateRouteLocal,
}));

import { fillRouteSlot } from "./fillRouteSlot";
import type { MirrorMedia } from "../sync/mirrorStore";

const file = (origin: MirrorMedia["origin"]) =>
  ({
    kind: "file",
    media: {
      id: "m1",
      filename: "old.gpx",
      displayName: null,
      origin,
    } as MirrorMedia,
  }) as const;

beforeEach(() => vi.clearAllMocks());

describe("fillRouteSlot", () => {
  // Mutation: unlink every file occupant, and a file uploaded from Logjam Web
  // (no origin) gets an unlink the API refuses, leaving the place with two.
  it("deletes a file uploaded onto the place and unlinks an import", async () => {
    await fillRouteSlot({
      placeName: "P",
      source: "route",
      occupant: file(null),
      write: async () => {},
    });
    expect(calls.deleteMediaLocal).toHaveBeenCalledTimes(1);
    expect(calls.linkStandaloneMediaLocal).not.toHaveBeenCalled();

    vi.clearAllMocks();
    await fillRouteSlot({
      placeName: "P",
      source: "route",
      occupant: file("import"),
      write: async () => {},
    });
    expect(calls.linkStandaloneMediaLocal).toHaveBeenCalledWith("m1", null);
    expect(calls.deleteMediaLocal).not.toHaveBeenCalled();
  });

  // Mutation: delete the upload before the write again (the old delete-first
  // branch), and a refused link leaves the place with no route.
  it("names an uploaded file as replaced by a file source instead of deleting it", async () => {
    for (const source of ["file", "import"] as const) {
      vi.clearAllMocks();
      const write = vi.fn(async (_replaces?: string) => {});
      await fillRouteSlot({
        placeName: "P",
        source,
        occupant: file(null),
        write,
      });
      expect(write).toHaveBeenCalledWith("m1");
      expect(calls.deleteMediaLocal).not.toHaveBeenCalled();
      expect(calls.linkStandaloneMediaLocal).not.toHaveBeenCalled();
    }
  });

  // Mutation: pass the id for an import occupant too, and the API answers 400
  // to a `replaces` that is not an upload.
  it("names nothing when the occupant is an import, and unlinks it first", async () => {
    const write = vi.fn(async (_replaces?: string) => {});
    await fillRouteSlot({
      placeName: "P",
      source: "import",
      occupant: file("import"),
      write,
    });
    expect(write).toHaveBeenCalledWith(undefined);
    expect(calls.linkStandaloneMediaLocal).toHaveBeenCalledWith("m1", null);
  });

  // Mutation: let the removal's rejection through as it is, and the user is
  // told nothing was set when the new route is already on the place.
  it("says the new way landed when the removal after it fails", async () => {
    calls.linkStandaloneMediaLocal.mockRejectedValueOnce(new Error("x"));
    const write = vi.fn(async () => {});
    await expect(
      fillRouteSlot({
        placeName: "P",
        source: "route",
        occupant: file("import"),
        write,
      }),
    ).rejects.toBeInstanceOf(WayRemovalError);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when the user cancels the confirm", async () => {
    calls.confirm.mockResolvedValueOnce(false);
    const write = vi.fn(async () => {});
    expect(
      await fillRouteSlot({
        placeName: "P",
        source: "route",
        occupant: file("import"),
        write,
      }),
    ).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });
});
