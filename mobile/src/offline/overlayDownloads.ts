// Per-job topo overlay offline download (Stage 4b): stream the presigned
// pmtiles the overlay already renders from into app-private storage, verify,
// register a kind "topo-overlay" artifact. The resolver is local-first ALWAYS
// for full-coverage artifacts, so a downloaded overlay serves tiles even
// online, with zero map-code changes.
//
// No export job is created and no new API surface exists — this saves the
// exact artifact the map streams. (The reconcileExportSelection /
// validateExportRequest rule binds export-creating surfaces; nothing here
// requests an export.)
//
// PRIVACY: job bundles may include secret canyon-derived layers. Files live
// in the same app-private, backup-excluded store as basemap regions, behind
// the app lock (any artifact row arms it). Progress/errors are surfaced as
// state words and counts — never paths or job/layer labels.
import * as FileSystem from "expo-file-system/legacy";

import type { TopoLayerFormat, TopoLayerKey } from "@logjam/shared";

import type { MapArtifact } from "../map/sourceResolver";
import { insertArtifact } from "./registryDb";
import { assertSpaceFor, hasSpaceFor } from "./freeSpace";
import { OVERLAY_DIR } from "./localStores";

const PMTILES_MAGIC = "PMTiles";

function randomId(): string {
  // uuid-shaped id from the polyfilled crypto.getRandomValues (index.ts).
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type OverlayDownloadProgress = {
  bytesDone: number;
  /** 0 when the server sent no content-length. */
  bytesTotal: number;
};

/**
 * Download one job layer's pmtiles for offline use and register it.
 * Throws on any failure; never leaves a partial file registered.
 */
export async function downloadTopoOverlay(
  params: {
    jobId: string;
    layer: TopoLayerKey;
    format: TopoLayerFormat;
    /** Presigned URL from /topo-jobs/completed-overlays. */
    pmtilesUrl: string;
  },
  onProgress?: (progress: OverlayDownloadProgress) => void,
): Promise<MapArtifact> {
  const dir = OVERLAY_DIR;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const id = randomId();
  const fileUri = `${dir}${id}.pmtiles`;

  let expectedBytes = 0;
  // An overlay bundle's size is only knowable from the transfer itself (the
  // presigned URL is signed for GET, so a HEAD would fail the signature). So
  // the check rides the first progress tick and cancels the download rather
  // than filling the phone: this writer, and both auto-downloaders behind it,
  // had no space check at all and simply wrote until SQLite failed.
  let spaceChecked = false;
  let outOfSpace = false;
  try {
    // Presigned URL: auth lives in the query string — adding an Authorization
    // header would make S3 reject the request (two auth mechanisms).
    const resumable = FileSystem.createDownloadResumable(
      params.pmtilesUrl,
      fileUri,
      {},
      (p: FileSystem.DownloadProgressData) => {
        expectedBytes = p.totalBytesExpectedToWrite;
        if (!spaceChecked && expectedBytes > 0) {
          spaceChecked = true;
          void hasSpaceFor(expectedBytes).then((fits) => {
            if (fits) return;
            outOfSpace = true;
            void resumable.cancelAsync().catch(() => {});
          });
        }
        onProgress?.({
          bytesDone: p.totalBytesWritten,
          bytesTotal: Math.max(0, p.totalBytesExpectedToWrite),
        });
      },
    );
    const result = await resumable.downloadAsync();
    if (outOfSpace) {
      // Re-asked so the message carries the real numbers; it always throws here.
      await assertSpaceFor(expectedBytes);
    }
    if (!result || result.status !== 200) {
      throw new Error(`Overlay download failed (HTTP ${result?.status ?? "?"})`);
    }

    // Verify: content-length match when known + PMTiles magic bytes
    // (stage4a §9 http-file verify).
    const info = await FileSystem.getInfoAsync(fileUri);
    if (!info.exists || info.size === 0 || (expectedBytes > 0 && info.size !== expectedBytes)) {
      throw new Error("Overlay download incomplete");
    }
    const headBase64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
      position: 0,
      length: PMTILES_MAGIC.length,
    });
    if (atob(headBase64) !== PMTILES_MAGIC) {
      throw new Error("Overlay file is not a valid map archive");
    }

    const artifact: MapArtifact = {
      id,
      kind: "topo-overlay",
      logicalKey: `${params.jobId}/${params.layer}`,
      format: "pmtiles",
      sourceType: params.format,
      // Registry stores the scheme-less absolute path; the resolver prefixes
      // pmtiles://file:// itself.
      path: fileUri.replace(/^file:\/\//, ""),
      bbox: null,
      minzoom: null,
      maxzoom: null,
      sizeBytes: info.size,
      downloadedAt: new Date().toISOString(),
    };
    await insertArtifact(artifact);
    return artifact;
  } catch (err) {
    await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
    throw err;
  }
}
