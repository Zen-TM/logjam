import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("../services/prisma", () => {
  const media = { findMany: vi.fn(), createMany: vi.fn() };
  const user = { findUnique: vi.fn() };
  return {
    default: {
      media,
      user,
      $executeRaw: vi.fn(),
      // The real interactive transaction hands the callback a client; the
      // copy's charge + rows both run on it, so handing back the same mock
      // exercises the ordering that matters (charge, check, then write).
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({ media, user, $executeRaw: vi.fn() }),
      ),
    },
  };
});

vi.mock("../services/awsClients", () => ({ s3: { send: vi.fn() } }));

vi.mock("./s3Cleanup", () => ({ deleteS3KeysBestEffort: vi.fn() }));

vi.mock("./storageQuota", () => ({
  incrementStorageUsed: vi.fn(),
  getStorageUsage: vi.fn(),
}));

import prisma from "../services/prisma";
import { s3 } from "../services/awsClients";
import { deleteS3KeysBestEffort } from "./s3Cleanup";
import { getStorageUsage, incrementStorageUsed } from "./storageQuota";
import { copyPlaceMedia } from "./copyPlaceMedia";

const mediaFindMany = (prisma as unknown as { media: { findMany: Mock } }).media
  .findMany;
const mediaCreateMany = (prisma as unknown as { media: { createMany: Mock } })
  .media.createMany;
const s3Send = (s3 as unknown as { send: Mock }).send;
const cleanup = deleteS3KeysBestEffort as unknown as Mock;
const usage = getStorageUsage as unknown as Mock;
const charge = incrementStorageUsed as unknown as Mock;

/** One place-level photo: a display object and a thumbnail. */
function photo(id: string, bytes: bigint) {
  return {
    id,
    ownerId: "alice",
    linkedType: "place",
    linkedId: "source-place",
    s3KeyDisplay: `media/alice/${id}/display.jpg`,
    s3KeyThumbnail: `media/alice/${id}/thumb.jpg`,
    mediaType: "image/jpeg",
    filename: "Whatever.jpg",
    fileSizeBytes: bytes,
    color: null,
    metadata: {},
  };
}

/** A GPX attached to a place: one object, no thumbnail, and a track colour. */
function trackFile(id: string, bytes: bigint) {
  return {
    ...photo(id, bytes),
    s3KeyThumbnail: null,
    mediaType: "application/gpx+xml",
    filename: "Exit.gpx",
    color: "#4BB4D9",
  };
}

const ARGS = {
  sourcePlaceId: "source-place",
  targetPlaceId: "target-place",
  recipientId: "bob",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  s3Send.mockResolvedValue({});
  usage.mockResolvedValue({ used: 10n, quota: 1000n });
});

describe("copyPlaceMedia", () => {
  it("does nothing, and charges nothing, for a place with no media", async () => {
    mediaFindMany.mockResolvedValue([]);
    expect(await copyPlaceMedia(ARGS)).toEqual({ copied: 0, skipped: 0 });
    expect(s3Send).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
  });

  it("copies both objects of a photo under the RECIPIENT's prefix, with a new id", async () => {
    mediaFindMany.mockResolvedValue([photo("m1", 100n)]);

    expect(await copyPlaceMedia(ARGS)).toEqual({ copied: 1, skipped: 0 });

    // Two CopyObjects: display and thumbnail.
    expect(s3Send).toHaveBeenCalledTimes(2);
    const rows = mediaCreateMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    // The key is minted from the COPIER's id, never reused from the source —
    // a shared key would make the owner's delete take the copy's bytes with it.
    expect(rows[0].s3KeyDisplay).toMatch(/^media\/bob\/[0-9a-f-]{36}\/display\.jpg$/);
    expect(rows[0].s3KeyThumbnail).toMatch(/^media\/bob\/[0-9a-f-]{36}\/thumb\.jpg$/);
    expect(rows[0].s3KeyDisplay).not.toBe("media/alice/m1/display.jpg");
    expect(rows[0].id).not.toBe("m1");
    expect(rows[0].ownerId).toBe("bob");
    expect(rows[0].linkedId).toBe("target-place");
  });

  it("copies a track file's single object and keeps its colour", async () => {
    mediaFindMany.mockResolvedValue([trackFile("m1", 100n)]);

    expect(await copyPlaceMedia(ARGS)).toEqual({ copied: 1, skipped: 0 });

    // One object, because there is no thumbnail — and no row pointing at a
    // thumbnail key that was never written.
    expect(s3Send).toHaveBeenCalledTimes(1);
    const rows = mediaCreateMany.mock.calls[0][0].data;
    expect(rows[0].s3KeyThumbnail).toBeNull();
    expect(rows[0].color).toBe("#4BB4D9");
  });

  it("charges the copier for exactly the bytes that landed", async () => {
    mediaFindMany.mockResolvedValue([photo("m1", 100n), photo("m2", 250n)]);
    await copyPlaceMedia(ARGS);
    expect(charge).toHaveBeenCalledWith("bob", 350n, expect.anything());
  });

  // THE RULE THAT KEEPS A COPY HONEST: a row whose object failed to copy is a
  // photo that 404s forever, which is worse than a photo that is missing.
  it("records only the items whose objects copied, and cleans up the half-copied one", async () => {
    mediaFindMany.mockResolvedValue([photo("m1", 100n), photo("m2", 250n)]);
    // m1's display + thumb succeed; m2's display succeeds and its thumb fails.
    s3Send
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("copy failed"));

    expect(await copyPlaceMedia(ARGS)).toEqual({ copied: 1, skipped: 1 });

    const rows = mediaCreateMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    // Only m1's bytes are charged — the failed item is not billed for.
    expect(charge).toHaveBeenCalledWith("bob", 100n, expect.anything());
    // m2's stranded display object is removed rather than left to the sweeper.
    expect(cleanup).toHaveBeenCalled();
  });

  it("reports out-of-space without throwing, so a copied place is not reported as failed", async () => {
    mediaFindMany.mockResolvedValue([photo("m1", 100n)]);
    // The race the route's preflight cannot catch: headroom gone between the
    // preflight and the charge.
    usage.mockResolvedValue({ used: 1100n, quota: 1000n });

    expect(await copyPlaceMedia(ARGS)).toEqual({
      copied: 0,
      skipped: 1,
      outOfSpace: true,
    });
    // The transaction rolled back (so the charge is undone) and the objects it
    // would have pointed at are removed.
    expect(cleanup).toHaveBeenCalled();
  });

  it("reports every item skipped when no object copies at all", async () => {
    mediaFindMany.mockResolvedValue([photo("m1", 100n)]);
    s3Send.mockRejectedValue(new Error("bucket gone"));

    expect(await copyPlaceMedia(ARGS)).toEqual({ copied: 0, skipped: 1 });
    // Nothing charged, nothing written.
    expect(charge).not.toHaveBeenCalled();
    expect(mediaCreateMany).not.toHaveBeenCalled();
  });
});
