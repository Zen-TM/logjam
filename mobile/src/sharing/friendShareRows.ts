// WHAT THE PER-FRIEND SHARING SCREEN SAYS, and which verb each of its rows
// gets.
//
// Its own React-Native-free module, like `bulkShareTargets.ts` and
// `shareRowSubtitle.ts` and for the same reason: mobile's vitest cannot parse
// React Native's Flow sources, so the branching and the copy are only testable
// away from the screen.
//
// THE TWO DIRECTIONS ARE NOT MIRROR IMAGES, and the asymmetry is the whole
// design:
//
//   "You share with Bob"  — mine. Sharing it with someone ELSE is free, and
//                           unsharing is recoverable (I can re-share it), so
//                           both verbs are offered in bulk.
//   "Bob shares with you" — Bob's. I can keep a COPY of a canyon (recoverable,
//                           and the reason to do it before the other verb), and
//                           I can drop my access — which only Bob can undo, so
//                           it is the destructive slot and it confirms.
//
// WHAT THE LIST CANNOT SHOW, stated on the screen because it decides whether a
// user believes the list: a shared canyon carries its canyon-level notes, its
// canyon-level media and its linked route, and a waypoint linked to it inherits
// visibility with no share row of its own. Those are not rows here. Unsharing
// the CANYON is what takes them back.
//
// PRIVACY: row titles are user text and routinely name canyons. They reach the
// screen and the confirms — a user cannot act on "3 things" without knowing
// which — and nothing here is logged.
import {
  SHARE_KIND_LABEL,
  shareRowTitle,
  isCopyableSharedRow,
  type BulkShareItem,
  type FriendShareRow,
} from "@logjam/shared";

/** Which direction the screen is showing. */
export type FriendShareDirection = "theySee" | "youSee";

/**
 * The glyph per kind. Feather names, spelled as literals rather than imported
 * from `@expo/vector-icons`, so this module stays free of the RN runtime — and
 * the same five glyphs the rest of the app already uses for these kinds
 * (`map-pin` a canyon, `flag` a waypoint, `edit-3` a route, `layers` a LiDAR
 * topo, `file-text` a GeoPDF).
 */
export const SHARE_KIND_ICON = {
  canyon: "map-pin",
  waypoint: "flag",
  route: "edit-3",
  topoJob: "layers",
  geoPdfJob: "file-text",
} as const satisfies Record<FriendShareRow["entityType"], string>;

/**
 * One row of the list, with every decision about it already made.
 *
 * `blockedReason` is the DESIGN.md §7 rule that a verb a group cannot perform
 * is decided BEFORE the bar is drawn: a row that cannot be removed says why in
 * its own sheet, and the bar's tally stays true because it counted the same
 * predicate.
 */
export type FriendShareCard = {
  /** Stable across refetches: the pair is unique per direction. */
  key: string;
  row: FriendShareRow;
  title: string;
  /** "Canyon · shared 12 Aug" — kind first, because kind is what a mixed list needs. */
  subtitle: string;
  icon: (typeof SHARE_KIND_ICON)[keyof typeof SHARE_KIND_ICON];
  /** Copying it into my own account is possible (canyons only, today). */
  copyable: boolean;
  /** Dropping my access would actually change what I can see. */
  removable: boolean;
  /**
   * Why Remove is withheld, in the words the sheet shows. Set only for a row
   * that is ALSO visible through a canyon this friend shared: revoking its
   * direct share leaves the canyon arm standing, so the row would vanish and
   * come straight back on the next pull.
   */
  blockedReason?: string;
};

/**
 * The row's identity, and the ONE spelling of it — the screen also builds these
 * keys from mirror rows (to find which received rows also ride a shared
 * canyon), so a second format there would silently match nothing.
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
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Build the cards for one direction.
 *
 * The "this also rides a shared canyon" answer comes from the ROW (the server
 * sets `alsoViaCanyon`), not from the local mirror. Deriving it here was right
 * only once the mirror had pulled the linked row — before that, the same
 * waypoint offered a Remove that the next delta pull would have undone.
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
    const viaCanyon = options.direction === "youSee" && row.alsoViaCanyon === true;
    return {
      key,
      row,
      title: shareRowTitle(row),
      subtitle: `${capitalise(SHARE_KIND_LABEL[row.entityType])} · shared ${formatShareDay(row.sharedAt)}`,
      icon: SHARE_KIND_ICON[row.entityType],
      copyable: options.direction === "youSee" && isCopyableSharedRow(row),
      removable: options.direction === "youSee" && !viaCanyon,
      ...(viaCanyon
        ? {
            blockedReason: `This came with a canyon ${options.friendName} shared with you. Remove that canyon to stop seeing it.`,
          }
        : {}),
    };
  });
}

/**
 * The selection bar's count line.
 *
 * A TALLY PER VERB, because each verb acts on a SUBSET (DESIGN.md §7): the
 * bar's buttons are glyphs and cannot say "3 of your 5", so the line says it
 * before the press. The forward direction needs no tally — every row there can
 * be shared on and unshared — so it stays the plain count.
 */
