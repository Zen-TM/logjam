// An offline clip of one of Logjam's own PMTiles archives (the vector
// basemap, a DEM, the contours), cut on the phone from the public archive on
// the CDN by byte range (`planExtract` in shared/src/pmtilesExtract.ts),
// written into app-private storage as it arrives, then registered. The
// resolver picks it up from the registry with no map code changes.
//
// PRIVACY: nothing here talks to Logjam's API, so the area never reaches it
// (docs/decisions/0036-the-phone-cuts-its-own-offline-clips.md). A request
// names the archive and a byte range, never a tile; nothing logs, and no
// error carries an offset (regionDownloads.test.ts).
import { File, FileMode, type FileHandle } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import { fetch as expoFetch } from "expo/fetch";
import { AppState } from "react-native";
import {
  BASEMAP_CATALOG,
  DEM_SOURCES,
  NSW_CONTOURS,
  fetchExtractRequest,
  planExtract,
  type ExtractPlan,
  type RegionBbox,
} from "@logjam/shared";

import { config } from "../config";
import type { MapArtifact } from "../map/sourceResolver";
import { failureDetail } from "./failureDetail";
import { assertSpaceFor } from "./freeSpace";
import { REGION_DIR } from "./localStores";
import { deleteArtifact, insertArtifact } from "./registryDb";
import { exhaustedTileOutcome } from "./regionTilePlanning";
import {
  connectionAllows,
  type RegionCancelToken,
  type RegionJobProgress,
  type RegionRunOutcome,
} from "./regionTileDownload";

export type RegionClipSpec = {
  /** uuid: the job, the file and, once saved, the artifact. */
  id: string;
  /** The vector basemap, or a DEM archive source's id (`demSourceId`). */
  basemapId: string;
  /** Set when the clip is of a DEM archive: shared demSources.ts. */
  demSourceId?: string;
  /** Set when the clip is of the statewide contours: shared nswContours.ts. */
  contours?: boolean;
  label: string;
  /** The download run this belongs to — see MapArtifact.groupId. */
  groupId: string;
  groupLabel: string;
  bbox: RegionBbox;
  allowCellular: boolean;
};

type Source = Parameters<typeof planExtract>[0];

/**
 * Where the clip comes from, and at what zooms: a DEM's and the contours' are
 * the ones their readers use; the vector map's are all the archive has. Its
 * full detail, whatever the detail rail says, because the rail prices rasters
 * and a lower zoom drops the minor tracks snapping follows.
 */
function clipArchiveFor(spec: RegionClipSpec): {
  archivePath: string;
  minzoom?: number;
  maxzoom?: number;
} {
  if (spec.demSourceId) {
    const dem = DEM_SOURCES.find((source) => source.id === spec.demSourceId);
    if (!dem?.archivePath) throw new Error("Unknown elevation source");
    return {
      archivePath: dem.archivePath,
      minzoom: dem.sampleZoom,
      maxzoom: dem.sampleZoom,
    };
  }
  if (spec.contours) return NSW_CONTOURS;
  const entry = BASEMAP_CATALOG.find((e) => e.id === "protomaps");
  if (!entry) throw new Error("protomaps missing from BASEMAP_CATALOG");
  return { archivePath: entry.urlTemplate };
}

/** The CDN answered, and not with the bytes asked for. */
class ArchiveStatusError extends Error {
  constructor(readonly status: number) {
    super(`The map archive answered ${status}`);
  }
}

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;

/**
 * A pmtiles `Source` over the CDN. No headers but the range: the archive is
 * public, so nothing identifies the user or the app to it. The platform's
 * default User-Agent still goes, and must: the web distribution's WAF refuses
 * a request without one (docs/decisions/0036).
 */
