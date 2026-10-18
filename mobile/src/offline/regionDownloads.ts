// An offline clip of one of Logjam's own PMTiles archives (the vector
// basemap, a DEM, the contours), cut on the phone from the public archive on
// the CDN by byte range (`planExtract` in shared/src/pmtilesExtract.ts),
// written into app-private storage as it arrives, then registered. The
// resolver picks it up from the registry with no map code changes.
//
// PRIVACY: nothing here talks to Logjam's API, so the area never reaches it
// (docs/decisions/0036-the-phone-cuts-its-own-offline-clips.md). A request
// names the archive and a byte range, never a tile. Nothing here logs, and a
// failure reports a code, never a status's text or an offset. Guard:
// regionDownloads.test.ts ("cuts the clip from the CDN, asking for nothing
// but byte ranges", "picks up where a failed run stopped, and says nothing
// about where").
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

/**
 * Per request: a floor, plus the body at 128 kbit/s, so a full 4 MiB request
 * can finish on a weak link instead of timing out on every retry.
 */
const requestTimeoutMs = (length: number) => 30_000 + length / 16;
const MAX_ATTEMPTS = 3;

/**
 * A pmtiles `Source` over the CDN. No headers but the range: the archive is
 * public, so nothing identifies the user or the app to it. The platform's
 * default User-Agent still goes, and must: the web distribution's WAF refuses
 * a request without one (docs/decisions/0036).
 */
