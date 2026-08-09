// The one place a region download's live state lives, for every screen that
// shows it: the download screen that started it, the map's progress chip, and
// the layers sheet's offline section.
//
// A module store rather than a context (same choice as `canyonMapFilter`): a
// download outlives the screen that started it — the whole point of the chip on
// the map is that you can leave the download screen and keep walking around the
// map while tiles land.
//
// ONE AT A TIME (§3.3). Selecting three basemaps enqueues three jobs and they
// run in sequence, because the politeness envelope is per-provider and running
// them in parallel would triple the request rate at the same host.
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { ApiError, type OfflineBasemapId, type RegionBbox } from "@logjam/shared";

import type { PausedReason } from "./downloadMachine";
import {
  connectionAllows,
  runRegionDownload,
  type RegionCancelToken,
  type RegionFailureCode,
  type RegionJobProgress,
  type RegionJobSpec,
  type RegionRunOutcome,
} from "./regionTileDownload";

/**
 * Two task kinds, one queue (stage4a §9): the SIX rasters are fetched tile by
 * tile straight from the provider, while the self-hosted vector basemap is one
 * clip file served by our own API. The user is choosing between maps, not
 * between transports, so they share the screen, the queue and this progress
 * shape.
 */
export type RegionTaskSpec =
  | ({ taskKind: "tile-pyramid" } & RegionJobSpec)
  | {
      taskKind: "http-file";
      id: string;
      basemapId: "protomaps";
      label: string;
      bbox: RegionBbox;
      zMax: number;
      allowCellular: boolean;
    };

export type RegionJobState =
  | { kind: "queued" }
  | { kind: "downloading" }
  | { kind: "paused"; reason: PausedReason }
  | { kind: "failed"; code: RegionFailureCode }
  | { kind: "ready"; gaps: number; failed: number };

export type RegionJob = {
  spec: RegionTaskSpec;
  state: RegionJobState;
  progress: RegionJobProgress;
};

const EMPTY_PROGRESS: RegionJobProgress = {
  tilesDone: 0,
  tilesTotal: 0,
  tilesGap: 0,
  tilesFailed: 0,
  bytesDone: 0,
  bytesTotal: 0,
};

let jobs: RegionJob[] = [];
let snapshot: RegionJob[] = jobs;
let pumping = false;
const tokens = new Map<string, RegionCancelToken>();
const listeners = new Set<() => void>();

function publish(): void {
  // New array identity per change — useSyncExternalStore compares by reference.
  snapshot = [...jobs];
  for (const listener of listeners) listener();
}

function patch(id: string, change: Partial<RegionJob>): void {
  jobs = jobs.map((job) => (job.spec.id === id ? { ...job, ...change } : job));
  publish();
}

export function useRegionDownloads(): RegionJob[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}

/** The job the user is waiting on right now, if any. */
export function activeRegionJob(list: RegionJob[]): RegionJob | null {
  return list.find((job) => job.state.kind === "downloading") ?? null;
}

export function pendingRegionJobCount(list: RegionJob[]): number {
  return list.filter(
    (job) => job.state.kind === "queued" || job.state.kind === "downloading",
  ).length;
}

/**
 * Re-queue jobs the WORKER parked on its own, once the condition that parked
 * them has cleared.
 *
 * Without this, backgrounding the phone was terminal: the worker parks on
 * `AppState !== "active"` and on a disallowed connection, the pump then walks
 * to the next queued job which parks on the same check, and the only caller of
 * `resumeRegionDownload` anywhere in the app was the Resume button on a screen
 * the user had already left. The screen lock at 30 s was enough to end the
 * download — and because a partial region is never registered as an artifact,
 * the user walked into the gorge with no map at all rather than a partial one,
 * having read "Paused — waiting for Wi-Fi", which promises the opposite.
 *
 * `user` and `provider-backoff` are deliberately excluded: one is the user's
 * decision, the other is the politeness envelope's, and neither is ours to
 * overturn.
 */
function resumeJobsPausedBy(reason: Extract<PausedReason, "background" | "connectivity">): void {
  let changed = false;
  jobs = jobs.map((job) => {
    if (job.state.kind !== "paused" || job.state.reason !== reason) return job;
    changed = true;
    return { ...job, state: { kind: "queued" } as RegionJobState };
  });
  if (!changed) return;
  publish();
  void pump();
}

// Installed on first enqueue rather than at import: a user who never downloads
// a region should not be paying for two global subscriptions.
let watchersInstalled = false;
function installAutoResumeWatchers(): void {
  if (watchersInstalled) return;
  watchersInstalled = true;
  AppState.addEventListener("change", (state) => {
    if (state === "active") resumeJobsPausedBy("background");
  });
  // Edge-triggered (offline → online), same shape as the sync engine's.
  let wasConnected: boolean | null = null;
  NetInfo.addEventListener((netState) => {
    const connected = netState.isConnected === true;
    if (connected && wasConnected === false) resumeJobsPausedBy("connectivity");
    wasConnected = connected;
  });
}

