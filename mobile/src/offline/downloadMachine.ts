// Pure state machine for region downloads (stage4a §5.2). The http-file task
// (Protomaps clips, Stage 4b job downloads) exercises a subset of the full
// diagram; the tile-pyramid states ride the same reducer when the SIXMaps
// engine lands (ToS-gated).
export type DownloadState =
  | "queued"
  | "enumerating"
  | "downloading"
  | "finalizing"
  | "verifying"
  | "ready"
  | "paused"
  | "failed"
  | "canceled";

export type PausedReason =
  | "user"
  | "connectivity"
  | "background"
  | "provider-backoff";

export type DownloadEvent =
  | { type: "start" }
  | { type: "enumerated" }
  | { type: "downloaded" }
  | { type: "finalized" }
  | { type: "verified" }
  | { type: "pause"; reason: PausedReason }
  | { type: "resume" }
  | { type: "fail"; code: string }
  | { type: "cancel" };

export interface DownloadStatus {
  state: DownloadState;
  pausedReason: PausedReason | null;
  errorCode: string | null;
}

const ACTIVE_STATES: DownloadState[] = [
  "queued",
  "enumerating",
  "downloading",
  "finalizing",
  "verifying",
  "paused",
];

export function isActive(state: DownloadState): boolean {
  return ACTIVE_STATES.includes(state);
}

/**
 * Transition function. Illegal events throw — a mis-sequenced engine is a
 * programming error, not a degradable state (fail loudly).
 */
export function transition(
  status: DownloadStatus,
  event: DownloadEvent,
): DownloadStatus {
  const { state } = status;

  // Universal transitions on active states.
  if (event.type === "cancel") {
    if (!isActive(state)) throw new Error(`cancel in terminal state ${state}`);
    return { state: "canceled", pausedReason: null, errorCode: null };
  }
  if (event.type === "fail") {
    if (!isActive(state)) throw new Error(`fail in terminal state ${state}`);
    return { state: "failed", pausedReason: null, errorCode: event.code };
  }
  if (event.type === "pause") {
    if (state !== "downloading" && state !== "queued") {
      throw new Error(`pause in state ${state}`);
    }
    return { state: "paused", pausedReason: event.reason, errorCode: null };
  }

  switch (state) {
    case "queued":
      if (event.type === "start") {
        return { state: "enumerating", pausedReason: null, errorCode: null };
      }
      break;
    case "enumerating":
      if (event.type === "enumerated") {
        return { state: "downloading", pausedReason: null, errorCode: null };
      }
      break;
    case "downloading":
      if (event.type === "downloaded") {
        return { state: "finalizing", pausedReason: null, errorCode: null };
      }
      break;
    case "finalizing":
      if (event.type === "finalized") {
        return { state: "verifying", pausedReason: null, errorCode: null };
      }
      break;
    case "verifying":
      if (event.type === "verified") {
        return { state: "ready", pausedReason: null, errorCode: null };
      }
      break;
    case "paused":
      if (event.type === "resume") {
        return { state: "downloading", pausedReason: null, errorCode: null };
      }
      break;
  }
  throw new Error(`Illegal event ${event.type} in state ${state}`);
}

export const initialStatus: DownloadStatus = {
  state: "queued",
  pausedReason: null,
  errorCode: null,
};

/** Cold-start recovery (§5.2): any mid-flight state parks as paused(background). */
export function recoverOnColdStart(status: DownloadStatus): DownloadStatus {
  if (
    status.state === "enumerating" ||
    status.state === "downloading" ||
    status.state === "finalizing" ||
    status.state === "verifying"
  ) {
    return { state: "paused", pausedReason: "background", errorCode: null };
  }
  return status;
}
