// "Save a copy and remove" — ONE user action, three server-side steps, and the
// order is the whole design.
//
// The recipient's remove is the one thing in this app that is irrecoverable by
// the person doing it: only the owner can share it back. Bundling a copy in
// front of it is what makes it safe, and that only holds if the copy is proven
// to have landed BEFORE anything is given up. So:
//
//   1. COPY every target. A copy that fails takes its remove down with it —
//      that row is reported and left exactly as it was. Never the other order,
//      and never "remove anyway".
//   2. PULL ONCE, and wait. The copies are server-minted rows that reach this
//      phone through delta sync; the removes apply their local cascade
//      IMMEDIATELY (removeShare.ts says why). Removing first would blank the
//      row on screen and bring the copy back seconds later as a different one,
//      which reads as the app losing the place and then finding it.
//   3. REMOVE the ones that copied. A remove that fails leaves the user with a
//      copy AND the share — untidy, recoverable, and reported as such, which is
//      the right way round for the failure to fall.
//
// NOT one endpoint, deliberately. Two calls with no transaction between them
// can fail in the middle; a single endpoint could too, and would have nowhere
// to say which half happened.
//
// PRIVACY: titles are user text that routinely name places. They are here
// because a report the user can act on has to name rows, and nothing here logs.
import { copySharedPlace } from "../api/friends";
import { copySharedRoute } from "../api/shares";
import { removeSharedEntity, removeSharedPlace } from "./removeShare";
import { requestSync } from "../sync/syncEngine";

/** A row the bundled verb may act on: copyable AND directly removable. */
export type CopyAndRemoveTarget = {
  entityType: "place" | "route";
  entityId: string;
  /** For the report — a user cannot retry "2 failed". */
  title: string;
};

export type CopyAndRemoveOutcome = {
  /** Both halves landed. */
  done: string[];
  /** The copy landed; the share is still there. Recoverable — say so. */
  copiedNotRemoved: string[];
  /** The copy failed, so nothing was removed. Nothing was lost. */
  failed: string[];
  /** Place-level media the copies did not get, summed. */
  mediaSkipped: number;
  /** At least one copy ran the account out of storage. */
  mediaOutOfSpace: boolean;
};

/** What one copy reported about the media it was asked to bring. */
export type CopiedMedia = { skipped: number; outOfSpace: boolean };

/**
 * Copy ONE shared row into this account, whichever kind it is.
 *
 * The one place the two endpoints are chosen between, so a plain "Save a copy"
 * and the bundled verb cannot come to disagree about what copying a route does.
 */
export async function copyShared(
  target: CopyAndRemoveTarget,
  options?: { copyMedia?: boolean },
): Promise<CopiedMedia> {
  if (target.entityType !== "place") {
    await copySharedRoute(target.entityId);
    return { skipped: 0, outOfSpace: false };
  }
  const result = await copySharedPlace(target.entityId, {
    ...(options?.copyMedia === undefined ? {} : { copyMedia: options.copyMedia }),
  });
  return {
    skipped: result.mediaSkipped ?? 0,
    outOfSpace: result.mediaOutOfSpace === true,
  };
}

export async function runCopyAndRemove(
  targets: CopyAndRemoveTarget[],
  options?: {
    /**
     * Whether place copies bring their photos and files. OMIT to let the
     * server use the account's remembered `copyPlaceMedia` — passing a value
     * means the user answered the question on this action.
     */
    copyMedia?: boolean;
  },
): Promise<CopyAndRemoveOutcome> {
  const outcome: CopyAndRemoveOutcome = {
    done: [],
    copiedNotRemoved: [],
    failed: [],
    mediaSkipped: 0,
    mediaOutOfSpace: false,
  };

  // ── 1. Copy ────────────────────────────────────────────────────────────
  const copied: CopyAndRemoveTarget[] = [];
  for (const target of targets) {
    try {
      const media = await copyShared(target, options);
      outcome.mediaSkipped += media.skipped;
      if (media.outOfSpace) outcome.mediaOutOfSpace = true;
      copied.push(target);
    } catch (err) {
      // Our own report, never the error's: it may carry the name.
      console.error(err);
      outcome.failed.push(target.title);
    }
  }

  if (copied.length === 0) return outcome;

  // ── 2. Let the copies land before anything is given up ─────────────────
  // A failed pull is not a reason to abandon the removes: the copies exist
  // server-side either way, and the next sync brings them. It only costs the
  // flicker this step is here to avoid.
  await requestSync().catch((err: unknown) => console.error(err));

  // ── 3. Remove ──────────────────────────────────────────────────────────
  for (const target of copied) {
    try {
      if (target.entityType === "place") {
        await removeSharedPlace(target.entityId);
      } else {
        await removeSharedEntity("route", target.entityId);
      }
      outcome.done.push(target.title);
    } catch (err) {
      console.error(err);
      outcome.copiedNotRemoved.push(target.title);
    }
  }

  return outcome;
}
