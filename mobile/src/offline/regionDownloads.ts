// Protomaps region download (stage4a §7.2 client side): POST the bbox to the
// clip endpoint (body-only — never a URL), stream the clip via the opaque
// token GET into app-private storage, verify, register in the artifact
// registry. The resolver picks the region up from the registry with no map
// code changes.
//
// PRIVACY: the bbox rides the authed POST body only; progress/errors are
// logged (console) as state words and counts, never coordinates or paths.
import * as FileSystem from "expo-file-system";

import { apiFetch, getAuthedRequestHeaders } from "../api/apiFetch";
import { config } from "../config";
import type { MapArtifact } from "../map/sourceResolver";
import { insertArtifact, deleteArtifact } from "./registryDb";

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

export type RegionClipResponse = {
  token: string;
  sizeBytes: number;
  expiresInSeconds: number;
};

export type RegionDownloadProgress = {
  bytesDone: number;
  bytesTotal: number;
};

/**
 * Download the current-area Protomaps clip and register it offline.
 * Throws on any failure (caller surfaces the message); never leaves a
 * partial file registered.
 */
export async function downloadProtomapsRegion(
  bbox: { west: number; south: number; east: number; north: number },
  onProgress?: (progress: RegionDownloadProgress) => void,
): Promise<MapArtifact> {
  const clip = await apiFetch<RegionClipResponse>("/basemap/region-clip", {
    method: "POST",
    body: bbox,
  });

  const dir = `${FileSystem.documentDirectory}offline/regions/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const id = randomId();
  const fileUri = `${dir}${id}.pmtiles`;

  try {
    const headers = await getAuthedRequestHeaders();
    const resumable = FileSystem.createDownloadResumable(
      `${config.apiUrl}/basemap/region-clip/${clip.token}`,
      fileUri,
      { headers },
      (p: FileSystem.DownloadProgressData) =>
        onProgress?.({
          bytesDone: p.totalBytesWritten,
          bytesTotal: clip.sizeBytes,
        }),
    );
    const result = await resumable.downloadAsync();
    if (!result || result.status !== 200) {
      throw new Error(`Region download failed (HTTP ${result?.status ?? "?"})`);
    }

    // Verify: exact size + PMTiles magic bytes (stage4a §9 http-file verify).
    const info = await FileSystem.getInfoAsync(fileUri, { size: true });
    if (!info.exists || info.size !== clip.sizeBytes) {
      throw new Error("Region download incomplete");
    }
    const headBase64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
      position: 0,
      length: PMTILES_MAGIC.length,
    });
    // atob is available in Hermes (and polyfilled paths elsewhere in the app).
    if (atob(headBase64) !== PMTILES_MAGIC) {
      throw new Error("Region file is not a valid map archive");
    }

    const artifact: MapArtifact = {
      id,
      kind: "basemap-region",
      logicalKey: "protomaps",
      format: "pmtiles",
      sourceType: "vector",
      // Registry stores the scheme-less absolute path; the resolver prefixes
      // pmtiles://file:// itself.
      path: fileUri.replace(/^file:\/\//, ""),
      bbox: [bbox.west, bbox.south, bbox.east, bbox.north],
      minzoom: 0,
      maxzoom: 15,
      sizeBytes: clip.sizeBytes,
      downloadedAt: new Date().toISOString(),
    };
    await insertArtifact(artifact);
    return artifact;
  } catch (err) {
    await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
    throw err;
  }
}

/** Delete any downloaded artifact (region or overlay): registry row + file. */
export async function deleteDownloadedArtifact(id: string): Promise<void> {
  const artifact = await deleteArtifact(id);
  if (artifact) {
    await FileSystem.deleteAsync(`file://${artifact.path}`, {
      idempotent: true,
    }).catch(() => {});
  }
}