function rangeSource(url: string): Source {
  return {
    getKey: () => url,
    getBytes: async (offset, length, _signal, etag) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await expoFetch(url, {
          headers: { range: `bytes=${offset}-${offset + length - 1}` },
          signal: controller.signal,
        });
        // A 200 is the whole archive, from a server that ignored the range.
        if (response.status !== 206) {
          throw new ArchiveStatusError(response.status);
        }
        const tag = response.headers.get("etag");
        const strong = tag && !tag.startsWith("W/") ? tag : undefined;
        // The archive was replaced mid-clip: these bytes are from another one.
        if (etag && strong && strong !== etag)
          throw new ArchiveStatusError(412);
        const bytes = await response.bytes();
        return {
          data:
            bytes.byteOffset === 0 &&
            bytes.byteLength === bytes.buffer.byteLength
              ? bytes.buffer
              : bytes.slice().buffer,
          etag: strong,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function clipFileUri(id: string): string {
  return `${REGION_DIR}${id}.pmtiles`;
}

/** Delete a clip that never finished. A no-op when there is none. */
export async function deleteClipFile(id: string): Promise<void> {
  await FileSystem.deleteAsync(clipFileUri(id), { idempotent: true }).catch(
    () => {},
  );
}

/**
 * Where a partial file picks up: the first request it does not hold all of,
 * or null when the file was cut from something else (a rebuilt archive, a
 * different area) or is too short to tell. The file is the checkpoint
 * (docs/decisions/0005): its first bytes are the directories, which a
 * replanned clip reproduces exactly when nothing changed.
 * Guard: `regionDownloads.test.ts` ("resumes").
 */
export function resumeIndex(
  plan: Pick<ExtractPlan, "prefix" | "requests">,
  written: Uint8Array | null,
  size: number,
): number | null {
  if (!written || written.length !== plan.prefix.length) return null;
  for (let i = 0; i < written.length; i++) {
    if (written[i] !== plan.prefix[i]) return null;
  }
  const next = plan.requests.findIndex((request) => {
    const kept = request.keep.reduce((sum, part) => sum + part.length, 0);
    return request.dstOffset + kept > size;
  });
  return next === -1 ? plan.requests.length : next;
}

/** One network call, retried; a stop it cannot get past says why. */
async function attempt<T>(
  spec: RegionClipSpec,
  call: () => Promise<T>,
): Promise<{ value: T } | { stop: RegionRunOutcome; error: unknown }> {
  for (let tries = 1; ; tries++) {
    try {
      return { value: await call() };
    } catch (error) {
      // A status is the CDN's answer, and asking again gets the same one.
      if (error instanceof ArchiveStatusError) {
        return { stop: { status: "failed", code: "unknown" }, error };
      }
      if (tries >= MAX_ATTEMPTS) {
        const outcome = exhaustedTileOutcome(
          AppState.currentState,
          await connectionAllows(spec.allowCellular),
        );
        if (outcome === "dead") {
          return { stop: { status: "failed", code: "unknown" }, error };
        }
        const reason = outcome === "park" ? "background" : "connectivity";
        return { stop: { status: "paused", reason }, error };
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * tries));
    }
  }
}

/**
 * Cut, save and register one clip. Returns rather than throws for every
 * outcome the user can act on; a partial file stays for a resume unless the
 * job was cancelled.
 */
export async function runRegionClip(
  spec: RegionClipSpec,
  onProgress: (progress: RegionJobProgress) => void,
  token: RegionCancelToken,
): Promise<RegionRunOutcome> {
  // Checked before the first request, and again when one fails: opening the
  // screen on Wi-Fi and tapping Save out of range must not spend mobile data.
  if (!(await connectionAllows(spec.allowCellular))) {
    return { status: "paused", reason: "connectivity" };
  }
  const archive = clipArchiveFor(spec);
  const source = rangeSource(`${config.topoCdnBaseUrl}/${archive.archivePath}`);
  const planned = await attempt(spec, () =>
    planExtract(source, {
      bbox: spec.bbox,
      minzoom: archive.minzoom,
      maxzoom: archive.maxzoom,
    }),
  );
  const optional = spec.demSourceId != null || spec.contours === true;
  if ("stop" in planned) {
    // A DEM or contour archive that is not on the CDN yet is not this run's
    // failure: the area keeps its worldwide heights and its basemap, and the
    // job leaves the queue as if it had never been planned.
    if (optional && planned.error instanceof ArchiveStatusError) {
      return { status: "cancelled" };
    }
    if (planned.error instanceof ArchiveStatusError) {
      return { status: "failed", code: "source-unavailable" };
    }
    return planned.stop.status === "failed"
      ? { ...planned.stop, detail: failureDetail(planned.error) }
      : planned.stop;
  }
  const plan = planned.value;
  if (plan.outside) {
    if (optional) return { status: "cancelled" };
    return {
      status: "failed",
      code: "region-rejected",
      detail: "That area is outside the map Logjam has. Choose one in NSW.",
    };
  }

  const fileUri = clipFileUri(spec.id);
  await FileSystem.makeDirectoryAsync(REGION_DIR, { intermediates: true });
  const file = new File(fileUri);
  let handle: FileHandle | null = null;
  const report = (bytesDone: number) =>
    onProgress({
      tilesDone: 0,
      tilesTotal: 0,
      tilesGap: 0,
      tilesFailed: 0,
      bytesDone,
      bytesTotal: plan.totalBytes,
    });
  try {
    let start: number | null = null;
    if (file.exists) {
      handle = file.open(FileMode.ReadWrite);
      const size = file.size;
      start = resumeIndex(
        plan,
        size >= plan.prefix.length
          ? handle.readBytes(plan.prefix.length)
          : null,
        size,
      );
      handle.close();
      handle = null;
      // Cut from something else: start again, or its tail outlives the clip.
      if (start == null) file.delete();
    }
    if (!file.exists) file.create();
    handle = file.open(FileMode.ReadWrite);
    const resumedAt =
      start == null ? 0 : (plan.requests[start]?.dstOffset ?? plan.totalBytes);
    // The plan knows the clip's exact size, so this is the last moment the
    // answer is free; without it a full phone failed mid-write.
    await assertSpaceFor(plan.totalBytes - resumedAt);
    if (start == null) {
      handle.offset = 0;
      handle.writeBytes(plan.prefix);
      start = 0;
    }
    report(resumedAt || plan.prefix.length);

    for (let i = start; i < plan.requests.length; i++) {
      if (token.stop === "cancel") break;
      if (token.stop === "pause") {
        handle.close();
        return { status: "paused", reason: "user" };
      }
      const request = plan.requests[i];
      const got = await attempt(spec, () =>
        fetchExtractRequest(source, plan, request),
      );
      if ("stop" in got) {
        handle.close();
        if (got.stop.status !== "failed") return got.stop;
        return { ...got.stop, detail: failureDetail(got.error) };
      }
      handle.offset = request.dstOffset;
      handle.writeBytes(got.value);
      report(request.dstOffset + got.value.length);
    }
    handle.close();
    handle = null;
    if (token.stop === "cancel") {
      await deleteClipFile(spec.id);
      return { status: "cancelled" };
    }
    if (new File(fileUri).size !== plan.totalBytes) {
      await deleteClipFile(spec.id);
      return { status: "failed", code: "verify-failed" };
    }

    const artifact: MapArtifact = {
      id: spec.id,
      // A DEM clip is filed under its source id, which is what the sampler
      // looks saved files up by (offline/demLookup.ts).
      kind: spec.demSourceId
        ? "dem-region"
        : spec.contours
          ? "contours-region"
          : "basemap-region",
      logicalKey:
        spec.demSourceId ?? (spec.contours ? NSW_CONTOURS.id : "protomaps"),
      format: "pmtiles",
      sourceType: spec.demSourceId ? "raster" : "vector",
      // Registry stores the scheme-less absolute path; the resolver prefixes
      // pmtiles://file:// itself.
      path: fileUri.replace(/^file:\/\//, ""),
      bbox: [spec.bbox.west, spec.bbox.south, spec.bbox.east, spec.bbox.north],
      minzoom: plan.minzoom,
      maxzoom: plan.maxzoom,
      sizeBytes: plan.totalBytes,
      downloadedAt: new Date().toISOString(),
      label: spec.label,
      groupId: spec.groupId,
      groupLabel: spec.groupLabel,
    };
    await insertArtifact(artifact);
    return { status: "ready", artifact, gaps: 0, failed: 0 };
  } catch (err) {
    handle?.close();
    // The file stays: a failed job is offered again and picks up where it was.
    console.error(err);
    return { status: "failed", code: "unknown", detail: failureDetail(err) };
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
