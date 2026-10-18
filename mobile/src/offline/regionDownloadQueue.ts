// The one place a region download's live state lives, for every screen that
// shows it: the Saved tab's progress cards, the map's "Downloading maps"
// banner, and the layers sheet's offline section.
//
// A module store rather than a context (same choice as `placeMapFilter`): a
// download outlives the screen that started it — the whole point of the banner
// on the map is that you can leave the download screen and keep walking around
// the map while tiles land.
//
// ONE AT A TIME. Selecting three basemaps enqueues three jobs and they
// run in sequence, because the politeness envelope is per-provider and running
// them in parallel would triple the request rate at the same host.
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { type OfflineBasemapId } from "@logjam/shared";

import NetInfo from "@react-native-community/netinfo";
import type { ToastMessage } from "../ui";
import LogjamDownloadService from "../../modules/logjam-download-service/src/LogjamDownloadServiceModule";
import {
  BACKGROUND_WAIT_MS,
  MAX_BACKGROUND_RESUMES,
  downloadNotice,
  groupRegionJobs,
  mayResumeOnReconnect,
  regionGroupToastText,
} from "./regionDownloadGroups";
import { connectionWorthResuming } from "./networkPolicy";
import {
  runRegionDownload,
  type PausedReason,
  type RegionCancelToken,
  type RegionFailureCode,
  type RegionJobProgress,
  type RegionJobSpec,
  type RegionRunOutcome,
} from "./regionTileDownload";
import type { RegionClipSpec } from "./regionDownloads";

/**
 * Two task kinds, one queue: the SIX rasters are fetched tile by tile straight
 * from the provider, while a clip of one of Logjam's own archives (the vector
 * basemap, a DEM, the contours) is cut by byte range from the CDN
 * (`regionDownloads.ts`). The user is choosing between maps, not between
 * transports, so they share the screen, the queue and this progress shape.
 */
export type RegionTaskSpec =
  | ({ taskKind: "tile-pyramid" } & RegionJobSpec)
  | RegionClipTask;

type RegionClipTask = { taskKind: "clip" } & RegionClipSpec;

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
  syncDownloadService();
}

// --- Foreground service ---------------------------------------------------
// Android freezes the process about 10 s after Logjam GPS leaves the screen
// unless a foreground service holds it, so the queue keeps one up for exactly
// as long as `downloadNotice` says there is something to stay up for. A build
// without the module (iOS, tests) just downloads while the process runs.
let backgroundResumesLeft = MAX_BACKGROUND_RESUMES;
let waitTimer: ReturnType<typeof setTimeout> | null = null;
let shown: { text: string; at: number } | null = null;
/** Also what re-arms the service's CPU lock, so it must beat its 3-minute timeout. */
const NOTICE_REFRESH_MS = 30_000;

function syncDownloadService(): void {
  if (!LogjamDownloadService) return;
  const notice = downloadNotice(jobs, backgroundResumesLeft);
  if (waitTimer && !notice?.waiting) {
    clearTimeout(waitTimer);
    waitTimer = null;
  }
  if (!notice) {
    if (shown) LogjamDownloadService.stop();
    shown = null;
    return;
  }
  // Waiting is bounded in time as well as in restarts: after this the service
  // goes down and the job stays paused until the user is back.
  if (notice.waiting && !waitTimer) {
    waitTimer = setTimeout(() => {
      waitTimer = null;
      backgroundResumesLeft = 0;
      syncDownloadService();
    }, BACKGROUND_WAIT_MS);
  }
  const now = Date.now();
  if (
    shown?.text === notice.text &&
    (notice.waiting || now - shown.at < NOTICE_REFRESH_MS)
  ) {
    return;
  }
  shown = { text: notice.text, at: now };
  LogjamDownloadService.show("Downloading maps", notice.text, notice.percent);
}

// --- Finish toast ---------------------------------------------------------
// A region download is background work now (the progress SCREEN is gone; Saved
// shows a card), so it announces itself the way a GeoPDF import does — one
// toast at the app shell, wherever the user has got to. Mirrors
// `onGeoPdfImportToast` in geopdf/importRunner.ts deliberately: one shape for
// both, one component subscribing to both (BackgroundToast.tsx).
const toastListeners = new Set<
  (message: Omit<ToastMessage, "nonce">) => void
