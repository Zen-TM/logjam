// Every file the OS hands this app arrives here first — and is refused here,
// before a byte is read or copied, if it is too big to survive.
//
// THE ORDER IS THE POINT. Both import paths checked their size ceiling on the
// wrong side of the expensive step: the GeoPDF path copied a share-sheet
// `content://` file into app-private storage IN FULL and then measured it (so a
// 2 GB "PDF" filled the phone up before being rejected), and the vector path
// only checked in the picker flow at all — "Open in Logjam" on a 200 MB
// `.geojson` went straight to `readAsStringAsync`, i.e. the whole file into one
// JS string, and the app died before any guard ran. Stat first, refuse second,
// copy third.
//
// Staging exists because a `content://` URI is not a file: neither the native
// hasher nor `expo-file-system/next` can open one. The legacy `copyAsync` can,
// and does it natively — which is also what lets the KMZ reader take the bytes
// as a `Uint8Array` instead of decoding base64 a character at a time.
//
// PRIVACY: file names and paths stay in-app; nothing here logs either.
import * as FileSystem from "expo-file-system/legacy";

import { scratchFileUri } from "../offline/localStores";

/**
 * Size in bytes, for a `file://` or a `content://` URI alike (expo answers the
 * latter from the stream's `available()`). Throws when the URI can't be opened
 * at all — a caller that can't measure a file must not go on to read it.
 */
export async function fileSizeBytes(uri: string): Promise<number> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) throw new Error("Logjam couldn't open that file.");
  return info.size ?? 0;
}

/**
 * A readable `file://` URI for `uri`, no larger than `maxBytes`.
 *
 * Returns the scratch path it created (or null), which the caller deletes in a
 * `finally` — the scratch tree is inside `SCRATCH_DIR`, so a missed one is
 * still covered by the account wipe rather than loose in the cache directory.
 */
export async function stageIncomingFile(params: {
  uri: string;
  maxBytes: number;
  /** Static, user-facing; never file content. */
  tooLargeMessage: string;
  scratchName: string;
}): Promise<{ uri: string; scratch: string | null }> {
  const size = await fileSizeBytes(params.uri);
  // 0 = the provider wouldn't say. Not a licence to read it unbounded: the
  // parser's own guards are downstream of a bounded read either way, and a file
  // that measures 0 and is huge would have failed the old check too.
  if (size > params.maxBytes) throw new Error(params.tooLargeMessage);
  if (params.uri.startsWith("file://")) return { uri: params.uri, scratch: null };
  const scratch = await scratchFileUri(params.scratchName);
  await FileSystem.copyAsync({ from: params.uri, to: scratch });
  return { uri: scratch, scratch };
}
