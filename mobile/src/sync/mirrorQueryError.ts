// Which sync failure a mirror-backed screen is allowed to put in front of its
// content. Pure and on its own so the rule has a test that needs no React and
// no SQLite.
import type { SyncStatus } from "./syncEngine";

/**
 * What a mirror-backed screen shows instead of its content, and the rule is
 * narrower than "the last cycle failed".
 *
 * `unreachable` — offline, a 5xx — is not an error a screen should report. Offline is a normal state for this app
 * (DESIGN.md §10), the status persists between attempts so it is true for as
 * long as the user has no signal, and the message ("Couldn't sync. Will
 * retry.") offers nothing to do about it. It was a permanent full-screen
 * `ErrorState` in front of Canyons and Logs on a first run with no signal —
 * i.e. the app refusing to open in exactly the place it is meant to work. The
 * honest, non-alarming report of that condition already exists in two places
 * that are about sync: `SyncStatusPills` and the More tab's sync health line.
 *
 * `applyFailed` stays, because it is the opposite: the server answered, THIS
 * APP couldn't apply it, retrying changes nothing, and the user is meant to
 * reach Sync issues. A never-synced screen behind that failure has no content
 * to fall back to and must say so.
 *
 * `unsupported` (the server has no sync endpoints) is deliberately NOT here,
 * even though retrying is equally futile: there is nothing for the user to do
 * about it and no Sync issues entry to send them to, so a wall in front of
 * Canyons buys nothing an empty state doesn't already say. It is reported once,
 * in the sync health line, which is the place that is about sync.
 */
export function mirrorQueryError(
  neverSynced: boolean,
  syncStatus: SyncStatus,
): string | null {
  if (!neverSynced || syncStatus.state !== "error") return null;
  return syncStatus.errorKind === "applyFailed" ? syncStatus.errorMessage : null;
}

