// Sharing a thing, and sending a copy of it: Logjam Web's `ShareDialog.tsx` and
// `SendCopyDialog.tsx`, Logjam GPS's `sharing/SharePanel.tsx` (both modes).
//
// A sentence about what a friend can or cannot do is a claim about the API
// (shared/DESIGN.md §12): each promise below is checked against the
// routes that grant it, and it is written once so no screen words it again.
import type { BulkShareItemType } from "../sharing.js";
import type { ScreenContract } from "./types.js";

export const SHARE_SHEET = {
  id: "share.sheet",
  question: "Who can see this?",
  sections: [
    // What the friends you pick will be able to do.
    { key: "promise" },
    // Shown once there are enough friends to need it.
    { key: "search" },
    { key: "sharedWith" },
    { key: "candidates" },
  ],
  copy: {
    sharedWith: "Shared with",
    shareWith: "Share with",
    searchFriends: "Search friends",
    allHaveAccess: "All your friends already have access.",
  },
} as const satisfies ScreenContract;

export const SEND_COPY = {
  id: "share.sendCopy",
  question: "Who gets a copy?",
  sections: [{ key: "promise" }, { key: "search" }, { key: "friends" }],
  copy: {
    searchFriends: "Search friends",
    promise: "They'll keep their own copy — you can't take it back.",
  },
} as const satisfies ScreenContract;

const STOP = "You can stop sharing anytime.";

/**
 * What can be shared, as the promise to a friend tells it apart: a
 * sharpened area is a LiDAR job (`topoJob`) that grants other things, and
 * `lidarJob` is either, for a surface that can't tell which.
 */
export type SharePromiseKind = BulkShareItemType | "sharpenedArea" | "lidarJob";

/**
 * What sharing a LiDAR job promises a friend, decided once for both
 * clients: a sharpened area grants other things than an older topo, and a
 * row with no `syncRole` is one a client rebuilt from what it saved, whose
 * kind it can't know (every row the API sends stamps one). contracts.test.ts.
 */
export function lidarJobSharePromise(
  job: { syncRole?: unknown; sharpened?: unknown } | undefined,
): SharePromiseKind {
  if (!job?.syncRole) return "lidarJob";
  return job.sharpened ? "sharpenedArea" : "topoJob";
}

/** What sharing one thing of this kind lets a friend do. */
export function sharePromise(kind: SharePromiseKind | "selection"): string {
  switch (kind) {
    case "place":
      return "Friends you pick can see this place and its notes and photos, and save a copy or export it. Your trips stay private. Unsharing doesn't remove copies they've already made.";
    case "route":
      return `Friends you pick can see this route on their map and export it, but can't change or delete it. ${STOP}`;
    case "topoJob":
      return `Friends you pick can see this LiDAR topo on their map and download or export it. Only you can delete it. ${STOP}`;
    // No surface offers a download or export of the area itself, only of its
    // vegetation layer (contracts.test.ts; the old Export is offered by kind,
    // frontend mapsModel.test.ts).
    case "sharpenedArea":
      return `Friends you pick get this sharpened area's heights and its vegetation layer if it has one, and see its terrain on Logjam Web's map. Only you can delete it. ${STOP}`;
    // What is true of both kinds, for a row whose kind isn't known.
    case "lidarJob":
      return `Friends you pick can see this on their map. Only you can delete it. ${STOP}`;
    case "selection":
      return `Friends you pick can view and export these, but can't change them. ${STOP}`;
  }
}

/** A friend picker with nobody to pick, and the way out of it. */
export function noFriendsMessage(purpose: "share" | "copy"): {
  title: string;
  body: string;
} {
  return {
    title: "No friends yet",
    body:
      purpose === "share"
        ? "Sharing is between friends. Add one in Friends, then come back."
        : "Copies go to friends. Add one in Friends, then come back.",
  };
}

export function noFriendsMatch(query: string): string {
  return `No friends match “${query.trim()}”.`;
}

/** The send button: one copy, or how many. */
export function sendCopyLabel(count: number): string {
  return count > 1 ? `Send ${count} copies` : "Send a copy";
}
