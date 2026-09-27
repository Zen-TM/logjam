# 0017. Inbox read state and deletion are outbox ops; a refetch replays the queue

- **Date:** 2026-08-30
- **Status:** Accepted
- **Supersedes:** —

## Context

The mobile inbox is refetch-and-cache rather than delta-synced. Its edits used
to be REST calls, so the inbox could not be edited with no signal.

## Decision

**A notification's read bit and its deletion are OUTBOX ops, not REST calls**
(`notification: ["markRead", "markUnread", "delete"]` in `shared/src/sync.ts`),
so the inbox is editable with no signal like everything else. Two consequences.
The read bit is no longer monotonic, so `planOutboxEnqueue` SUPERSEDES a queued
read-state op instead of deduping it (a read→unread→read fiddle must leave one
op, the last); guard: `shared/src/syncClient.test.ts`. And the server's
`applyNotificationOp` stays owner-scoped in the `where`, so a foreign id is
indistinguishable from a purged one — the same anti-oracle rule the REST routes
follow.

**A refetch must REPLAY the outbox over the server's answer**
(`pendingInboxOps` in `sync/notificationsCache.ts`). `GET /notifications` is the
authority on `read` and on what exists, so a fetch that ignored the queue undid
every pending change as it landed: a row marked read went back to saying New
(the race `patchCachedPayload` was invented for), and a row deleted offline came
back from the dead on the next pull-to-refresh. Every cache write also fires
`notifyMirrorChanged` — the patches used to and the fetch did not, which left
the tab badge on the old number after a refresh.

**The inbox is a WINDOW: `GET /notifications` caps at 500 and reports the true
total.** Nothing prunes notifications server-side, so a long-lived account will
pass it; past the cap the oldest are invisible to every client. The list says so
in a footer line (DESIGN.md), which is the honest minimum. Note
`PATCH /notifications/read-all` marks EVERYTHING read, including rows past the
cap; bulk delete only ever touches rows the user can see.

**A row's border WIDTH must not change with its state, on any card in a list.**
Marking a notification read flipped `borderLeftWidth` 3 → 1 and the row rendered
as an EMPTY CARD — frame and background, no icon, no text — until something
forced a redraw. Fabric on Android re-derives the clip bounds of a rounded
`overflow: hidden` card from its border box and drops the children when it
does. Every notification row now declares the same 3pt left edge and only its
COLOUR says unread (`rowEdgeAccent` / `rowEdgeIdle`). Colour changes are free;
widths are not.

## Consequences

- **Positive:** the inbox is editable offline.
- **Negative:** past 500 notifications the oldest are invisible to every client.
- **Neutral:** Not recorded.

## Alternatives considered

- Retention: the real fix for the 500 cap is retention (a reaper dropping read
  notifications older than N days) and is an operator decision, not a code one.
  Not built.