export function enqueueRegionDownloads(specs: RegionTaskSpec[]): void {
  installAutoResumeWatchers();
  jobs = [
    // Settled jobs from an earlier batch are dropped, not kept: the progress
    // screen is about the download the user just started, and a failure from
    // half an hour ago sitting in its list (counted in its "1 didn't finish")
    // reads as this batch having failed. Anything still running or paused
    // stays — that is live work, not history.
    ...jobs.filter(
      (job) => job.state.kind !== "ready" && job.state.kind !== "failed",
    ),
    ...specs.map((spec) => ({
      spec,
      state: { kind: "queued" } as RegionJobState,
      progress: { ...EMPTY_PROGRESS },
    })),
  ];
  publish();
  void pump();
}

/**
 * Run queued jobs one after another. Re-entrant-safe: `pumping` is the single
 * active slot, and every path that could make a job runnable calls back in.
 */
async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const next = jobs.find((job) => job.state.kind === "queued");
      if (!next) return;
      const token: RegionCancelToken = { stop: null };
      tokens.set(next.spec.id, token);
      patch(next.spec.id, { state: { kind: "downloading" } });

      const report = (progress: RegionJobProgress) =>
        patch(next.spec.id, { progress });
      const outcome =
        next.spec.taskKind === "tile-pyramid"
          ? await runRegionDownload(next.spec, report, token)
          : await runProtomapsClip(next.spec, report, token);
      tokens.delete(next.spec.id);

      if (outcome.status === "cancelled") {
        jobs = jobs.filter((job) => job.spec.id !== next.spec.id);
        publish();
        continue;
      }
      patch(next.spec.id, {
        state:
          outcome.status === "ready"
            ? { kind: "ready", gaps: outcome.gaps, failed: outcome.failed }
            : outcome.status === "paused"
              ? { kind: "paused", reason: outcome.reason }
              : { kind: "failed", code: outcome.code },
      });
    }
  } finally {
    pumping = false;
  }
}

/**
 * The vector basemap's clip, wrapped in the same outcome shape. There is no
 * politeness envelope here: it is one request to our own API, and
 * `expo-file-system`'s resumable download owns the transport.
 */
async function runProtomapsClip(
  spec: Extract<RegionTaskSpec, { taskKind: "http-file" }>,
  onProgress: (progress: RegionJobProgress) => void,
  token: RegionCancelToken,
): Promise<RegionRunOutcome> {
  const { deleteDownloadedArtifact, downloadProtomapsRegion } = await import(
    "./regionDownloads"
  );
  // The tile path re-checks this every 16 tiles; the clip path never checked
  // it at all. The only guard was an alert on the download screen driven by a
  // connection state read ONCE on mount — so opening the screen on Wi-Fi at
  // the trailhead and tapping Save after walking out of range pulled an up-to-
  // 80 MB clip over mobile data with no warning.
  if (!(await connectionAllows(spec.allowCellular))) {
    return { status: "paused", reason: "connectivity" };
  }
  try {
    const artifact = await downloadProtomapsRegion(
      spec.bbox,
      (progress) =>
        onProgress({
          tilesDone: 0,
          tilesTotal: 0,
          tilesGap: 0,
          tilesFailed: 0,
          bytesDone: progress.bytesDone,
          bytesTotal: progress.bytesTotal,
        }),
      spec.zMax,
    );
    // A clip is one request: there is no mid-flight stop, so a cancel that
    // arrives while it runs is honoured by undoing it.
    if (token.stop === "cancel") {
      await deleteDownloadedArtifact(artifact.id);
      return { status: "cancelled" };
    }
    return { status: "ready", artifact, gaps: 0, failed: 0 };
  } catch (err) {
    console.error(err);
    // A 5xx from the clip endpoint is the SERVER saying it cannot cut this map
    // — the archive isn't configured, the `pmtiles` binary isn't on the host,
    // or the extract died. None of those get better by tapping Resume, and
    // reporting them as the generic "That didn't finish. Try again." sent the
    // user round that loop indefinitely. (It is also the whole of the 503 seen
    // in local dev: PROTOMAPS_ARCHIVE_URI is unset there and no archive exists
    // to cut from — see api/src/routes/basemap.ts.)
    if (err instanceof ApiError && err.status >= 500) {
      return { status: "failed", code: "source-unavailable" };
    }
    return { status: "failed", code: "unknown" };
  }
}

/** Stop for now; the partial MBTiles keeps every tile already fetched. */
export function pauseRegionDownload(id: string): void {
  const token = tokens.get(id);
  if (token) token.stop = "pause";
  else patch(id, { state: { kind: "paused", reason: "user" } });
}

export function resumeRegionDownload(id: string): void {
  patch(id, { state: { kind: "queued" } });
  void pump();
}

/** Give up on a job: drop it from the queue and delete its partial file. */
export function cancelRegionDownload(id: string): void {
  const token = tokens.get(id);
  if (token) {
    token.stop = "cancel";
    return; // the pump removes the row when the run returns "cancelled"
  }
  jobs = jobs.filter((job) => job.spec.id !== id);
  publish();
  void deleteAbandonedRegion(id);
}

async function deleteAbandonedRegion(id: string): Promise<void> {
  const { deleteRegionFile } = await import("./regionMbtiles");
  await deleteRegionFile(id);
}

export type { OfflineBasemapId };
