// Protomaps region download (stage4a §7.2 client side): POST the bbox to the
// clip endpoint (body-only — never a URL), stream the clip via the opaque
// token GET into app-private storage, verify, register in the artifact
// registry. The resolver picks the region up from the registry with no map
// code changes.
//
// PRIVACY: the bbox rides the authed POST body only; progress/errors are
// logged (console) as state words and counts, never coordinates or paths.
import * as FileSystem from "expo-file-system/legacy";

import { apiFetch, getAuthedRequestHeaders } from "../api/apiFetch";
import { config } from "../config";
import type { MapArtifact } from "../map/sourceResolver";
import { insertArtifact, deleteArtifact } from "./registryDb";
import { assertSpaceFor } from "./freeSpace";
import { REGION_DIR } from "./localStores";

const PMTILES_MAGIC = "PMTiles";

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
  /**
   * The QUEUE's job, id and label included. This used to mint its own id and
   * take no label at all: the Saved list then showed the clip as "Offline map
   * region" instead of the name the download screen had composed, and cancelling
   * a still-QUEUED clip job asked `deleteAbandonedRegion(spec.id)` to delete a
   * `<spec.id>.mbtiles` that could never exist under that id. One id, both ends.
   */
  spec: {
    id: string;
    label: string;
    /** The download run this belongs to — see MapArtifact.groupId. */
    groupId: string;
    groupLabel: string;
    bbox: { west: number; south: number; east: number; north: number };
    /**
     * Detail ceiling, so the download screen's detail rail means the same thing
     * for the vector basemap as for the raster ones. Clamped server-side to the
     * archive's own z15.
     */
    zMax?: number;
  },
  onProgress?: (progress: RegionDownloadProgress) => void,
): Promise<MapArtifact> {
  const { bbox, id } = spec;
  const maxzoom = spec.zMax;
  const clip = await apiFetch<RegionClipResponse>("/basemap/region-clip", {
    method: "POST",
    body: maxzoom != null ? { ...bbox, maxzoom } : bbox,
  });

  // The server has now told us exactly how big this is (up to 80 MB), and this
  // is the last moment the answer is free. Without it a full phone failed
  // mid-write and reported "That didn't finish. Try again."
  await assertSpaceFor(clip.sizeBytes);

  const dir = REGION_DIR;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
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
      throw new Error("Region download failed");
    }

    // Verify: exact size + PMTiles magic bytes (stage4a §9 http-file verify).
    const info = await FileSystem.getInfoAsync(fileUri);
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
      throw new Error("The downloaded file isn't a valid map");
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
      maxzoom: Math.min(maxzoom ?? 15, 15),
      sizeBytes: clip.sizeBytes,
      downloadedAt: new Date().toISOString(),
      label: spec.label,
      groupId: spec.groupId,
      groupLabel: spec.groupLabel,
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