export function shareSelectionCountLabel(
  cards: FriendShareCard[],
  direction: FriendShareDirection,
): string {
  const count = `${cards.length} selected`;
  if (direction === "theySee") return count;
  const copyable = cards.filter((card) => card.copyable).length;
  const removable = cards.filter((card) => card.removable).length;
  const parts: string[] = [];
  // Only worth saying when it differs from the total — "5 selected · 5
  // removable" is noise, and noise is what stops the useful case being read.
  if (copyable > 0 && copyable < cards.length) parts.push(`${copyable} copyable`);
  if (removable < cards.length) parts.push(`${removable} removable`);
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
  /** Whether a canyon is in the selection — it carries more than itself. */
  includesCanyon: boolean;
}): { title: string; body: string } {
  const things = args.count === 1 ? "1 item" : `${args.count} items`;
  return {
    title: `Unshare ${things} from ${args.friendName}?`,
    body:
      `${args.friendName} loses access to ${things}` +
      (args.includesCanyon
        ? ", and a canyon takes its notes, its photos and its route with it. "
        : ". ") +
      `You stay friends, and what ${args.friendName} shares with you is unaffected. ` +
      `There is no undo — you would have to share each one again. Unsharing won't remove copies ${args.friendName} has already made.`,
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
  const things = one ? "1 item" : `${args.count} items`;
  return {
    title: `Remove ${things} shared with you?`,
    body:
      `${things} ${one ? "is" : "are"} removed from your account, on every device. ` +
      `${args.friendName} keeps the ${one ? "original" : "originals"}.` +
      (args.copyableCount === 0
        ? ""
        : one
          ? " It's a canyon you could save a copy of first."
          : ` ${args.copyableCount === 1 ? "1 of them is a canyon you" : `${args.copyableCount} of them are canyons you`} could save a copy of first.`),
  };
}

/** What a bulk copy did, in one sentence. */
/**
 * The line under Remove in a row's sheet. NOT `removeShareConfirm(...).title` —
 * that is a question ("Remove shared canyon?"), and a question reads as an
 * unanswered prompt when it sits under the verb that asks it. A subtitle states
 * the consequence; the confirm does the asking.
 */
export function removeRowSubtitle(args: {
  kindLabel: string;
  friendName: string;
}): string {
  return `Takes it off your account. ${args.friendName} keeps the original ${args.kindLabel}.`;
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
  friendName: string;
  /** The single row's name, when only one is being copied. */
  itemName?: string;
}): { title: string; body: string } {
  const one = args.count === 1;
  return {
    title: one ? "Save a copy?" : `Save ${args.count} copies?`,
    body:
      (one && args.itemName
        ? `“${args.itemName}” is copied into your own canyons, with its route. `
        : `${args.count} canyons are copied into your own canyons, with their routes. `) +
      `The ${one ? "copy is" : "copies are"} yours to edit, and ${one ? "stays" : "stay"} if ${args.friendName} stops sharing. ` +
      `${args.friendName}'s ${one ? "canyon is" : "canyons are"} untouched.`,
  };
}

export function copyOutcomeMessage(outcome: {
  copied: number;
  /** Titles that failed — named, because a user cannot retry "2 failed". */
  failed: string[];
}): { text: string; tone: "info" | "error" } {
  const { copied, failed } = outcome;
  const saved =
    copied === 1 ? "Saved 1 copy to your canyons" : `Saved ${copied} copies to your canyons`;
  if (failed.length === 0) {
    return { text: `${saved}.`, tone: "info" };
  }
  if (copied === 0) {
    return {
      text:
        failed.length === 1
          ? `Couldn't copy ${failed[0]}.`
          : `Couldn't copy ${failed.length} canyons: ${failed.join(", ")}.`,
      tone: "error",
    };
  }
  return {
    text: `${saved}. Couldn't copy ${failed.join(", ")}.`,
    tone: "error",
  };
}

/** What a bulk revoke did, in one sentence. */
export function unshareOutcomeMessage(args: {
  revokedCount: number;
  friendName: string;
}): string {
  return args.revokedCount === 1
    ? `1 item is no longer shared with ${args.friendName}.`
    : `${args.revokedCount} items are no longer shared with ${args.friendName}.`;
}

/** What a bulk remove-my-access did, in one sentence. */
export function removeOutcomeMessage(outcome: {
  removed: number;
  failed: string[];
}): { text: string; tone: "info" | "error" } {
  const { removed, failed } = outcome;
  const gone = removed === 1 ? "Removed 1 item" : `Removed ${removed} items`;
  if (failed.length === 0) return { text: `${gone}.`, tone: "info" };
  if (removed === 0) {
    return {
      text:
        failed.length === 1
          ? `Couldn't remove ${failed[0]}.`
          : `Couldn't remove ${failed.length} items: ${failed.join(", ")}.`,
      tone: "error",
    };
  }
  return { text: `${gone}. Couldn't remove ${failed.join(", ")}.`, tone: "error" };
}
