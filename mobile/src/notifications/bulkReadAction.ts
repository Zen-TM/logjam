// What ONE button does to a mixed selection of read and unread notifications.
//
// The inbox's bulk bar carries a single read/unread verb rather than a pair,
// because the pair is two buttons of which one is always a no-op for the
// selection in hand. The rule:
//   every selected row read   → mark them all UNREAD
//   anything unread selected  → mark the unread ones READ
// which means "mixed" behaves as all-unread does, and the destructive-ish
// direction (undoing reads) is only ever reached from a wholly-read selection.
//
// It is a decision made once, here, because the button's glyph, its screen
// reader label and the toast that follows must all describe the SAME outcome —
// three places to get out of step if the branch is inlined in the screen.
//
// Its own RN-free module, like `notificationActions.ts` and `tapTarget.ts`:
// mobile's vitest setup cannot parse React Native's Flow sources, so anything
// worth testing lives away from the screen.
import type { Feather } from "@expo/vector-icons";

export type BulkReadAction = {
  /** The read flag to write on the affected rows. */
  read: boolean;
  /** The rows that actually change — the ones not already in that state. */
  ids: string[];
  icon: React.ComponentProps<typeof Feather>["name"];
  /** Screen-reader label for the bar's button. */
  label: string;
  /** The toast when it lands. */
  success: string;
};

/**
 * Null for an empty selection — there is no verb to offer and no label that
 * would be true.
 */
export function bulkReadAction(
  selected: { id: string; read: boolean }[],
): BulkReadAction | null {
  if (selected.length === 0) return null;
  const unread = selected.filter((notification) => !notification.read);
  if (unread.length === 0) {
    return {
      read: false,
      ids: selected.map((notification) => notification.id),
      icon: "eye-off",
      label: "Mark as unread",
      success: "Marked as unread.",
    };
  }
  return {
    read: true,
    ids: unread.map((notification) => notification.id),
    icon: "eye",
    label:
      unread.length === selected.length
        ? "Mark as read"
        : "Mark the unread ones as read",
    success: "Marked as read.",
  };
}

/**
 * The selection bar's own words. It states the unread tally as well as the
 * count, because the tally is what decides which way the one read/unread button
 * will go — without it the button's direction is something the user has to
 * remember rather than read.
 */
export function selectionCountLabel(selected: { read: boolean }[]): string {
  const unread = selected.filter((notification) => !notification.read).length;
  // "N selected" in both forms — the tally is an ADDITION to the count, not a
  // replacement for it, and dropping the word "selected" in one of the two made
  // the bar read as a different sentence depending on what was picked.
  const base = `${selected.length} selected`;
  return unread === 0 ? base : `${base} · ${unread} unread`;
}
