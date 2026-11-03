// What a notification lets you DO from the inbox row, as data.
//
// Two kinds of notification are a QUESTION rather than a report — a friend
// request and a file a friend sent. Both are one accept/decline pair, so both
// are the same widget, and this module is the one place that says which pair a
// notification carries.
//
// Shared by both inboxes, so Logjam GPS and Logjam Web offer the same answers
// in the same words. Where a word names one client's surface ("find it in
// Saved"), the other client says its own and notes why at the call site.
//
// The COPY lives here, not in the screen (DESIGN.md — an entity's confirm
// sentence is written once, next to the thing that knows the entity). It is
// per-instance for a file send: only this module has the filename and the
// sender to put in the sentence.
//
// PRIVACY: `filename` is user text and routinely names a place. It reaches the
// label and the confirm body because the recipient cannot answer "keep this?"
// without knowing what it is. It is never logged, exactly as the sending side
// treats it.
import { ApiError } from "./apiErrors.js";
import type { TNotification } from "./apiTypes.js";
import { friendAcceptedMessage } from "./contracts/friends.js";

/** The two answers. `decline` is always the destructive one. */
export type NotificationActionKind = "accept" | "decline";

export type NotificationInlineAction = {
  kind: NotificationActionKind;
  label: string;
  /**
   * Non-null means raise this dialog first (DESIGN.md — destructive actions
   * confirm in a dialog, which is where the explanation goes).
   *
   * A friend-request decline never carries one (the requester can ask again);
   * a file decline always does, because side by side in a list row there is no
   * overflow sheet left to keep "no" a step away from "yes".
   */
  confirm: { title: string; body: string; confirmLabel: string } | null;
  /**
   * The sentence shown when this action fails. Ours, not the error's
   * (DESIGN.md) — `messageFromError` falls back to it.
   */
  failure: string;
  /**
   * The sentence confirming it worked. Every action reports (DESIGN.md
   * §6: toasts, not banners, for the outcome of an action), rather than
   * staying silent and reading as "the button did nothing".
   */
  success: string;
};

export type NotificationActions = {
  /** Which pair of API calls to run — the screen's discriminant. */
  type: "friend_request" | "file_sent";
  /** The one id those calls need: a friendshipId, or a fileSendId. */
  targetId: string;
  /** A trailing `StatusPill` label for a row that has a state, else null. */
  pill: string | null;
  /**
   * Who sent the file, for the provenance an accepted copy carries in Saved
   * ("Copy · from bob"). Null on a friend request, and on a send whose sender
   * no longer resolves.
   */
  sender: string | null;
  actions: NotificationInlineAction[];
};

function str(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * A friend request's two answers, for every surface that draws them: the
 * Inbox row and both Friends lists say the same words. Guard:
 * notificationActions.test.ts.
 */
export function friendRequestAnswers(
  username: string,
): NotificationInlineAction[] {
  return [
    {
      kind: "accept",
      label: "Accept",
      confirm: null,
      failure: "Couldn't accept that request.",
      success: friendAcceptedMessage(username),
    },
    {
      kind: "decline",
      label: "Decline",
      failure: "Couldn't decline that request.",
      success: "Request declined.",
      // Never asks, on any surface: the requester is not told and can ask
      // again, so nothing is lost. Guard: notificationActions.test.ts.
      confirm: null,
    },
  ];
}

/**
 * The actions this notification offers, or null for the reporting kinds (a
 * finished topo, an accepted request) which have nothing to answer.
 *
 * `failed`: the caller's own download of this already-accepted send failed, so
 * the row offers "Try again" instead of nothing.
 *
 * Returns null when the id the calls need is missing, rather than rendering
 * buttons that cannot be wired to anything.
 */
export function notificationActions(
  n: TNotification,
  { failed = false }: { failed?: boolean } = {},
): NotificationActions | null {
  const payload = n.payload;
  if (n.type === "friend_request") {
    const friendshipId = str(payload, "friendshipId");
    if (!friendshipId) return null;
    const username = str(payload, "requesterUsername") ?? "them";
    return {
      type: "friend_request",
      targetId: friendshipId,
      pill: null,
      sender: null,
      actions: friendRequestAnswers(username),
    };
  }

  if (n.type === "file_sent") {
    const fileSendId = str(payload, "fileSendId");
    if (!fileSendId) return null;
    const filename = str(payload, "filename") ?? "this file";
    const sender = str(payload, "sentByUsername");
    // A lapsed send offers NOTHING. The bytes are gone or going, so every
    // button would fail; the row explains itself through the label's warning
    // line instead (`notificationLabel.ts`). Returning null here is
    // what holds the "never offer a button the endpoint would refuse"
    // invariant now that the notification query deliberately keeps expired
    // sends the inbox endpoint drops.
    if (payload.fileSendStatus === "expired") return null;
    // `accepted` means the download URL was ISSUED, not that the bytes landed,
    // so accept stays on offer as a retry and there is nothing left to turn
    // down.
    const accepted = payload.fileSendStatus === "accepted";
    if (accepted) {
      return {
        type: "file_sent",
        targetId: fileSendId,
        pill: "Saved",
        sender,
        // Nothing to press once it worked: a second Download is the loudest
        // control on a finished row. Only a download that FAILED here offers
        // another go.
        actions: failed
          ? [
              {
                kind: "accept",
                label: "Try again",
                confirm: null,
                failure: "Couldn't save that file.",
                success: "Saved — find it in Saved.",
              },
            ]
          : [],
      };
    }
    return {
      type: "file_sent",
      targetId: fileSendId,
      pill: null,
      sender,
      actions: [
        {
          kind: "accept",
          label: "Save a copy",
          confirm: null,
          failure: "Couldn't save that file.",
          success: "Saved — find it in Saved.",
        },
        {
          kind: "decline",
          label: "Decline",
          failure: "Couldn't decline that.",
          success: "Declined.",
          confirm: {
            title: "Decline this file?",
            // Two facts and no more: what you lose, and the ONE way back. What
            // it does to the sender and the other recipients was true but not
            // the question being asked, and length is what stops a confirm
            // being read at all.
            //
            // "send it again", never "share it again": a share is the other
            // verb — live and revocable — and blurring them here is exactly the
            // confusion the two verbs exist to prevent (ADR 0016).
            body: `You won't get a copy of ${filename}. If you want it back, you'd have to ask ${sender ?? "them"} to send it again.`,
            confirmLabel: "Decline",
          },
        },
      ],
    };
  }

  return null;
}

/**
 * Is this failure "the question was already answered somewhere else"?
 *
 * A friend request accepted in the Friends screen, or a send declined in
 * Logjam Web, leaves a notification whose buttons are permanently dead rather
 * than retryable — so the row should clear like a successful action rather
 * than pop back with live buttons that will fail again.
 *   400 — no longer pending / already actioned.
 *   404 — the friendship or the recipient row is gone (declining DELETES it).
 *   409 — conflicting state.
 * Anything else (a network blip, a 5xx) is retryable and the row comes back.
 */
export function isResolvedElsewhereError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  return err.status === 400 || err.status === 404 || err.status === 409;
}
