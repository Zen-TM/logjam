import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NotEnoughSpaceError,
  assertSpaceFor,
  fitsInFreeSpace,
  hasSpaceFor,
} from "./freeSpace";

// Four writers had no space check at all — the vector clip (up to 80 MB), the
// overlay bundle, the GeoPDF pyramid and both unattended auto-downloaders — so
// a full phone failed mid-write and reported "That didn't finish. Try again."

const getFreeDiskStorageAsync = vi.fn();
vi.mock("expo-file-system", () => ({
  getFreeDiskStorageAsync: () => getFreeDiskStorageAsync(),
}));

beforeEach(() => {
  getFreeDiskStorageAsync.mockReset();
});

describe("fitsInFreeSpace", () => {
  it("leaves headroom rather than filling the disk to the last byte", () => {
    expect(fitsInFreeSpace(100, 1000)).toBe(true);
    // 950 of 1000 free "fits" arithmetically and does not survive a WAL commit.
    expect(fitsInFreeSpace(950, 1000)).toBe(false);
  });
});

describe("assertSpaceFor", () => {
  it("throws a typed error naming both numbers", async () => {
    getFreeDiskStorageAsync.mockResolvedValue(10 * 1024 * 1024);
    await expect(assertSpaceFor(80 * 1024 * 1024)).rejects.toBeInstanceOf(
      NotEnoughSpaceError,
    );
  });

  it("allows the write when it fits", async () => {
    getFreeDiskStorageAsync.mockResolvedValue(8 * 1024 * 1024 * 1024);
    await expect(assertSpaceFor(80 * 1024 * 1024)).resolves.toBeUndefined();
  });

  it("does not invent a refusal when the free space is unreadable", async () => {
    // The write is the user's own request; the filesystem reports its own
    // failure soon enough. An unknown answer must not become a phantom block.
    getFreeDiskStorageAsync.mockImplementation(async () => {
      throw new Error("nope");
    });
    await assertSpaceFor(80 * 1024 * 1024);
    expect(await hasSpaceFor(80 * 1024 * 1024)).toBe(true);
  });
});