function rangeSource(
  url: string,
  token: RegionCancelToken,
  /** Called every 30 s while a request is in flight. */
  alive: () => void,
): Source {
  const fetchRange = async (
    offset: number,
    length: number,
    etag: string | undefined,
  ) => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      requestTimeoutMs(length),
    );
    // A cancel stops the request in flight: an account wipe waits only
    // seconds for a download to stop, and a large range on 3G takes longer.
    // The same tick keeps the download's notice, and with it the CPU lock
    // that lapses after 3 minutes unrenewed, alive through a slow request.
    // Guard: regionDownloads.test.ts ("keeps the download alive …").
    let ticks = 0;
    const watch = setInterval(() => {
      if (token.stop === "cancel") controller.abort();
      if (++ticks % 60 === 0) alive();
    }, 500);
    try {
      const response = await expoFetch(url, {
        headers: { range: `bytes=${offset}-${offset + length - 1}` },
        signal: controller.signal,
      });
      const tag = response.headers.get("etag");
      const strong = tag && !tag.startsWith("W/") ? tag : undefined;
      // A 200 is the whole archive, from a server that ignored the range;
      // another ETag, an archive replaced mid-clip. Either body is aborted
      // unread, or the native side buffers it.
      if (response.status !== 206 || (etag && strong && strong !== etag)) {
        controller.abort();
        throw new ArchiveStatusError(
          response.status === 206 ? 412 : response.status,
        );
      }
      const bytes = await response.bytes();
      return {
        data:
          bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
            ? bytes.buffer
            : bytes.slice().buffer,
        etag: strong,
      };
    } finally {
      clearTimeout(timer);
      clearInterval(watch);
    }
  };
  return {
    getKey: () => url,
    // Each range is retried on its own, so a planning walk of a dozen
    // directory reads is not restarted whole by one failed read.
    getBytes: async (offset, length, _signal, etag) => {
      // A function, not the field: the token changes under an await.
      const cancelled = () => token.stop === "cancel";
      for (let tries = 1; ; tries++) {
        if (cancelled()) throw new Error("Cancelled");
        try {
          return await fetchRange(offset, length, etag);
        } catch (error) {
          if (final(error) || cancelled() || tries >= MAX_ATTEMPTS) throw error;
          await new Promise((resolve) => setTimeout(resolve, 1000 * tries));
        }
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

/**
 * The CDN's answers that asking again cannot change: the archive is not there
 * (403 from S3 behind CloudFront, 404), or the host ignores ranges (200) or
 * refuses them (416). Anything else, a 5xx or a 429, is retried.
 */
function permanent(error: unknown): error is ArchiveStatusError {
  return (
    error instanceof ArchiveStatusError &&
    [200, 403, 404, 416].includes(error.status)
  );
}

/**
 * Not worth another try in this run: a permanent answer, or an archive
 * replaced mid-clip (412), which only a replan (the user's Resume) gets past.
 */
function final(error: unknown): boolean {
  return (
    permanent(error) ||
    (error instanceof ArchiveStatusError && error.status === 412)
  );
}

/** One call through the retrying source; a stop it cannot get past says why. */
async function attempt<T>(
  spec: RegionClipSpec,
  token: RegionCancelToken,
  call: () => Promise<T>,
): Promise<{ value: T } | { stop: RegionRunOutcome; error: unknown }> {
  try {
    return { value: await call() };
  } catch (error) {
    if (token.stop === "cancel")
      return { stop: { status: "cancelled" }, error };
    if (final(error)) {
      return { stop: { status: "failed", code: "unknown" }, error };
    }
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
}

/**
 * Cut, save and register one clip. Returns rather than throws for every
 * outcome the user can act on; a partial file stays for a resume unless the
 * job was cancelled or its archive is gone.
 */
export async function runRegionClip(
  spec: RegionClipSpec,
  onProgress: (progress: RegionJobProgress) => void,
  token: RegionCancelToken,
): Promise<RegionRunOutcome> {
  // A DEM or contour archive that is not on the CDN (not built yet) is not
  // this run's failure: the area keeps its worldwide heights and its basemap,
  // and the job leaves the queue as if it had never been planned.
  const optional = spec.demSourceId != null || spec.contours === true;
  let handle: FileHandle | null = null;
  const settle = async (stop: {
    stop: RegionRunOutcome;
    error: unknown;
  }): Promise<RegionRunOutcome> => {
    handle?.close();
    handle = null;
    const gone =
      permanent(stop.error) && [403, 404].includes(stop.error.status);
    if (stop.stop.status === "cancelled" || (optional && gone)) {
      await deleteClipFile(spec.id);
      return { status: "cancelled" };
    }
    if (permanent(stop.error)) {
      await deleteClipFile(spec.id);
      return { status: "failed", code: "source-unavailable" };
    }
    // A status's text is not for the row (shared/DESIGN.md §11).
    if (
      stop.stop.status !== "failed" ||
      stop.error instanceof ArchiveStatusError
    ) {
      return stop.stop;
    }
    return { ...stop.stop, detail: failureDetail(stop.error) };
  };
  try {
    // Checked before every request, as the tile path checks every 16 tiles: a
    // Wi-Fi-only clip must not carry on over mobile data when Wi-Fi drops,
    // nor start on it when Save was tapped out of range.
    // Guard: regionDownloads.test.ts ("stops for a connection it may not use").
    const allowed = async () => {
      if (await connectionAllows(spec.allowCellular)) return true;
      handle?.close();
      handle = null;
      return false;
    };
    if (!(await allowed())) return { status: "paused", reason: "connectivity" };
    const archive = clipArchiveFor(spec);
    // The last progress, sent again by the source's heartbeat.
    let progress: RegionJobProgress = {
      tilesDone: 0,
      tilesTotal: 0,
      tilesGap: 0,
      tilesFailed: 0,
      bytesDone: 0,
      bytesTotal: 0,
    };
    const source = rangeSource(
      `${config.topoCdnBaseUrl}/${archive.archivePath}`,
      token,
      () => onProgress({ ...progress }),
    );
    const planned = await attempt(spec, token, () =>
      planExtract(source, {
        bbox: spec.bbox,
        minzoom: archive.minzoom,
        maxzoom: archive.maxzoom,
      }),
    );
    if ("stop" in planned) return await settle(planned);
    const plan = planned.value;
    if (plan.outside) {
      if (optional) return { status: "cancelled" };
      return {
        status: "failed",
        code: "region-rejected",
        detail: "outside-nsw",
      };
    }

    const fileUri = clipFileUri(spec.id);
    await FileSystem.makeDirectoryAsync(REGION_DIR, { intermediates: true });
    const file = new File(fileUri);
    const report = (bytesDone: number) => {
      progress = { ...progress, bytesDone, bytesTotal: plan.totalBytes };
      onProgress({ ...progress });
    };
    let start: number | null = null;
    if (file.exists) {
      handle = file.open(FileMode.ReadWrite);
      const size = file.size;
      start = resumeIndex(
        plan,
        size >= plan.prefix.length
          ? await handle.readBytes(plan.prefix.length)
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
      await handle.writeBytes(plan.prefix);
      start = 0;
    }
    report(resumedAt || plan.prefix.length);

    for (let i = start; i < plan.requests.length; i++) {
      if (token.stop === "cancel") {
        return await settle({ stop: { status: "cancelled" }, error: null });
      }
      if (!(await allowed())) {
        return { status: "paused", reason: "connectivity" };
      }
      const request = plan.requests[i];
      const got = await attempt(spec, token, () =>
        fetchExtractRequest(source, plan, request),
      );
      if ("stop" in got) return await settle(got);
      handle.offset = request.dstOffset;
      await handle.writeBytes(got.value);
      report(request.dstOffset + got.value.length);
    }
    handle.close();
    handle = null;
    if (token.stop === "cancel") {
      return await settle({ stop: { status: "cancelled" }, error: null });
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
    // The file stays: a failed job is offered again and picks up where it was.
    return settle({ stop: { status: "failed", code: "unknown" }, error: err });
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
