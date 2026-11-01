// The words of the sign-out confirmation, from what this phone holds that is
// not in the account (`wipedStores.ts` says what that can be).
//
// One confirm that says what goes and what stays, and counts it
// (`shared/DESIGN.md` §9). A line appears only for a kind that has something
// in it, and with nothing to lose there is no confirm at all.
//
// PRIVACY: counts and a total size, never a name, a coordinate or a bounding
// box: an alert is the screen most likely to be screenshotted.
import {
  formatBytes,
  pluralCount,
  SIGN_OUT_EVERYWHERE_NOTE,
} from "@logjam/shared";

import type { Loss } from "./wipedStores";

/**
 * What a screen calls to sign out. `accountDeleted` is the one case that does
 * not ask: the account is gone, so nothing is waiting to sync and "your places
 * stay in your account" would be untrue.
 */
export type SignOutHandler = (options?: {
  accountDeleted?: boolean;
  /** Also end the account's sessions on every other phone and browser. */
  everywhere?: boolean;
}) => void;

/** What the wipe would take, by kind. A zero is a kind with nothing in it. */
export type SignOutCounts = Record<Loss, number> & {
  /** What the saved map regions take on disk. */
  regionBytes: number;
};

export type SignOutConfirm = {
  title: string;
  /** Introduces the lines. */
  intro: string;
  lines: string[];
  /** What stays. */
  keeps: string;
  /** Also ends the account's other sessions, so it asks even with no `lines`. */
  everywhere: boolean;
  /** Offer "Sync first": there is unsynced work and the phone can reach Logjam. */
  canSyncFirst: boolean;
};

const LOST = (count: number) =>
  count === 1 ? "It is lost for good." : "These are lost for good.";

/**
 * Each kind's line, for its count. In the order they are shown: what cannot be
 * got back at all, then what can only come back from a file, then what can be
 * downloaded again.
 */
const LINES: { loss: Loss; text: (n: number, c: SignOutCounts) => string }[] = [
  {
    loss: "unsynced",
    text: (n) => `${pluralCount(n, "change")} not yet synced. ${LOST(n)}`,
  },
  {
    loss: "unresolved",
    text: (n) =>
      `${pluralCount(n, "edit")} left to resolve in Sync issues. ${LOST(n)}`,
  },
  {
    loss: "recordings",
    text: (n) =>
      `${pluralCount(n, "recorded track")} not yet backed up. ${LOST(n)}`,
  },
  {
    loss: "routeDraft",
    text: () => "A route you were drawing. It is lost for good.",
  },
  {
    loss: "regions",
    text: (n, c) =>
      `${pluralCount(n, "saved map region")} (${formatBytes(c.regionBytes)})`,
  },
  {
    loss: "geoPdfs",
    text: (n) =>
      `${pluralCount(n, "imported GeoPDF")}. An imported file can only come back from the original file.`,
  },
  { loss: "topos", text: (n) => pluralCount(n, "sharpened area") },
];

/**
 * The confirmation for these counts, or null when there is nothing to lose and
 * so nothing to ask. `online` is whether Logjam can be reached right now.
 */
export function signOutConfirm(
  counts: SignOutCounts,
  online: boolean,
  everywhere = false,
): SignOutConfirm | null {
  const lines = LINES.filter(({ loss }) => counts[loss] > 0).map(
    ({ text, loss }) => text(counts[loss], counts),
  );
  if (lines.length === 0 && !everywhere) return null;
  return {
    title: everywhere ? "Sign out everywhere?" : "Sign out of Logjam GPS?",
    everywhere,
    intro: "This removes from this phone:",
    lines,
    keeps: "Your synced places and trips stay in your account.",
    canSyncFirst: online && counts.unsynced > 0,
  };
}

/** The confirmation as one alert body. */
export function signOutConfirmBody(confirm: SignOutConfirm): string {
  const loss =
    confirm.lines.length === 0
      ? []
      : [confirm.intro, ...confirm.lines.map((line) => `• ${line}`), ""];
  return [
    ...(confirm.everywhere ? [SIGN_OUT_EVERYWHERE_NOTE, ""] : []),
    ...loss,
    confirm.keeps,
  ].join("\n");
}
