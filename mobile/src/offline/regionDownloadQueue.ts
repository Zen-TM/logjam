// The one place a region download's live state lives, for every screen that
// shows it: the Saved tab's progress cards, the map's "Downloading maps"
// banner, and the layers sheet's offline section.
//
// A module store rather than a context (same choice as `canyonMapFilter`): a
// download outlives the screen that started it — the whole point of the banner
// on the map is that you can leave the download screen and keep walking around
// the map while tiles land.
//
// ONE AT A TIME (§3.3). Selecting three basemaps enqueues three jobs and they
// run in sequence, because the politeness envelope is per-provider and running
// them in parallel would triple the request rate at the same host.
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { ApiError, type OfflineBasemapId, type RegionBbox } from "@logjam/shared";

import { subscribeReconnect } from "../map/connectivity";
import type { ToastMessage } from "../ui/Toast";
import { groupRegionJobs, regionGroupToastText } from "./regionDownloadGroups";
import { failureDetail } from "./failureDetail";
import {
  connectionAllows,
  runRegionDownload,
  type PausedReason,
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
      groupId: string;
      groupLabel: string;
      bbox: RegionBbox;
      zMax: number;
      allowCellular: boolean;
    };

export type RegionJobState =
  | { kind: "queued" }
  | { kind: "downloading" }
  | { kind: "paused"; reason: PausedReason }
  | { kind: "failed"; code: RegionFailureCode; detail?: string }
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
/** The in-flight drain, so a caller that needs the workers STOPPED can await
 * it (see `cancelAllRegionDownloads`). Null when nothing is running. */
let pumping: Promise<void> | null = null;
const tokens = new Map<string, RegionCancelToken>();
const listeners = new Set<() => void>();

function publish(): void {
  // New array identity per change — useSyncExternalStore compares by reference.
  snapshot = [...jobs];
  for (const listener of listeners) listener();
  announceSettledGroups();
}

// --- Finish toast ---------------------------------------------------------
// A region download is background work now (the progress SCREEN is gone; Saved
// shows a card), so it announces itself the way a GeoPDF import does — one
// toast at the app shell, wherever the user has got to. Mirrors
// `onGeoPdfImportToast` in geopdf/importRunner.ts deliberately: one shape for
// both, one component subscribing to both (BackgroundToast.tsx).
const toastListeners = new Set<(message: Omit<ToastMessage, "nonce">) => void>();

/** Subscribe to run outcomes — see BackgroundToast, the only consumer. */
export function onRegionDownloadToast(
  listener: (message: Omit<ToastMessage, "nonce">) => void,
): () => void {
  toastListeners.add(listener);
  return () => toastListeners.delete(listener);
}

/** Groups already announced, so a later publish doesn't repeat the toast. */
const announcedGroups = new Set<string>();

// Driven off `publish` rather than off the pump's tail: a group also settles
// when the last live job is paused by the user or halted by the provider, and
// those never pass through the pump's completion path.
function announceSettledGroups(): void {
  for (const group of groupRegionJobs(jobs)) {
    if (!group.settled) {
      // Live again (resumed, or a second run reusing the id): eligible to
      // announce once more.
      announcedGroups.delete(group.groupId);
      continue;
    }
    if (announcedGroups.has(group.groupId)) continue;
    announcedGroups.add(group.groupId);
    const message = {
      text: regionGroupToastText(group),
      tone: group.unfinished > 0 ? ("error" as const) : ("info" as const),
    };
    for (const listener of toastListeners) listener(message);
  }
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
  pump();
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
  subscribeReconnect(() => resumeJobsPausedBy("connectivity"));
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
  pump();
}

/**
 * Run queued jobs one after another. Re-entrant-safe: `pumping` is the single
 * active slot, and every path that could make a job runnable calls back in.
 */
function pump(): void {
  if (pumping) return;
  // MOT-007: everything past drain()'s own per-job try/catch — patch →
  // publish → listener callbacks (toasts included), the dynamic
  // registryDb import, renameArtifactGroup — runs unguarded. One throwing
  // subscriber turned the whole drain into an unhandled rejection and
  // stranded every other queued job until the next enqueue.
  const run = drain()
    .catch(console.error)
    .finally(() => {
      if (pumping === run) pumping = null;
    });
  pumping = run;
}

