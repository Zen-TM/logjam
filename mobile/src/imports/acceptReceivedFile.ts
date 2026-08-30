// Taking a copy a friend sent — the whole accept, from "yes" to a Saved item.
//
// A COPY, not a share. This downloads the real bytes and runs them through the
// SAME import a picked file goes through, so the recipient derives their own
// GeoJSON on their own device. From that moment it is theirs: editable,
// permanent, and unaffected by anything the sender does later.
//
// Its own module (rather than the notifications screen's business) because the
// screen changed once already: this ran inside `screens/ReceivedFilesScreen.tsx`
// until the inbox absorbed it, and the pipeline is not what changed.
//
// PRIVACY: `filename` is user text and routinely names a canyon. It reaches the
// import and the on-screen label; it is never logged.
import * as FileSystem from "expo-file-system/legacy";

import { acceptFileSend, downloadFileSend } from "../api/fileSends";
import { importGeoPdfFile } from "../geopdf/importPipeline";
import { runGeoPdfImport } from "../geopdf/importRunner";
import { listVectorImports } from "./importsDb";
import { importVectorSource } from "./vectorImports";

/** A PDF goes through the GeoPDF pipeline; everything else is a vector import. */
function isPdf(filename: string): boolean {
  return filename.toLowerCase().endsWith(".pdf");
}

/**
 * Accept a send and import its bytes. Throws on any leg — the caller reports it
 * and leaves the send acceptable again (an accepted recipient stays
 * downloadable until the TTL, which is what makes the retry honest).
 */
export async function acceptReceivedFile(
  fileSendId: string,
  sentByUsername: string | null,
): Promise<void> {
  // Deleted in the finally: this is the ONE import entry point whose input is
  // already a `file://` path, so `stageIncomingFile` returns `scratch: null`
  // and both pipelines' own cleanup no-ops. Nothing else sweeps SCRATCH_DIR
  // before sign-out, so a season of accepted GeoPDFs (up to 64 MB each)
  // otherwise just accumulates, uncounted by the Saved capacity meter.
  let scratchUri: string | null = null;
  try {
    const { downloadUrl, filename } = await acceptFileSend(fileSendId);
    const uri = await downloadFileSend(downloadUrl, `received-${fileSendId}`);
    scratchUri = uri;
    if (isPdf(filename)) {
      // Through the runner, like every other GeoPDF entry point: it is the
      // "one import at a time" guard, and two would fight over the single
      // native rasteriser.
      await runGeoPdfImport(filename, (onProgress, token) =>
        importGeoPdfFile(filename, uri, onProgress, token),
      );
    } else {
      // The same function the OS "Open in Logjam" intent calls — the
      // recipient's GeoJSON is derived here, from the original bytes, rather
      // than being handed a lossy round trip.
      const existing = await listVectorImports();
      await importVectorSource(uri, filename, existing.length, sentByUsername);
    }
  } finally {
    if (scratchUri) {
      await FileSystem.deleteAsync(scratchUri, { idempotent: true }).catch(() => {});
    }
  }
}
