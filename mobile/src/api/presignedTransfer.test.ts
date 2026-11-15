import { describe, expect, it, vi } from "vitest";

// downloadFromPresignedUrl and its signal: an abort cancels the transfer, so a
// caller that has given up (a sign-in's wipe) is not held by the bytes.

const task = vi.hoisted(() => {
  const state = {
    release: (_: unknown) => {},
    cancelAsync: vi.fn(async () => state.release(undefined)),
  };
  return state;
});
vi.mock("expo-file-system/legacy", () => ({
  createDownloadResumable: () => ({
    downloadAsync: () =>
      new Promise((resolve) => {
        task.release = resolve;
      }),
    cancelAsync: task.cancelAsync,
  }),
}));

const { downloadFromPresignedUrl } = await import("./presignedTransfer");

describe("downloadFromPresignedUrl", () => {
  // Mutation: drop the abort listener, and an aborted transfer runs on, holding
  // its caller until the bytes arrive or the first-byte timeout.
  it("cancels the transfer when its signal aborts, and rejects", async () => {
    task.cancelAsync.mockClear();
    const controller = new AbortController();
    const download = downloadFromPresignedUrl(
      "https://cdn.test/file",
      "file:///docs/file",
      undefined,
      controller.signal,
    );
    controller.abort();
    await expect(download).rejects.toThrow();
    expect(task.cancelAsync).toHaveBeenCalledOnce();
  });

  // Mutation: drop the `signal?.aborted` throw, and a signal that aborted
  // before the call starts a transfer nobody can stop.
  it("starts nothing for a signal that has already aborted", async () => {
    task.cancelAsync.mockClear();
    const controller = new AbortController();
    controller.abort();
    await expect(
      downloadFromPresignedUrl(
        "https://cdn.test/file",
        "file:///docs/file",
        undefined,
        controller.signal,
      ),
    ).rejects.toThrow("Download cancelled.");
    expect(task.cancelAsync).not.toHaveBeenCalled();
  });
});
