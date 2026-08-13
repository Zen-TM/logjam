import { beforeEach, describe, expect, it, vi } from "vitest";
import { fileSizeBytes, stageIncomingFile } from "./stagedFile";

// The bug this file exists for is an ORDER: both import paths measured the file
// on the wrong side of the expensive step. The GeoPDF path copied it in full
// and then checked (a 2 GB "PDF" filled the phone before being refused); the
// vector path only checked in the picker flow, so the share sheet read an
// unbounded file into one JS string and the app died before any guard ran.
// So the assertions that matter are "did it throw" AND "was copyAsync called".

const getInfoAsync = vi.fn();
const copyAsync = vi.fn(async (_options: unknown) => {});
vi.mock("expo-file-system", () => ({
  getInfoAsync: (uri: string, options?: unknown) => getInfoAsync(uri, options),
  copyAsync: (options: unknown) => copyAsync(options),
}));
vi.mock("../offline/localStores", () => ({
  scratchFileUri: vi.fn(async (name: string) => `file:///scratch/${name}`),
}));

const MB = 1024 * 1024;
const stage = (uri: string) =>
  stageIncomingFile({
    uri,
    maxBytes: 30 * MB,
    tooLargeMessage: "too big",
    scratchName: "incoming.bin",
  });

beforeEach(() => {
  getInfoAsync.mockReset();
  copyAsync.mockReset();
});

describe("stageIncomingFile", () => {
  it("refuses an oversized content:// file BEFORE copying it", async () => {
    getInfoAsync.mockResolvedValue({ exists: true, size: 900 * MB });
    await expect(stage("content://provider/big.pdf")).rejects.toThrow(
      "too big",
    );
    expect(copyAsync).not.toHaveBeenCalled();
  });

  it("refuses an oversized file:// one without reading it", async () => {
    getInfoAsync.mockResolvedValue({ exists: true, size: 31 * MB });
    await expect(stage("file:///docs/huge.geojson")).rejects.toThrow("too big");
  });

  it("passes a file:// URI straight through, with nothing to clean up", async () => {
    getInfoAsync.mockResolvedValue({ exists: true, size: 2 * MB });
    await expect(stage("file:///docs/ok.gpx")).resolves.toEqual({
      uri: "file:///docs/ok.gpx",
      scratch: null,
    });
    expect(copyAsync).not.toHaveBeenCalled();
  });

  it("stages a content:// URI into scratch and reports it for cleanup", async () => {
    getInfoAsync.mockResolvedValue({ exists: true, size: 2 * MB });
    const staged = await stage("content://provider/ok.kmz");
    expect(staged).toEqual({
      uri: "file:///scratch/incoming.bin",
      scratch: "file:///scratch/incoming.bin",
    });
    expect(copyAsync).toHaveBeenCalledWith({
      from: "content://provider/ok.kmz",
      to: "file:///scratch/incoming.bin",
    });
  });

  it("throws on a file it cannot even open", async () => {
    getInfoAsync.mockResolvedValue({ exists: false });
    await expect(fileSizeBytes("content://gone")).rejects.toThrow();
  });
});
