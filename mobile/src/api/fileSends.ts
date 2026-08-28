// "Send a copy" — typed port of api/src/routes/fileSends.ts.
//
// NOT sharing. A share (./shares.ts) is a live, revocable view of a record the
// sender still owns. A send hands over a FILE: once the recipient accepts, it
// is theirs — editable, permanent, and impossible to take back. There is no
// unsend endpoint and there never will be, so nothing here may be worded as if
// there is (see shared/src/sharing.ts).
//
// ONLINE-ONLY, like ./shares.ts and for the same reason: the outbox carries
// entity mutations, and queueing a send would tell the user they had given a
// friend a file when they had not.
//
// PRIVACY: a filename is user text and routinely names a canyon. It travels in
// request bodies and is rendered on screen, and it is never logged.
import * as FileSystem from "expo-file-system/legacy";

import { scratchFileUri } from "../offline/localStores";

import {
  FILE_SEND_MAX_BYTES,
  type FileSendSourceKind,
  type FileSendStatus,
} from "@logjam/shared";

import { apiFetch } from "./apiFetch";
import { downloadFromPresignedUrl, uploadToPresignedUrl } from "./presignedTransfer";

/** One file waiting in my inbox, or one I already took. */
export type InboxFileSend = {
  fileSendId: string;
  status: FileSendStatus;
  sourceKind: FileSendSourceKind;
  filename: string;
  sizeBytes: number;
  createdAt: string;
  expiresAt: string;
  sentBy: { id: string; username: string };
};

export function getFileSendInbox(): Promise<InboxFileSend[]> {
  return apiFetch<InboxFileSend[]>("/file-sends/inbox");
}

/** Take the copy. Returns a short-lived URL; the caller downloads immediately. */
export function acceptFileSend(
  fileSendId: string,
): Promise<{ downloadUrl: string; filename: string }> {
  return apiFetch(`/file-sends/${fileSendId}/accept`, { method: "POST" });
}

/** Turn it down. Terminal for me only — every other recipient is untouched. */
export function declineFileSend(fileSendId: string): Promise<void> {
  return apiFetch<void>(`/file-sends/${fileSendId}/decline`, { method: "POST" });
}

/**
 * Three phases, the same shape media upload uses: presign → PUT straight to
 * S3 → confirm. The middle leg deliberately does NOT go through apiFetch — it
 * is a signed S3 URL, not our API, and must carry no auth header.
 *
 * Throws on any leg. A failed upload leaves an orphan blob with no row, which
 * the S3 lifecycle rule on the prefix collects; there is nothing to clean up
 * here and nothing to retry beyond calling this again.
 */
export async function sendFileCopy({
  fileUri,
  filename,
  sourceKind,
  recipientIds,
}: {
  fileUri: string;
  filename: string;
  sourceKind: FileSendSourceKind;
  recipientIds: string[];
}): Promise<void> {
  const info = await FileSystem.getInfoAsync(fileUri);
  if (!info.exists) throw new Error("That file is no longer on this device.");
  const sizeBytes = info.size ?? 0;
  if (sizeBytes <= 0) throw new Error("That file is empty.");
  // Checked here as well as server-side so a 64 MB upload is refused before it
  // starts rather than after it finishes.
  if (sizeBytes > FILE_SEND_MAX_BYTES) {
    const limitMb = Math.round(FILE_SEND_MAX_BYTES / 1024 / 1024);
    throw new Error(`That file is too big to send (${limitMb} MB limit).`);
  }

  const { fileSendId, uploadUrl } = await apiFetch<{
    fileSendId: string;
    uploadUrl: string;
  }>("/file-sends/presign", {
    method: "POST",
    body: { filename, sizeBytes, sourceKind, recipientIds },
  });

  // BINARY_CONTENT streams the file from disk. The alternative — reading it
  // into a JS string — corrupts any non-UTF-8 file (a GeoPDF is a PDF) and
  // would put 64 MB through Hermes, which has no JIT. The first-byte deadline
  // lives in presignedTransfer.ts: this leg carries no auth header, so
  // apiFetch's abort never reached it.
  const upload = await uploadToPresignedUrl(uploadUrl, fileUri);
  if (upload.status < 200 || upload.status >= 300) {
    // The S3 body is XML and may echo the key; say nothing but the status.
    throw new Error(`Upload failed (${upload.status}).`);
  }

  await apiFetch(`/file-sends/${fileSendId}/confirm`, {
    method: "POST",
    body: { filename, sourceKind, recipientIds },
  });
}

/**
 * Pull an accepted send's bytes down to a scratch file and hand back its URI.
 *
 * Not apiFetch: the URL is presigned, so an auth header on it is both pointless
 * and a token where one is not needed. The landing spot is SCRATCH_DIR, which
 * is what puts these bytes inside the wipe (offline/localStores.ts) — a
 * received file is somebody's canyon coordinates and must not sit loose in the
 * cache directory.
 */
export async function downloadFileSend(
  downloadUrl: string,
  scratchName: string,
): Promise<string> {
  const target = await scratchFileUri(scratchName);
  const result = await downloadFromPresignedUrl(downloadUrl, target);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Download failed (${result.status}).`);
  }
  return result.uri;
}
