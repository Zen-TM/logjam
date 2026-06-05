import { describe, it, expect, vi, type Mock } from "vitest";

// Return the command input as the "URL" so we can assert what was signed.
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async (_client: unknown, command: { input: unknown }) =>
    `signed:${JSON.stringify(command.input)}`,
  ),
}));

import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { toMediaItem, mediaItemsByLinkedId, type MediaRow } from "./mediaPresign";

const signedMock = getSignedUrl as unknown as Mock;

function imageRow(overrides: Partial<MediaRow> = {}): MediaRow {
  return {
    id: "m1",
    linkedType: "canyon",
    linkedId: "canyon-1",
    mediaType: "image/jpeg",
    filename: "photo.jpg",
    fileSizeBytes: 2048n,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    s3KeyDisplay: "display/m1.jpg",
    s3KeyThumbnail: "thumb/m1.jpg",
    ...overrides,
  };
}

describe("toMediaItem", () => {
  it("maps a Prisma row to the client DTO with both URLs", async () => {
    const item = await toMediaItem(imageRow());
    expect(item.id).toBe("m1");
    expect(item.linkedId).toBe("canyon-1");
    expect(item.fileSizeBytes).toBe(2048); // bigint → number
    expect(item.createdAt).toBe("2026-06-01T00:00:00.000Z");
    expect(item.displayUrl).toContain("display/m1.jpg");
    expect(item.thumbnailUrl).toContain("thumb/m1.jpg");
    // An inline image is NOT forced to download.
    expect(item.displayUrl).not.toContain("attachment");
  });

  it("forces a download with the original filename for track files", async () => {
    const item = await toMediaItem(
      imageRow({
        mediaType: "application/gpx+xml",
        filename: "route.gpx",
        s3KeyDisplay: "display/m2.gpx",
        s3KeyThumbnail: null,
      }),
    );
    expect(item.thumbnailUrl).toBeNull();
    expect(item.displayUrl).toContain("attachment");
    expect(item.displayUrl).toContain("route.gpx");
  });

  it("strips quotes from the download filename", async () => {
    const item = await toMediaItem(
      imageRow({
        mediaType: "application/gpx+xml",
        filename: 'ro"ute".gpx',
        s3KeyThumbnail: null,
      }),
    );
    expect(item.displayUrl).not.toContain('ro"ute"');
    expect(item.displayUrl).toContain("route.gpx");
  });
});

describe("mediaItemsByLinkedId", () => {
  it("groups DTOs by their linkedId", async () => {
    signedMock.mockClear();
    const rows = [
      imageRow({ id: "a", linkedId: "trip-1" }),
      imageRow({ id: "b", linkedId: "trip-1" }),
      imageRow({ id: "c", linkedId: "trip-2" }),
    ];
    const grouped = await mediaItemsByLinkedId(rows);
    expect(grouped.get("trip-1")?.map((i) => i.id)).toEqual(["a", "b"]);
    expect(grouped.get("trip-2")?.map((i) => i.id)).toEqual(["c"]);
  });
});
