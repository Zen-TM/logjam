// WHAT THE PER-FRIEND SHARING SCREEN SAYS, and which verb each of its rows
// gets.
//
// Shared, because both clients draw this screen and the asymmetry below is the
// part that must not be re-derived: the payload carries routes and topos
// alongside places. Free of React Native imports so both clients can
// use it.
//
// THE TWO DIRECTIONS ARE NOT MIRROR IMAGES, and the asymmetry is the whole
// design:
//
//   "You share with Bob"  — mine. Sharing it with someone ELSE is free, and
//                           unsharing is recoverable (I can re-share it), so
//                           both verbs are offered in bulk.
//   "Bob shares with you" — Bob's. I can keep a COPY of a place (recoverable,
//                           and the reason to do it before the other verb), and
//                           I can drop my access — which only Bob can undo, so
//                           it is the destructive slot and it confirms.
//
// WHAT THE LIST CANNOT SHOW, stated on the screen because it decides whether a
// user believes the list: a shared place carries its place-level notes, its
// place-level media and its linked route, and a waypoint linked to it inherits
// visibility with no share row of its own. Those are not rows here. Unsharing
// the PLACE is what takes them back.
//
// PRIVACY: row titles are user text and routinely name places. They reach the
// screen and the confirms — a user cannot act on "3 things" without knowing
// which — and nothing here is logged.
import { formatDayMonth, localDay } from "./dateFormat.js";
import {
  SHARE_KIND_LABEL,
  shareRowTitle,
  isCopyableSharedRow,
  type BulkShareItem,
  type FriendShareRow,
} from "./sharing.js";
import { plural, t } from "./i18n.js";

/** Which direction the screen is showing. */
export type FriendShareDirection = "theySee" | "youSee";

/**
 * One row of the list, with every decision about it already made.
 *
 * `blockedReason` is the DESIGN.md rule that a verb a group cannot perform
 * is decided BEFORE the bar is drawn: a row that cannot be removed says why in
 * its own sheet, and the bar's tally stays true because it counted the same
 * predicate.
 */
export type FriendShareCard = {
  /** Stable across refetches: the pair is unique per direction. */
  key: string;
  row: FriendShareRow;
  title: string;
  /** "Place · shared 12 Aug" — kind first, because kind is what a mixed list needs. */
  subtitle: string;
  /** Copying it into my own account is possible. */
  copyable: boolean;
  /** Dropping my access would actually change what I can see. */
  removable: boolean;
  /**
   * Why Remove is withheld, in the words the sheet shows. Set only for a row
   * that is ALSO visible through a place this friend shared: revoking its
   * direct share leaves the place arm standing, so the row would vanish and
   * come straight back on the next pull.
   */
  blockedReason?: string;
};

/**
 * The row's identity, and the ONE spelling of it — the screen also builds these
 * keys from mirror rows (to find which received rows also ride a shared
 * place), so a second format there would silently match nothing.
 */
export function shareCardKey(row: {
  entityType: FriendShareRow["entityType"];
  entityId: string;
}): string {
  return `${row.entityType}:${row.entityId}`;
}

export function shareCardItem(card: FriendShareCard): BulkShareItem {
  return { entityType: card.row.entityType, entityId: card.row.entityId };
}

