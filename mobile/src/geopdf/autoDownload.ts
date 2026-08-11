// "Auto-download finished GeoPDFs" — the Settings switch, made real on this
// device.
//
// WHEN IT CHECKS: on app start, on return to the foreground, and when a
// connection is regained — the same three moments `registerSyncTriggers` uses,
// and never a background timer (battery is a field resource). Each firing lists
// the account's completed jobs and imports any this phone hasn't taken yet.
//
// WHY WI-FI BY DEFAULT: a generated GeoPDF is tens of megabytes, and rendering
// it to tiles is the expensive half. Doing that unasked over cellular — likely
// at a trailhead, on the plan the user needs for the drive home — is not a
// favour. It is a DEFAULT rather than a rule: `networkPolicy.ts` holds the
// user's answer for this job, and the Settings copy tracks it. The manual
// import on the Saved tab is always available on any connection.
//
// WHY A JOB-ID MARKER: the import pipeline dedupes by the SHA-256 of the file's
// bytes, which it can only know after downloading them. Without a cheap
// already-handled check, every foreground would re-download every GeoPDF just to
// discover it already had it. So each attempted job id is recorded on the device;
// that record is also what makes "auto-download" a one-shot per job rather than a
// retry loop on a job that fails to import.
//
// PRIVACY: job ids and titles. The bytes land in app-private storage like every
// other import, and arm the app lock the same way.
import { AppState } from "react-native";

import { fetchCurrentUser } from "../api/queries";
import { getGeoPdfJob, listGeoPdfJobs } from "../api/geoPdfJobs";
import { readPref, writePref } from "../prefsDb";
import { subscribeReconnect } from "../map/connectivity";
import { canRunNow } from "../offline/networkPolicy";
import {
  isAutoDownloadEnabled,
  seedAutoDownloadFromAccount,
} from "./autoDownloadPreference";
import { importGeoPdfFromUrl } from "./importPipeline";
import { runGeoPdfImport } from "./importRunner";

const HANDLED_PREF_KEY = "autoDownloadedGeoPdfJobIds";

/**
 * How many handled ids to remember. Well past any plausible number of GeoPDF jobs
 * on one account, and bounded so the row can't grow without limit.
 * ponytail: a flat JSON array in prefsDb; if this ever needs to be thousands, it
 * wants its own table with an index, not a longer string.
 */
const HANDLED_CAP = 500;

/** Minimum gap between automatic firings, mirroring the sync engine's. */
const MIN_INTERVAL_MS = 10_000;

let lastRunAt = 0;
let running = false;

function readHandled(): string[] {
  const raw = readPref(HANDLED_PREF_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    // A corrupted row means "nothing handled" — it costs one re-download, where
    // throwing would break the feature permanently.
    return [];
  }
}

function markHandled(jobId: string): void {
  const handled = readHandled();
  if (handled.includes(jobId)) return;
  const next = [...handled, jobId].slice(-HANDLED_CAP);
  writePref(HANDLED_PREF_KEY, JSON.stringify(next));
}

/** Test seam / sign-out: forget which jobs this device has taken. */
export function resetAutoDownloadedGeoPdfs(): void {
  writePref(HANDLED_PREF_KEY, "[]");
}

/**
 * One pass. Best-effort throughout: this runs unasked, so nothing it fails at is
 * worth a message — the Saved tab's manual import is the surface that reports.
 */
export async function runGeoPdfAutoDownload(): Promise<void> {
  if (running) return;
  running = true;
  try {
    if (!isAutoDownloadEnabled()) return;
    if (!(await canRunNow("geoPdfDownload"))) return;

    // The account's value only matters on a device that has never recorded one
    // of its own — after that this phone's switch is the answer, and the fetch
    // is here for the job list regardless.
    const user = await fetchCurrentUser();
    seedAutoDownloadFromAccount(user.uiPreferences?.autoDownloadGeoPdfs);
    if (!isAutoDownloadEnabled()) return;

    const jobs = await listGeoPdfJobs();
    const handled = new Set(readHandled());
    const pending = jobs.filter(
      (job) => job.status === "completed" && !handled.has(job.id),
    );

    for (const job of pending) {
      // Re-check between jobs: the user can walk out of Wi-Fi range mid-run, and
      // the next file is the expensive one.
      if (!(await canRunNow("geoPdfDownload"))) return;
      // Marked BEFORE the attempt, so a job whose import keeps failing is tried
      // once rather than on every foreground for the life of the install. The
      // Saved tab can still import it by hand.
      markHandled(job.id);
      try {
        // The listed URL may have expired while this ran; re-presign.
        const fresh = await getGeoPdfJob(job.id);
        if (!fresh.downloadUrl) continue;
        // Through the shared runner, so an unasked auto-import can't collide
        // with one the user started by hand — they would fight over the single
        // native rasteriser, and for the same file over the same directory.
        // The runner reports it like any other import: a card in Saved, a
        // toast when it lands.
        await runGeoPdfImport(fresh.title ?? "Logjam GeoPDF", (onProgress, token) =>
          importGeoPdfFromUrl(
            fresh.title ?? "Logjam GeoPDF",
            fresh.downloadUrl as string,
            onProgress,
            token,
          ),
        );
      } catch (err) {
        console.error(err);
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    running = false;
    lastRunAt = Date.now();
  }
}

function requestRun(): void {
  if (Date.now() - lastRunAt < MIN_INTERVAL_MS) return;
  lastRunAt = Date.now();
  void runGeoPdfAutoDownload();
}

/**
 * Wire the triggers. Call once from the authenticated shell; returns a cleanup
 * for sign-out.
 */
export function registerGeoPdfAutoDownload(): () => void {
  const appStateSub = AppState.addEventListener("change", (state) => {
    if (state === "active") requestRun();
  });

  // Edge-triggered: offline → online, not every NetInfo event.
  const netInfoUnsub = subscribeReconnect(requestRun);

  requestRun();

  return () => {
    appStateSub.remove();
    netInfoUnsub();
  };
}
