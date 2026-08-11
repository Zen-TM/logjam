// "Auto-download finished LiDAR topos" — the same feature as the GeoPDF one
// (geopdf/autoDownload.ts), over the overlays a topo job renders.
//
// WHEN IT CHECKS: on app start, on return to the foreground, and when a
// connection is regained — the three moments the sync engine uses, and never a
// background timer, because battery is a field resource.
//
// WHAT IT TAKES: every layer of every completed job the account has, once each.
// That is deliberately the same rule as the GeoPDF feature rather than
// something cleverer (only enabled layers, say): a layer you have not switched
// on yet is exactly the one you will want the evening before a trip, and the
// dedupe below means the cost is paid once per layer, ever.
//
// WHAT STOPS IT COSTING A FORTUNE: the connection policy (`networkPolicy.ts`),
// which defaults to Wi-Fi only for this job, and is re-checked between layers
// because the user can walk out of range mid-run and the next file is the
// expensive one.
//
// DEDUPE HAS TWO HALVES, and both are needed: the artifact registry says what
// this phone already HAS (so a layer saved by hand is never fetched again), and
// a handled-key marker says what it has already TRIED (so a layer that fails to
// download is attempted once rather than on every foreground for the life of
// the install). The Saved tab can still fetch it by hand.
//
// PRIVACY: job ids and layer names. The bundles land in the same app-private,
// backup-excluded store as every other artifact, behind the app lock.
import { AppState } from "react-native";

import { apiFetch } from "../api/apiFetch";
import { readPref, writePref } from "../prefsDb";
import { subscribeReconnect } from "../map/connectivity";
import type { CompletedOverlaysResponse } from "../map/topoOverlays";
import { canRunNow } from "./networkPolicy";
import { downloadTopoOverlay } from "./overlayDownloads";
import { listArtifacts } from "./registryDb";

const ENABLED_PREF_KEY = "autoDownloadTopoOverlays";
const HANDLED_PREF_KEY = "autoDownloadedOverlayKeys";

/**
 * How many handled keys to remember. A key is one job/layer pair, so this is
 * well past any plausible account, and bounded so the row can't grow forever.
 * ponytail: a flat JSON array in prefsDb, the same shape (and the same ceiling)
 * as the GeoPDF marker next door.
 */
const HANDLED_CAP = 500;

/** Minimum gap between automatic firings, mirroring the sync engine's. */
const MIN_INTERVAL_MS = 10_000;

let lastRunAt = 0;
let running = false;

/**
 * Defaults OFF, where the GeoPDF switch defaults on.
 *
 * A GeoPDF is one file the user asked to have made; a topo job's overlays are
 * several layers each, and a phone that quietly fills up with contour, slope
 * and vegetation archives for jobs run months ago is not a favour. Opt in.
 */
export function isTopoAutoDownloadEnabled(): boolean {
  return readPref(ENABLED_PREF_KEY) === "on";
}

/** False when the device refused to store it, so the caller can say so. */
export function setTopoAutoDownloadEnabled(enabled: boolean): boolean {
  return writePref(ENABLED_PREF_KEY, enabled ? "on" : "off");
}

function readHandled(): string[] {
  const raw = readPref(HANDLED_PREF_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    // A corrupted row means "nothing handled" — it costs one re-download, where
    // throwing would break the feature permanently.
    return [];
  }
}

function markHandled(key: string): void {
  const handled = readHandled();
  if (handled.includes(key)) return;
  writePref(HANDLED_PREF_KEY, JSON.stringify([...handled, key].slice(-HANDLED_CAP)));
}

/** Test seam / sign-out: forget which overlays this device has taken. */
export function resetAutoDownloadedOverlays(): void {
  writePref(HANDLED_PREF_KEY, "[]");
}

/**
 * One pass. Best-effort throughout: this runs unasked, so nothing it fails at
 * is worth a message — the Saved tab's own Save action is the surface that
 * reports.
 */
export async function runTopoAutoDownload(): Promise<void> {
  if (running) return;
  running = true;
  try {
    if (!isTopoAutoDownloadEnabled()) return;
    if (!(await canRunNow("topoDownload"))) return;

    const response = await apiFetch<CompletedOverlaysResponse>(
      "/topo-jobs/completed-overlays",
    );
    // What this phone already holds, by the same `jobId/layer` key the
    // downloader writes (overlayDownloads.ts) and the resolver reads.
    const onDevice = new Set(
      (await listArtifacts())
        .filter((artifact) => artifact.kind === "topo-overlay")
        .map((artifact) => artifact.logicalKey),
    );
    const handled = new Set(readHandled());

    for (const job of response.jobs) {
      for (const layer of job.layers) {
        const key = `${job.jobId}/${layer.name}`;
        if (onDevice.has(key) || handled.has(key)) continue;
        // A presigned URL the server didn't give us is nothing to download.
        if (!layer.pmtilesUrl) continue;
        if (!(await canRunNow("topoDownload"))) return;
        // Marked BEFORE the attempt: see the header note on the two halves.
        markHandled(key);
        try {
          await downloadTopoOverlay({
            jobId: job.jobId,
            layer: layer.name,
            format: layer.format,
            pmtilesUrl: layer.pmtilesUrl,
          });
        } catch (err) {
          console.error(err);
        }
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
  void runTopoAutoDownload();
}

/**
 * Wire the triggers. Call once from the authenticated shell; returns a cleanup
 * for sign-out.
 */
export function registerTopoAutoDownload(): () => void {
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