/** "12 Aug" — the same short day the Saved screen uses. */
function formatShareDay(iso: string): string {
  return formatDayMonth(localDay(new Date(iso)));
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Build the cards for one direction.
 *
 * The "this also rides a shared place" answer comes from the row (the server
 * sets `alsoViaPlace`), not from the local mirror: deriving it from the local
 * mirror is only valid once the linked row is pulled, otherwise a delta pull
 * could undo the removal.
 */
export function buildShareCards(
  rows: FriendShareRow[],
  options: {
    direction: FriendShareDirection;
    /** The friend's username, for the blocked-row explanation. */
    friendName: string;
  },
): FriendShareCard[] {
  return rows.map((row) => {
    const key = shareCardKey(row);
    const viaPlace =
      options.direction === "youSee" && row.alsoViaPlace === true;
    return {
      key,
      row,
      title: shareRowTitle(row),
      subtitle: t`${capitalise(SHARE_KIND_LABEL[row.entityType])} · shared ${formatShareDay(row.sharedAt)}`,
      copyable: options.direction === "youSee" && isCopyableSharedRow(row),
      removable: options.direction === "youSee" && !viaPlace,
      ...(viaPlace
        ? {
            blockedReason: t`This came with a place ${options.friendName} shared with you. Remove that place to stop seeing it.`,
          }
        : {}),
    };
  });
}

/**
 * The selection bar's count line.
 *
 * A TALLY PER VERB, because each verb acts on a SUBSET (DESIGN.md): the
 * bar's buttons are glyphs and cannot say "3 of your 5", so the line says it
 * before the press. The forward direction needs no tally — every row there can
 * be shared on and unshared — so it stays the plain count.
 */
export function shareSelectionCountLabel(
  cards: FriendShareCard[],
  direction: FriendShareDirection,
): string {
  const count = t`${cards.length} selected`;
  if (direction === "theySee") return count;
  const copyable = cards.filter((card) => card.copyable).length;
  const removable = cards.filter((card) => card.removable).length;
  const parts: string[] = [];
  // Only worth saying when it differs from the total — "5 selected · 5
  // removable" is noise, and noise is what stops the useful case being read.
  if (copyable > 0 && copyable < cards.length)
    parts.push(t`${copyable} copyable`);
  if (removable < cards.length) parts.push(t`${removable} removable`);
  return [count, ...parts].join(" · ");
}

/**
 * The confirm before revoking my grants in bulk.
 *
 * Names the blast radius AND the recovery cost, the impact-aware pattern the
 * web panel and `bulkDeleteConfirm` already follow — "sure?" tells the user
 * nothing they did not know when they pressed the button.
 */
export function unshareAllConfirm(args: {
  count: number;
  friendName: string;
  /** Whether a place is in the selection — it carries more than itself. */
  includesPlace: boolean;
}): { title: string; body: string } {
  const { count, friendName } = args;
  return {
    title: plural(
      count,
      "Stop sharing # item with {0}?",
      "Stop sharing # items with {0}?",
      friendName,
    ),
    body: [
      args.includesPlace
        ? plural(
            count,
            "{0} loses access to # item, and a place takes its notes, its photos and its route with it.",
            "{0} loses access to # items, and a place takes its notes, its photos and its route with it.",
            friendName,
          )
        : plural(
            count,
            "{0} loses access to # item.",
            "{0} loses access to # items.",
            friendName,
          ),
      t`You stay friends, and what ${friendName} shares with you is unaffected.`,
      t`There is no undo — you would have to share each one again. Stopping sharing won't remove copies ${friendName} has already made.`,
    ].join(" "),
  };
}

/**
 * The confirm before dropping my own access in bulk.
 *
 * The one place this app asks for something IRRECOVERABLE by the person asking:
 * `removeShareConfirm` (the per-item wording) can say "ask them to share it
 * again", and so does this — but over N rows it is worth saying that copying
 * first is the alternative, because after the tap it is not available.
 */
export function removeAllConfirm(args: {
  count: number;
  friendName: string;
  /** Rows in the selection that could have been copied first. */
  copyableCount: number;
}): { title: string; body: string } {
  const one = args.count === 1;
  return {
    title: plural(
      args.count,
      "Remove # item shared with you?",
      "Remove # items shared with you?",
    ),
    body: [
      plural(
        args.count,
        "# item is removed from your account, on every device.",
        "# items are removed from your account, on every device.",
      ),
      one
        ? t`${args.friendName} keeps the original.`
        : t`${args.friendName} keeps the originals.`,
      // Naming the wrong kind in the one sentence that offers the safe
      // alternative is how a user decides the alternative isn't for them.
      args.copyableCount === 0
        ? ""
        : one
          ? t`You could save a copy of it first.`
          : plural(
              args.copyableCount,
              "# of them is something you could save a copy of first.",
              "# of them are things you could save a copy of first.",
            ),
    ]
      .filter(Boolean)
      .join(" "),
  };
}

/**
 * The line under Remove in a row's sheet. NOT `removeShareConfirm(...).title` —
 * that is a question ("Remove shared place?"), and a question reads as an
 * unanswered prompt when it sits under the verb that asks it. A subtitle states
 * the consequence; the confirm does the asking.
 */
export function removeRowSubtitle(args: {
  kindLabel: string;
  friendName: string;
}): string {
  return t`Takes it off your account. ${args.friendName} keeps the original ${args.kindLabel}.`;
}

/**
 * The confirm before saving a copy.
 *
 * Copying is not destructive, so this exists for a different reason than the
 * two beside it: "Save a copy" does not say WHERE the copy goes or what the
 * copy's relationship to the original is, and a verb whose effect a user cannot
 * predict is one they do not press. It states both, and that the copy survives
 * the friend revoking the share — which is the actual reason to do it.
 */
export function copyConfirm(args: {
  count: number;
  /**
   * The owner's username, where the surface knows it. The item sheets do NOT —
   * a mirrored place or route carries an `ownerId` and no name — so this is
   * optional and the fallback is spelled in both positions below, capitalized
   * when starting a sentence.
   */
  friendName?: string | null;
  /** The single row's name, when only one is being copied. */
  itemName?: string;
  /**
   * The kind, lower-case, when only one row is being copied — a place brings
   * its route with it and a route does not, and the sentence has to be right
   * about which. Omit for a mixed or multi-row copy, which says neither.
   */
  kindLabel?: string;
}): { title: string; body: string } {
  const one = args.count === 1;
  const withRoute = one && args.kindLabel === "place";
  const owner = args.friendName ?? t`the owner`;
  const Owner = args.friendName ?? t`The owner`;
  return {
    title: one ? t`Save a copy?` : t`Save ${args.count} copies?`,
    body: [
      one && args.itemName
        ? withRoute
          ? t`“${args.itemName}” is copied into your own account, with its route.`
          : t`“${args.itemName}” is copied into your own account.`
        : t`${args.count} items are copied into your own account.`,
      one
        ? t`The copy is yours to edit, and stays if ${owner} stops sharing.`
        : t`The copies are yours to edit, and stay if ${owner} stops sharing.`,
      one
        ? t`${Owner}'s original is untouched.`
        : t`${Owner}'s originals are untouched.`,
    ].join(" "),
  };
}

export function copyOutcomeMessage(outcome: {
  copied: number;
  /** Titles that failed — named, because a user cannot retry "2 failed". */
  failed: string[];
  /**
   * Place-level media the copies did not get. Reported even on an otherwise
   * clean run: a copy that quietly arrived without its photos is the failure
   * this whole option exists to make visible.
   */
  mediaSkipped?: number;
  /** The skip was the account's storage filling up, not a transfer fault. */
  mediaOutOfSpace?: boolean;
}): { text: string; tone: "done" | "error" } {
  const { copied, failed } = outcome;
  const skipped = outcome.mediaSkipped ?? 0;
  const sentence = mediaSkippedSentence(
    skipped,
    outcome.mediaOutOfSpace === true,
  );
  const saved = plural(copied, "Saved # copy.", "Saved # copies.");
  if (failed.length === 0) {
    return {
      text: [saved, sentence].filter(Boolean).join(" "),
      tone: skipped > 0 ? "error" : "done",
    };
  }
  if (copied === 0) {
    return {
      text:
        failed.length === 1
          ? t`Couldn't copy ${failed[0]}.`
          : t`Couldn't copy ${failed.length} items: ${failed.join(", ")}.`,
      tone: "error",
    };
  }
  return {
    text: [saved, t`Couldn't copy ${failed.join(", ")}.`, sentence]
      .filter(Boolean)
      .join(" "),
    tone: "error",
  };
}

/**
 * What "save a copy and remove" did.
 *
 * THREE OUTCOMES, and they are not degrees of the same thing — each one leaves
 * the user somewhere different, and a message that blurs them leaves them
 * guessing which:
 *
 *   done              — copied and the share dropped. Nothing to do.
 *   copiedNotRemoved  — the copy is safe, the share is still there. Untidy, and
 *                       fixable with Remove. Must not read as a failure.
 *   failed            — the copy did not happen, so NOTHING was given up. This
 *                       is the one that has to name rows: it is the retryable
 *                       one, and the reassurance ("still shared with you") is
 *                       the point of saying it at all.
 *
 * Media is reported separately and always, because it is the loss the action
 * cannot undo — see `copyAndRemoveConfirm`, which warns about the same count
 * beforehand.
 */
export function copyAndRemoveOutcomeMessage(outcome: {
  done: string[];
  copiedNotRemoved: string[];
  failed: string[];
  mediaSkipped: number;
  mediaOutOfSpace: boolean;
}): { text: string; tone: "done" | "error" } {
  const { done, copiedNotRemoved, failed, mediaSkipped, mediaOutOfSpace } =
    outcome;
  const parts: string[] = [];

  if (done.length > 0) {
    parts.push(
      plural(
        done.length,
        "Saved # copy and removed the shared one.",
        "Saved # copies and removed the shared ones.",
      ),
    );
  }
  if (copiedNotRemoved.length > 0) {
    parts.push(
      copiedNotRemoved.length === 1
        ? t`Copied ${copiedNotRemoved[0]}, but it's still shared with you — use Remove to finish.`
        : t`Copied ${copiedNotRemoved.length} items, but they're still shared with you — use Remove to finish.`,
    );
  }
  if (failed.length > 0) {
    parts.push(
      failed.length === 1
        ? t`Couldn't copy ${failed[0]}, so it's still shared with you.`
        : t`Couldn't copy ${failed.join(", ")} — they're still shared with you.`,
    );
  }
  const media = mediaSkippedSentence(mediaSkipped, mediaOutOfSpace === true);
  if (media) parts.push(media);

  return {
    text: parts.join(" "),
    tone:
      failed.length > 0 || copiedNotRemoved.length > 0 || mediaSkipped > 0
        ? "error"
        : "done",
  };
}

/** What a bulk revoke did, in one sentence. */
export function unshareOutcomeMessage(args: {
  revokedCount: number;
  friendName: string;
}): string {
  return plural(
    args.revokedCount,
    "# item is no longer shared with {0}.",
    "# items are no longer shared with {0}.",
    args.friendName,
  );
}

/** What a bulk remove-my-access did, in one sentence. */
export function removeOutcomeMessage(outcome: {
  removed: number;
  failed: string[];
}): { text: string; tone: "done" | "error" } {
  const { removed, failed } = outcome;
  const gone = plural(removed, "Removed # item.", "Removed # items.");
  if (failed.length === 0) return { text: gone, tone: "done" };
  if (removed === 0) {
    return {
      text:
        failed.length === 1
          ? t`Couldn't remove ${failed[0]}.`
          : t`Couldn't remove ${failed.length} items: ${failed.join(", ")}.`,
      tone: "error",
    };
  }
  return {
    text: `${gone} ${t`Couldn't remove ${failed.join(", ")}.`}`,
    tone: "error",
  };
}

/**
 * Said after a copy whose photos and files didn't all come, or null when
 * they did: the API says how many and whether storage stopped them. Every
 * copy that brings media says it this way (friend shares, Plans).
 */
export function mediaSkippedSentence(
  skipped: number,
  outOfSpace: boolean,
): string | null {
  if (skipped === 0) return null;
  return outOfSpace
    ? plural(
        skipped,
        "Your storage is full, so # photo or file wasn't copied.",
        "Your storage is full, so # photos and files weren't copied.",
      )
    : plural(
        skipped,
        "# photo or file couldn't be copied.",
        "# photos and files couldn't be copied.",
      );
}