>();

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
function resumeJobsPausedBy(
  reason: Extract<PausedReason, "background" | "connectivity">,
  only: (job: RegionJob) => boolean = () => true,
): boolean {
  let changed = false;
  jobs = jobs.map((job) => {
    if (job.state.kind !== "paused" || job.state.reason !== reason) return job;
    if (!only(job)) return job;
    changed = true;
    return { ...job, state: { kind: "queued" } as RegionJobState };
  });
  if (!changed) return false;
  publish();
  pump();
  return true;
}

// Installed on first enqueue rather than at import: a user who never downloads
// a region should not be paying for two global subscriptions.
let watchersInstalled = false;
function installAutoResumeWatchers(): void {
  if (watchersInstalled) return;
  watchersInstalled = true;
  AppState.addEventListener("change", (state) => {
    // A fresh allowance each time the app changes sides: it counts restarts
    // within ONE stretch behind another app.
    backgroundResumesLeft = MAX_BACKGROUND_RESUMES;
    // And a fresh wait: one that began with Logjam GPS in front would
    // otherwise run out early behind another app
    // (regionDownloadQueue.test.ts).
    if (waitTimer) clearTimeout(waitTimer);
    waitTimer = null;
    if (state !== "active") {
      syncDownloadService();
      return;
    }
    resumeJobsPausedBy("background");
    // Also the jobs that ran out of background restarts: the reconnect edge
    // they were waiting for has already come and gone.
    resumeJobsPausedBy("connectivity");
  });
  // Cancel on the notification, which is the only control left once Logjam GPS
  // is off the screen. It ends what the notification stands for: the work in
  // hand and the jobs waiting for a connection. A job the user paused, or one
  // that failed, is not what "Downloading maps" was showing.
  LogjamDownloadService?.addListener("onCancel", () => {
    for (const job of jobs) {
      const { state } = job;
      if (
        state.kind === "queued" ||
        state.kind === "downloading" ||
        (state.kind === "paused" && state.reason === "connectivity")
      ) {
        cancelRegionDownload(job.spec.id);
      }
    }
  });
  // Every connectivity change, not just offline → online: Wi-Fi arriving
  // while cellular is already up is what a Wi-Fi-only job is waiting for.
  NetInfo.addEventListener((state) => {
    if (!mayResumeOnReconnect(AppState.currentState, backgroundResumesLeft)) {
      return;
    }
    if (
      resumeJobsPausedBy("connectivity", (job) =>
        connectionWorthResuming(state, job.spec.allowCellular),
      ) &&
      AppState.currentState !== "active"
    ) {
      backgroundResumesLeft -= 1;
    }
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
  pump();
}

/**
 * Run queued jobs one after another. Re-entrant-safe: `pumping` is the single
 * active slot, and every path that could make a job runnable calls back in.
 */
function pump(): void {
  if (pumping) return;
  // Everything past drain()'s own per-job try/catch — patch →
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
    // A runner that throws ends its job as failed rather than leaving it
    // "downloading" for good, its token held and the jobs behind it stalled.
    // Guard: regionDownloadQueue.test.ts ("a runner that throws").
    const outcome: RegionRunOutcome = await (next.spec.taskKind ===
    "tile-pyramid"
      ? runRegionDownload(next.spec, report, token)
      : import("./regionDownloads").then((m) =>
          m.runRegionClip(next.spec as RegionClipTask, report, token),
        )
    ).catch((err: unknown) => {
      console.error(err);
      return { status: "failed", code: "unknown" } as const;
    });
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
  void import("./registryDb")
    .then((registry) => registry.renameArtifactGroup(groupId, groupLabel))
    .catch((err) => console.error(err));
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
  deleteAbandonedRegion(id).catch((err) => console.error(err));
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
  backgroundResumesLeft = MAX_BACKGROUND_RESUMES;
  publish();
}

/**
 * Clean up after a job cancelled while it was not running. Both task kinds
 * use the job's own id for their file, so this covers either: the tile
 * pyramid's `<id>.mbtiles` (plus WAL sidecars) and the clip's `<id>.pmtiles`,
 * partial or with its registry row. All are no-ops when nothing is there.
 */
async function deleteAbandonedRegion(id: string): Promise<void> {
  const { deleteRegionFile } = await import("./regionMbtiles");
  const { deleteClipFile, deleteDownloadedArtifact } = await import(
    "./regionDownloads"
  );
  await deleteRegionFile(id);
  await deleteClipFile(id);
  await deleteDownloadedArtifact(id);
}

export type { OfflineBasemapId };
