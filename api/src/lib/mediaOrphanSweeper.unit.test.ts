import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../services/prisma", () => ({
  default: {
    media: { findMany: vi.fn() },
  },
}));

vi.mock("../services/awsClients", () => ({
  s3: { send: vi.fn() },
}));

import prisma from "../services/prisma";
import { s3 } from "../services/awsClients";
import {
  mediaIdFromKey,
  selectOrphanedUploadKeys,
  sweepOrphanedMediaUploads,
  type MediaObjectListing,
} from "./mediaOrphanSweeper";

const mediaFindMany = (prisma as unknown as { media: { findMany: Mock } })
  .media.findMany;
const s3Send = (s3 as unknown as { send: Mock }).send;

const NOW = new Date("2026-06-11T12:00:00Z");
const OLD = new Date("2026-06-09T12:00:00Z"); // well past the 24h TTL
const RECENT = new Date("2026-06-11T11:30:00Z");
const CUTOFF = new Date(NOW.getTime() - 86_400_000);

const obj = (key: string, lastModified: Date): MediaObjectListing => ({
  key,
  lastModified,
});

describe("mediaIdFromKey", () => {
  it("extracts the mediaId from a canonical media key", () => {
    expect(mediaIdFromKey("media/owner-1/media-1/display.jpg")).toBe("media-1");
    expect(mediaIdFromKey("media/owner-1/media-1/thumb.jpg")).toBe("media-1");
  });

  it("returns null for keys outside the canonical layout", () => {
    expect(mediaIdFromKey("media/owner-1/loose-file.jpg")).toBeNull();
    expect(mediaIdFromKey("exports/owner-1/media-1/display.jpg")).toBeNull();
    expect(mediaIdFromKey("media/owner-1/media-1/nested/extra.jpg")).toBeNull();
  });
});

describe("selectOrphanedUploadKeys", () => {
  it("selects all objects of an old unconfirmed mediaId", () => {
    const keys = selectOrphanedUploadKeys(
      [
        obj("media/o1/m1/display.jpg", OLD),
        obj("media/o1/m1/thumb.jpg", OLD),
      ],
      new Set(),
      CUTOFF,
    );
    expect(keys.sort()).toEqual([
      "media/o1/m1/display.jpg",
      "media/o1/m1/thumb.jpg",
    ]);
  });

  it("never selects objects whose mediaId has a confirmed row", () => {
    const keys = selectOrphanedUploadKeys(
      [obj("media/o1/m1/display.jpg", OLD)],
      new Set(["m1"]),
      CUTOFF,
    );
    expect(keys).toEqual([]);
  });

  it("defers the whole group when any object is newer than the cutoff", () => {
    const keys = selectOrphanedUploadKeys(
      [
        obj("media/o1/m1/display.jpg", OLD),
        obj("media/o1/m1/thumb.jpg", RECENT),
      ],
      new Set(),
      CUTOFF,
    );
    expect(keys).toEqual([]);
  });

  it("skips keys that do not match the canonical layout", () => {
    const keys = selectOrphanedUploadKeys(
      [obj("media/o1/stray-object.bin", OLD)],
      new Set(),
      CUTOFF,
    );
    expect(keys).toEqual([]);
  });

  it("handles a mix of confirmed, orphaned, and in-flight groups", () => {
    const keys = selectOrphanedUploadKeys(
      [
        obj("media/o1/confirmed/display.jpg", OLD),
        obj("media/o1/orphan/display.jpg", OLD),
        obj("media/o1/orphan/thumb.jpg", OLD),
        obj("media/o2/inflight/display.jpg", RECENT),
      ],
      new Set(["confirmed"]),
      CUTOFF,
    );
    expect(keys.sort()).toEqual([
      "media/o1/orphan/display.jpg",
      "media/o1/orphan/thumb.jpg",
    ]);
  });
});

describe("sweepOrphanedMediaUploads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.S3_BUCKET_MEDIA = "logjam-media-test";
  });

  it("lists, diffs against confirmed rows, and deletes only orphans", async () => {
    s3Send
      .mockResolvedValueOnce({
        Contents: [
          { Key: "media/o1/confirmed/display.jpg", LastModified: OLD },
          { Key: "media/o1/orphan/display.jpg", LastModified: OLD },
        ],
        IsTruncated: false,
      })
      // DeleteObjectsCommand from deleteS3Keys
      .mockResolvedValueOnce({});
    mediaFindMany.mockResolvedValueOnce([{ id: "confirmed" }]);

    const deleted = await sweepOrphanedMediaUploads(NOW);

    expect(deleted).toBe(1);
    expect(mediaFindMany).toHaveBeenCalledWith({
      where: { id: { in: ["confirmed", "orphan"] } },
      select: { id: true },
    });
    const deleteCall = s3Send.mock.calls[1][0];
    expect(deleteCall.input.Delete.Objects).toEqual([
      { Key: "media/o1/orphan/display.jpg" },
    ]);
  });

  it("follows continuation tokens across pages", async () => {
    s3Send
      .mockResolvedValueOnce({
        Contents: [{ Key: "media/o1/a/display.jpg", LastModified: OLD }],
        IsTruncated: true,
        NextContinuationToken: "page2",
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: "media/o1/b/display.jpg", LastModified: OLD }],
        IsTruncated: false,
      })
      .mockResolvedValueOnce({});
    mediaFindMany.mockResolvedValueOnce([]);

    const deleted = await sweepOrphanedMediaUploads(NOW);

    expect(deleted).toBe(2);
    expect(s3Send.mock.calls[1][0].input.ContinuationToken).toBe("page2");
  });

  it("returns 0 without touching S3 when there is nothing to delete", async () => {
    s3Send.mockResolvedValueOnce({
      Contents: [{ Key: "media/o1/m1/display.jpg", LastModified: RECENT }],
      IsTruncated: false,
    });
    mediaFindMany.mockResolvedValueOnce([]);

    const deleted = await sweepOrphanedMediaUploads(NOW);

    expect(deleted).toBe(0);
    expect(s3Send).toHaveBeenCalledTimes(1); // list only, no delete
  });
});
