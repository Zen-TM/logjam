import { describe, expect, it, vi } from "vitest";
import type { StandaloneFile } from "@logjam/shared";

vi.mock("../../placeUtils", () => ({
  getMediaDownloadUrls: vi.fn(async () => ({
    items: [{ id: "rec-1", displayUrl: "https://files.test/rec.gpx" }],
  })),
}));
vi.stubGlobal(
  "fetch",
  vi.fn(async () => new Response("<gpx/>")),
);

import { fetchMediaFile, routeGpxFile, tripFiles } from "./tripWayModel";

const stored = (over: Partial<StandaloneFile>) =>
  ({
    id: "f",
    mediaType: "application/gpx+xml",
    filename: "walk.gpx",
    origin: "import",
    linkedPlaceId: null,
    ...over,
  }) as StandaloneFile;

describe("the files a trip can copy", () => {
  // Mutation: filter on linkedPlaceId as a place's slot does and a recording
  // that is already some place's way cannot be copied onto a trip.
  it("offers a file already on a place, by its origin and as a route file only", () => {
    const list = [
      stored({ id: "a", origin: "track", linkedPlaceId: "p" }),
      stored({ id: "b", origin: "import" }),
      stored({ id: "c", origin: "track", mediaType: "image/jpeg" }),
    ];
    expect(tripFiles(list, "track").map((f) => f.id)).toEqual(["a"]);
    expect(tripFiles(list, "import").map((f) => f.id)).toEqual(["b"]);
  });
});

describe("a way as a file", () => {
  it("writes a drawn route out as a GPX named for it", async () => {
    const file = routeGpxFile({
      name: "Creek line",
      points: [
        [150.1, -33.1],
        [150.2, -33.2],
      ],
    });
    expect(file.name).toBe("Creek line.gpx");
    expect(await file.text()).toContain("<rtept");
  });

  it("fetches a stored file under its own name", async () => {
    const file = await fetchMediaFile("rec-1", "descent.gpx");
    expect(file.name).toBe("descent.gpx");
    expect(await file.text()).toBe("<gpx/>");
  });
});
