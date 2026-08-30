// WHICH VERB EACH SELECTED ROW GETS, and the sentence that tells the user so
// before anything leaves the phone.
//
// A multi-select can hold a waypoint (shareable — live and revocable), a
// recorded track (copyable only — a file, gone for good once taken), a region
// download (neither), and a route someone shared WITH the user (theirs to look
// at, not to pass on). The mechanism is never the user's choice — it is the
// only thing each kind supports — so the whole job here is to sort the
// selection and then SAY what the sort came to, in the confirm, before the
// action runs. A user who thought all 23 were revocable has been misled by this
// screen, which is the same failure the single-item panel's two promise banners
// exist to prevent (see SharePanel.tsx's header).
//
// Its own RN-free module, like `shareRowSubtitle.ts` and `tapTarget.ts`:
// mobile's vitest cannot parse React Native's Flow sources, so the branching
// and the copy are only testable away from the screen.
//
// PRIVACY: item titles are user text and routinely name canyons. They are not
// used here at all — the sentence counts rows, it never lists them — and
// nothing in this module is logged.
import type { BulkShareItem, BulkShareItemType } from "@logjam/shared";

/**
 * The `sendCopy` descriptor, structurally typed so this module never imports
 * the saved-asset types (and the RN filesystem behind them) to name a shape it
 * only passes through.
 */
export type SendCopyDescriptor = {
  sourceKind: "import" | "track";
  filename: string;
  resolveFile: () => Promise<{ uri: string; cleanup?: () => Promise<void> }>;
};

/** What a screen hands in: one selected row, stripped to what decides its verb. */
export type BulkShareCandidate = {
  /** The row's stable key, so a caller can match a result back to its card. */
  key: string;
  /**
   * Someone else owns it. Checked BEFORE the two verbs rather than inferred
   * from their absence: a LiDAR topo shared with you is a file on this handset
   * and keeps its `sendCopy`, so absence alone would have offered to pass on
   * someone else's map — the same asymmetry `AssetActions.sharedWithYou` was
   * made explicit for.
   */
  sharedWithYou?: true;
  /** A live, revocable grant — see `AssetActions.share`. */
  share?: { entityType: BulkShareItemType; entityId: string };
  /** A file handed over for keeps — see `AssetActions.sendCopy`. */
  sendCopy?: SendCopyDescriptor;
};

export type BulkShareSkipReason = "shared-with-you" | "not-shareable";

export type BulkSharePlan<C extends BulkShareCandidate = BulkShareCandidate> = {
  /** Rows that get a live, revocable share, as the API's item list. */
  shares: BulkShareItem[];
  /** Rows that can only be handed over as a file. One upload each. */
  copies: C[];
  /** Rows a bulk share can do nothing with, and why. */
  skipped: { candidate: C; reason: BulkShareSkipReason }[];
  /** shares + copies — nothing will happen at all when this is 0. */
  actionableCount: number;
};

/**
 * Sort a selection into the two verbs and the leftovers.
 *
 * A row carrying BOTH verbs takes the SHARE. It is the recoverable one: a
 * mis-share is revoked from the item's own sheet, a mis-sent copy is a file in
 * someone else's hands forever. Nothing in the app currently offers both, but
 * the tie has to break somewhere and this is the direction that can be undone.
 */
export function planBulkShareSelection<C extends BulkShareCandidate>(
  candidates: C[],
): BulkSharePlan<C> {
  const shares: BulkShareItem[] = [];
  const copies: C[] = [];
  const skipped: { candidate: C; reason: BulkShareSkipReason }[] = [];

  for (const candidate of candidates) {
    if (candidate.sharedWithYou) {
      skipped.push({ candidate, reason: "shared-with-you" });
      continue;
    }
    if (candidate.share) {
      shares.push(candidate.share);
      continue;
    }
    if (candidate.sendCopy) {
      copies.push(candidate);
      continue;
    }
    skipped.push({ candidate, reason: "not-shareable" });
  }

  return {
    shares,
    copies,
    skipped,
    actionableCount: shares.length + copies.length,
  };
}

