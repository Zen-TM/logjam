// "Is my work safe?" — the one question DESIGN.md §10 says an offline-first app
// owes the user, answered in one sentence for the More hub's hero.
//
// Pure so the copy rules are testable: every branch here is a claim about the
// user's data, and the rule that matters is SAY WHAT IS TRUE, NOT WHAT IS
// OPTIMISTIC. "Syncing…" while offline, or "Everything's synced" with rows in
// the outbox, reads as a bug the first time the user notices.
//
// PRIVACY: counts and timestamps only. Never a row's contents, never a server
// error message (§11 — failure copy is ours, not the error's).

export type SyncTone = "ok" | "pending" | "problem";

export type SyncHealth = {
  /** The answer, as a sentence. */
  headline: string;
  /** Supporting line — when it last worked, or what happens next. */
  detail: string;
  tone: SyncTone;
};

export type SyncHealthInput = {
  online: boolean;
  state: "idle" | "syncing" | "error";
  /** ISO instant of the last successful cycle. */
  lastSyncAt: string | null;
  /** Outbox rows not yet accepted by the server. */
  pendingCount: number;
  /** Parked ops + shelved conflicts — things only the user can resolve. */
  issueCount: number;
  /**
   * Why the last cycle failed, when it did. `applyFailed` means the server
   * answered and this app couldn't apply what it sent — a different sentence
   * entirely from "no signal", and the difference is what the user acts on.
   */
  errorKind?: "unreachable" | "applyFailed" | "unsupported" | null;
  /** No account: nothing syncs, and the honest answer is a different sentence. */
  accountState?: "guest" | "linked";
  /** Injectable for tests. */
  now?: number;
};

/**
 * Above this many queued changes, a running cycle is a bulk upload rather than
 * an ordinary catch-up, and needs copy that reads as progress. A guest who
 * links after a season has hundreds of ops and a photo backlog that can take
 * hours; "Sending 847 changes…" with no sense of scale reads as a hang, and the
 * pull-to-refresh reflex it provokes achieves nothing.
 *
 * The threshold is a judgement call, not a measurement: comfortably above a
 * day's editing, comfortably below a first link.
 */
const BULK_UPLOAD_THRESHOLD = 50;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Coarse "when did that happen" for a hero line. Deliberately stops at days:
 * an exact timestamp invites the reader to do arithmetic, and the only decision
 * this line supports is "recently enough, or should I pull to refresh".
 */
export function relativeTime(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "at an unknown time";
  const elapsed = now - then;
  // A clock that jumped (timezone change, NTP correction) must not produce
  // "in -3 minutes"; treat any future stamp as just now.
  if (elapsed < MINUTE_MS) return "just now";
  if (elapsed < HOUR_MS) {
    const minutes = Math.floor(elapsed / MINUTE_MS);
    return `${minutes} min ago`;
  }
  if (elapsed < DAY_MS) {
    const hours = Math.floor(elapsed / HOUR_MS);
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  const days = Math.floor(elapsed / DAY_MS);
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function lastSyncDetail(lastSyncAt: string | null, now: number): string {
  if (!lastSyncAt) return "Nothing has reached your account yet.";
  return `Last synced ${relativeTime(lastSyncAt, now)}.`;
}

export function syncHealth(input: SyncHealthInput): SyncHealth {
  const { online, state, lastSyncAt, pendingCount, issueCount } = input;
  const now = input.now ?? Date.now();

  // 0. No account. Every branch below is a claim about a server this user
  //    doesn't have one of, and the outbox rows they've accumulated are not
  //    "waiting" for anything — they are the permanent state. The one thing
  //    worth saying is where the data lives, and that nothing else holds a copy.
  if (input.accountState === "guest") {
    return {
      headline: "Saved on this phone",
      detail: "You don't have an account, so nothing is uploaded or backed up.",
      tone: "ok",
    };
  }

  // Order is a priority ranking, most serious first. Only one headline gets to
  // be the answer, so the worst true statement wins.

  // 0.5. The server answered and the app couldn't apply it. Above everything
  //      else because NOTHING new reaches this phone until it is resolved, and
  //      because the two things the other branches would say — that the account
  //      is unreachable, that it will keep retrying — are both false. Naming
  //      the network here is worse than saying nothing: it sends a user with
  //      full bars to go looking for signal.
  if (input.errorKind === "applyFailed") {
    return {
      headline: "Couldn't download new data on this phone",
      detail:
        "Retrying won't fix it. Open Sync issues to download a fresh copy.",
      tone: "problem",
    };
  }

  // 0.6. The server has no sync endpoints — it is older than this app. Ranked
  //      beside `applyFailed` for the same reason: nothing new will ever reach
  //      this phone, and "will keep retrying" is false. It sits BELOW it
  //      because there is a repair for that one and none for this, and above
  //      everything else because a queue that cannot drain is not "queued".
  if (input.errorKind === "unsupported") {
    return {
      headline: "The server isn't ready to sync",
      detail:
        "Your changes are safe on this phone and will upload once it is.",
      tone: "problem",
    };
  }

  // 1. Something is stuck on a decision only the user can make. This outranks
  //    everything because retrying will never clear it.
  if (issueCount > 0) {
    return {
      headline: `${plural(issueCount, "change needs", "changes need")} you`,
      detail:
        pendingCount > 0
          ? `${plural(pendingCount, "other change is", "other changes are")} still queued.`
          : "Everything else is synced.",
      tone: "problem",
    };
  }

  // 2. A cycle is actually running. Only claim this while there is a link —
  //    "Syncing…" with no signal is the optimistic label §10 forbids.
  if (state === "syncing" && online) {
    if (pendingCount >= BULK_UPLOAD_THRESHOLD) {
      return {
        headline: `Uploading ${plural(pendingCount, "change", "changes")}…`,
        detail:
          "This can take a while, and photos are the slow part. You can keep using the app.",
        tone: "pending",
      };
    }
    return {
      headline: pendingCount > 0 ? `Sending ${plural(pendingCount, "change", "changes")}…` : "Syncing…",
      detail: lastSyncDetail(lastSyncAt, now),
      tone: "pending",
    };
  }

  // 3. Work is queued. Which sentence is true depends on whether it CAN move.
  if (pendingCount > 0) {
    if (pendingCount >= BULK_UPLOAD_THRESHOLD && online) {
      return {
        headline: `${plural(pendingCount, "change", "changes")} to upload`,
        detail: "They upload in batches. This can take a while.",
        tone: "pending",
      };
    }
    return {
      headline: `${plural(pendingCount, "change", "changes")} waiting to sync`,
      detail: online
        ? "It will go up on the next sync."
        : "Saved on this phone. It goes up when you have signal.",
      tone: "pending",
    };
  }

  // 4. Nothing queued, but the last attempt failed — worth saying, because the
  //    user's mental model ("did my edit land?") deserves the truth even when
  //    the answer is "yes, and then the connection went".
  if (state === "error") {
    return {
      headline: "Can't reach your account",
      detail: `${lastSyncDetail(lastSyncAt, now)} It will keep retrying.`,
      tone: "problem",
    };
  }

  // 5. Genuinely clean. Offline with an empty outbox is a fine state, not a
  //    warning — the whole app is built to work this way.
  return {
    headline: "Everything's synced",
    detail: online
      ? lastSyncDetail(lastSyncAt, now)
      : "You're offline, and nothing is waiting.",
    tone: "ok",
  };
}