async function drain(): Promise<void> {
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

    // The spec was snapshotted before the run; the user may have renamed the
    // area while it was in flight (the naming prompt is deliberately non-
    // blocking). Re-apply whatever the name is NOW to the row just written.
    if (outcome.status === "ready") {
      const current = jobs.find((job) => job.spec.id === next.spec.id);
      const label = current?.spec.groupLabel ?? next.spec.groupLabel;
      if (label !== next.spec.groupLabel) {
        const registry = await import("./registryDb");
        await registry.renameArtifactGroup(next.spec.groupId, label);
      }
    }

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
            : { kind: "failed", code: outcome.code, detail: outcome.detail },
    });
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
      {
        id: spec.id,
        label: spec.label,
        groupId: spec.groupId,
        groupLabel: spec.groupLabel,
        bbox: spec.bbox,
        zMax: spec.zMax,
      },
      (progress) =>
        onProgress({
          tilesDone: 0,
          tilesTotal: 0,
          tilesGap: 0,
          tilesFailed: 0,
          bytesDone: progress.bytesDone,
          bytesTotal: progress.bytesTotal,
        }),
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
    // 4xx is the endpoint rejecting THIS AREA (outside the archive extract, or
    // over the clip cap — see validateRegionClipRequest). Its own message is
    // static and coordinate-free, but the copy the user reads is still ours
    // (DESIGN.md §11), and what it has to say is "reframe", not "retry".
    if (err instanceof ApiError && err.status >= 400) {
      return { status: "failed", code: "region-rejected" };
    }
    return { status: "failed", code: "unknown", detail: failureDetail(err) };
  }
}

/**
 * Name the area a run is downloading, while it downloads.
 *
 * The prompt goes up the moment the jobs are enqueued (the download must not
 * wait on typing), so the name can arrive before, during or after any given
 * job finishes. Both halves are covered: queued/running jobs carry the new
 * label into the artifact they write, and rows already written are updated in
 * place.
 */
export function setRegionGroupLabel(groupId: string, groupLabel: string): void {
  jobs = jobs.map((job) =>
    job.spec.groupId === groupId
      ? { ...job, spec: { ...job.spec, groupLabel } }
      : job,
  );
  publish();
  void import("./registryDb").then((registry) =>
    registry.renameArtifactGroup(groupId, groupLabel),
  );
}

/** Stop for now; the partial MBTiles keeps every tile already fetched. */
export function pauseRegionDownload(id: string): void {
  const token = tokens.get(id);
  if (token) token.stop = "pause";
  else patch(id, { state: { kind: "paused", reason: "user" } });
}

export function resumeRegionDownload(id: string): void {
  patch(id, { state: { kind: "queued" } });
  pump();
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

/**
 * Stop EVERYTHING and forget it — the account-transition contract, called by
 * `wipeAllLocalData` before it deletes a byte.
 *
 * Two things had to be true and neither was. (1) A run still going when the
 * wipe deleted `offline/regions/` re-created the directory and re-inserted its
 * `map_artifact` row — the departing user's bounding box, re-materialised into
 * the next user's install after the wipe reported success. So this awaits the
 * pump's drain rather than just asking it to stop. (2) `jobs` holds user-typed
 * region LABELS and bboxes at module scope, which outlive a sign-out for the
 * life of the JS context and rendered on the next account's progress surfaces.
 *
 * Resolves when the worker has actually stopped; the caller decides how long
 * it is prepared to wait (a paused-but-resumable job stops immediately, a
 * running one at its next tile).
 */
export async function cancelAllRegionDownloads(): Promise<void> {
  for (const token of tokens.values()) token.stop = "cancel";
  jobs = [];
  publish();
  await pumping;
  jobs = [];
  tokens.clear();
  // Module state must not outlive a sign-out (see the note above).
  announcedGroups.clear();
  publish();
}

/**
 * Clean up after a job cancelled before it ever ran. Both task kinds use the
 * job's own id for their file now, so this covers either: the tile pyramid's
 * `<id>.mbtiles` (plus WAL sidecars) and the clip's `<id>.pmtiles` with its
 * registry row, if one somehow landed. Both are no-ops when nothing is there.
 */
async function deleteAbandonedRegion(id: string): Promise<void> {
  const { deleteRegionFile } = await import("./regionMbtiles");
  const { deleteDownloadedArtifact } = await import("./regionDownloads");
  await deleteRegionFile(id);
  await deleteDownloadedArtifact(id);
}

export type { OfflineBasemapId };