// ── Running one, and reporting on it ─────────────────────────────────────────
// The run itself is `./runBulkShare.ts`, which reaches expo-crypto and the API
// client. The SHAPES and every WORD of the report live here, on the RN-free
// side, because that is the half that has to be right and the half vitest can
// reach.

export type BulkShareProgress =
  /** Uploading the copies, one at a time. `done` counts finished attempts. */
  | { phase: "copies"; done: number; total: number; filename: string }
  /** The single grant request. Brief, but not instant on a bad link. */
  | { phase: "shares" };

export type BulkShareOutcome = {
  /** New share rows written, summed over items x recipients. */
  granted: number;
  /** Pairs that already existed. Not an error — re-sharing is a no-op. */
  alreadyShared: number;
  /** Items the server would not share, summed over recipients. */
  ineligible: number;
  copiesSent: number;
  /** The files that did not go, by name, so the user knows what to redo. */
  copiesFailed: string[];
  /**
   * The grant leg's failure, if it failed. NOT thrown by the runner: the copies
   * have already left the device by then, and an exception would report a run
   * that partly succeeded as a total failure.
   */
  shareError: string | null;
};

/**
 * The line shown in the panel BEFORE the button, when a selection contains rows
 * a bulk share cannot act on.
 *
 * Up front rather than as errors afterwards: which rows are skipped is entirely
 * predictable from what is on screen, and a predictable exclusion reported as a
 * failure reads as the feature being broken. Null when everything is
 * actionable, so the panel shows nothing rather than a reassuring no-op line.
 */
export function bulkShareTriageLine(plan: BulkSharePlan): string | null {
  if (plan.skipped.length === 0) return null;
  const total = plan.actionableCount + plan.skipped.length;
  const notMine = plan.skipped.filter(
    (row) => row.reason === "shared-with-you",
  ).length;
  const cannot = plan.skipped.length - notMine;
  // Both reasons named when both are present: "5 skipped" alone leaves the user
  // hunting through the list for which five, and the two have different
  // remedies (one is permanent, one usually means "wait for it to finish").
  const reasons = [
    notMine > 0 ? `${notMine} shared with you` : null,
    cannot > 0 ? `${cannot} can't be shared` : null,
  ].filter((part): part is string => part !== null);
  if (plan.actionableCount === 0) {
    return `None of these ${total} can be shared — ${reasons.join(", ")}.`;
  }
  return `${plan.actionableCount} of ${total} can be shared — skipping ${reasons.join(" and ")}.`;
}

/**
 * The panel's heading.
 *
 * Says "Send" the moment a single copy is in the selection, because that is the
 * promise that governs the whole action — a heading reading "Share 23 items"
 * over a list where 8 of them leave for good is the one lie this feature must
 * not tell. It names the ACTIONABLE count, not the selection size: the skipped
 * rows are accounted for in the triage line, and counting them twice makes both
 * numbers wrong.
 */
export function bulkShareTitle(plan: BulkSharePlan): string {
  const noun = countOf(plan.actionableCount, "item");
  return plan.copies.length > 0 ? `Send ${noun}` : `Share ${noun}`;
}

/**
 * THE CONFIRM. The one screen where a user learns that some of what they picked
 * is going out irrevocably.
 *
 * Two sentences at most, one per verb, each in that verb's own words — the same
 * rule the single-item panel's promise banners follow, for the same reason: a
 * user who believes a sent file can be taken back was misled here. The copy
 * half is stated LAST because it is the one that cannot be undone, and last is
 * what a person still has in mind when they tap the button.
 *
 * Returns null when there is nothing to confirm.
 */
