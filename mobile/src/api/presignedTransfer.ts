// The presigned-S3 legs of the three-phase flows: the "Send a copy" upload,
// the received-file download, and the GeoPDF download. They deliberately do
// NOT go through apiFetch — the URL is signed, so an Authorization header on it
// is both pointless and a token where none is needed — which also means
// apiFetch's 15 s abort ("observed on hardware (Pixel 9, airplane mode) where a
// connect() neither succeeds nor fails") never covered them. Neither
// `uploadAsync` nor `downloadAsync` takes a timeout of its own, so on exactly
// the failure apiFetch was written for, the Send-a-copy sheet spun on its
// footer button indefinitely with nothing to press.
//
// THE BOUND IS ON THE FIRST BYTE, not on the whole transfer. A 64 MB send over
// a trailhead connection legitimately takes many minutes, and a deadline
// generous enough for that is no better than no deadline at all; a transfer
// that has moved no bytes whatsoever is never legitimate. Once bytes are
// flowing the transfer is left alone.
//
// The task form (createUploadTask / createDownloadResumable) rather than a
// bare Promise.race, because it can genuinely CANCEL: an abandoned download
// otherwise keeps writing to a scratch file its caller has already given up on.
//
// PRIVACY: nothing here logs the URL or the file path — a presigned URL is a
// bearer credential and an S3 error body echoes the object key.
import * as FileSystem from "expo-file-system/legacy";

/** Long enough for a slow handshake on a bad link, short enough to give up. */
export const TRANSFER_START_TIMEOUT_MS = 30_000;

export class TransferTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransferTimeoutError";
  }
}

/**
 * Reject with `timeoutMessage` (cancelling the task) if the transfer has moved
 * no bytes by the deadline. Once `hasMoved()` is true the deadline lapses and
 * the transfer runs to completion on its own.
 *
 * ponytail: first byte only — a transfer that starts and then stalls forever
 * still hangs. Make it a rolling stall timeout if that shows up in the field,
 * but note the progress callback is suppressed while the app is backgrounded,
 * so a rolling one would have to ignore time spent out of the foreground.
 */
async function awaitStart<T>(
  running: Promise<T | undefined | null>,
  task: { cancelAsync: () => Promise<void> },
  hasMoved: () => boolean,
  timeoutMessage: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      if (hasMoved()) return;
      void task.cancelAsync().catch(() => {});
      reject(new TransferTimeoutError(timeoutMessage));
    }, TRANSFER_START_TIMEOUT_MS);
  });
  const result = await Promise.race([running, deadline]).finally(() =>
    clearTimeout(timer),
  );
  // undefined/null = the task was cancelled, which only this module does.
  if (result == null) throw new TransferTimeoutError(timeoutMessage);
  return result;
}

/**
 * PUT a file straight to a presigned URL. Streams from disk (BINARY_CONTENT).
 *
 * `headers` carries Content-Type where the presign was signed with one (the
 * media upload path); omit it where it was not (Send-a-copy), because sending
 * a header S3 did not sign is a signature mismatch, not a no-op.
 */
export async function uploadToPresignedUrl(
  uploadUrl: string,
  fileUri: string,
  headers?: Record<string, string>,
): Promise<FileSystem.FileSystemUploadResult> {
  let moved = false;
  const task = FileSystem.createUploadTask(
    uploadUrl,
    fileUri,
    {
      httpMethod: "PUT",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      ...(headers && { headers }),
    },
    ({ totalBytesSent }) => {
      if (totalBytesSent > 0) moved = true;
    },
  );
  return awaitStart(
    task.uploadAsync(),
    task,
    () => moved,
    "Upload timed out — try again.",
  );
}

/** Download a presigned URL to `fileUri`. The directory must already exist. */
export async function downloadFromPresignedUrl(
  downloadUrl: string,
  fileUri: string,
): Promise<FileSystem.FileSystemDownloadResult> {
  let moved = false;
  const task = FileSystem.createDownloadResumable(
    downloadUrl,
    fileUri,
    {},
    ({ totalBytesWritten }) => {
      if (totalBytesWritten > 0) moved = true;
    },
  );
  return awaitStart(
    task.downloadAsync(),
    task,
    () => moved,
    "Download timed out — try again.",
  );
}