export function bulkShareConfirm(
  plan: BulkSharePlan,
  recipientCount: number,
): { title: string; body: string; confirmLabel: string } | null {
  if (plan.actionableCount === 0 || recipientCount === 0) return null;
  const friends = countOf(recipientCount, "friend");
  const lines: string[] = [];
  if (plan.shares.length > 0) {
    lines.push(
      `${countOf(plan.shares.length, "item")} will be shared — they can view and export, and you can stop sharing whenever you like.`,
    );
  }
  if (plan.copies.length > 0) {
    lines.push(
      `${countOf(plan.copies.length, "item")} will be sent as a copy — those become theirs to keep, and you can't take them back.`,
    );
  }
  return {
    title: `Send to ${friends}?`,
    body: lines.join("\n\n"),
    // Never "Share": half of what is about to happen is not a share, and the
    // button is the last word the user reads.
    confirmLabel: plan.copies.length > 0 ? "Send" : "Share",
  };
}
/**
 * The footer button's words, idle and mid-run.
 *
 * IT REPORTS THE UPLOAD QUEUE. Granting shares is one request; sending eight
 * copies is eight round trips over trail signal, and a spinner that says
 * nothing for two minutes is indistinguishable from a hang — the user's only
 * move then is to back out of the sheet, which abandons the run mid-way. "3 of
 * 8 — Ranon.gpx" is what makes waiting a decision rather than a guess.
 */
export function bulkShareButtonLabel(
  plan: { copies: unknown[]; shares: unknown[] },
  recipientCount: number,
  progress: BulkShareProgress | null,
): string {
  if (progress?.phase === "copies") {
    return `Sending ${progress.done + 1} of ${progress.total} — ${progress.filename}`;
  }
  if (progress?.phase === "shares") return "Sharing…";
  const verb = plan.copies.length > 0 ? "Send" : "Share";
  return recipientCount === 0
    ? `${verb} with friends`
    : `${verb} with ${countOf(recipientCount, "friend")}`;
}

/**
 * What the toast says afterwards, and whether it is an error.
 *
 * Pure, and separate from the run, because THIS is the part that has to be
 * right: a run where 6 of 8 files went and every share landed is neither a
 * success nor a failure, and a screen that picks one of those two words lies to
 * the user about what is now in their friends' hands.
 *
 * `alreadyShared` is deliberately NOT reported. It is a no-op the user did not
 * ask about, and the count exists so the SERVER can skip the write, not so the
 * sentence can explain it.
 */
export function bulkShareOutcomeMessage(
  outcome: BulkShareOutcome,
): { text: string; tone: "info" | "error" } {
  const failed = outcome.copiesFailed.length;
  const parts: string[] = [];
  if (outcome.granted > 0) parts.push(`Shared ${countOf(outcome.granted, "item")}`);
  if (outcome.copiesSent > 0) parts.push(`sent ${countOf(outcome.copiesSent, "copy", "copies")}`);

  if (parts.length === 0) {
    // Nothing landed. The share leg's own message beats a generic one; the copy
    // leg has no single error to quote, so it names the count.
    if (outcome.shareError) return { text: outcome.shareError, tone: "error" };
    if (failed > 0) {
      return { text: `Couldn't send ${countOf(failed, "file")}.`, tone: "error" };
    }
    return { text: "Nothing to share.", tone: "error" };
  }

  // The copy clause is written lower-case to follow "Shared 6 items and …",
  // so a copy-ONLY run has to capitalise whichever clause ended up first.
  const joined = parts.join(" and ");
  const done = `${joined[0].toUpperCase()}${joined.slice(1)}.`;
  // A partial run reports as an ERROR even though most of it worked: the half
  // that did not is the half the user has to do something about, and an
  // info-toned toast is the one people scroll past.
  if (failed > 0) {
    return {
      text: `${done} Couldn't send ${outcome.copiesFailed.join(", ")}.`,
      tone: "error",
    };
  }
  if (outcome.shareError) {
    return { text: `${done} ${outcome.shareError}`, tone: "error" };
  }
  return { text: done, tone: "info" };
}

function countOf(count: number, noun: string, plural = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : plural}`;
}
