// "Is my work safe?" — the one question shared/DESIGN.md says an offline-first app
// owes the user, answered in one sentence for the More hub's hero.
//
// Pure so the copy rules are testable: every branch here is a claim about the
// user's data, and the rule that matters is SAY WHAT IS TRUE, NOT WHAT IS
// OPTIMISTIC. "Syncing…" while offline, or "Everything's synced" with rows in
// the outbox, reads as a bug the first time the user notices.
//
// PRIVACY: counts and timestamps only. Never a row's contents, never a server
// error message (shared/DESIGN.md §11 — failure copy is ours, not the error's).

import {
  formatDayLongMonth,
  localDay,
  longWeekday,
  plural,
  t,
} from "@logjam/shared";

export type SyncTone = "ok" | "info" | "pending" | "problem";

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
  /** Things (places, tracks, trips) not yet accepted by the server. */
  pendingCount: number;
  /**
   * The queued ops behind them, which is what the bulk-upload wording is
   * tuned against. Defaults to `pendingCount`.
   */
  pendingOpCount?: number;
  /** Parked ops + shelved conflicts — things only the user can resolve. */
  issueCount: number;
  /**
   * Why the last cycle failed, when it did. `applyFailed` means the server
   * answered and this app couldn't apply what it sent — a different sentence
   * entirely from "no signal", and the difference is what the user acts on.
   */
  errorKind?: "unreachable" | "applyFailed" | "unsupported" | null;
  /**
   * ISO instant the queue stopped getting answers, once that has lasted a day
   * of being online (`SyncStatus.waitingSince`). Nothing is parked and nothing
   * needs the user; the sentence is the whole surface.
   */
  waitingSince?: string | null;
  /** No account: nothing syncs, and the honest answer is a different sentence. */
  accountState?: "guest" | "linked";
  /** Injectable for tests. */
  now?: number;
};

/**
 * Above this many queued ops (`pendingOpCount`, not the things they make up), a running cycle is a bulk upload rather than
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
  if (Number.isNaN(then)) return t`at an unknown time`;
  const elapsed = now - then;
  // A clock that jumped (timezone change, NTP correction) must not produce
  // "in -3 minutes" (guard: mobile/src/screens/syncHealth.test.ts); treat any
  // future stamp as just now.
  if (elapsed < MINUTE_MS) return t`just now`;
  if (elapsed < HOUR_MS) {
    const minutes = Math.floor(elapsed / MINUTE_MS);
    return t`${minutes} min ago`;
  }
  if (elapsed < DAY_MS) {
    const hours = Math.floor(elapsed / HOUR_MS);
    return plural(hours, "# hour ago", "# hours ago");
  }
  const days = Math.floor(elapsed / DAY_MS);
  if (days === 1) return t`yesterday`;
  return t`${days} days ago`;
}

/**
 * The day something started, as someone would say it: "yesterday", "Tuesday",
 * then "28 September" once a weekday could mean two different days. In the
 * phone's own time zone, and by hand because Hermes ships no reliable `Intl`
 * weekday names.
 */
function sinceDay(iso: string, now: number): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return t`some time ago`;
  const midnight = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((midnight(new Date(now)) - midnight(then)) / DAY_MS);
  if (days <= 0) return t`today`;
  if (days === 1) return t`yesterday`;
  if (days < 7) return longWeekday(then.getDay());
  return formatDayLongMonth(localDay(then));
}

function lastSyncDetail(lastSyncAt: string | null, now: number): string {
  if (!lastSyncAt) return t`Nothing has reached your account yet.`;
  return t`Last synced ${relativeTime(lastSyncAt, now)}.`;
}

/**
 * The subtitle of More's "Account sync issues" row. It answers for ISSUES
 * only: with none it does not say "Everything's synced" (guard:
 * mobile/src/screens/syncHealth.test.ts), directly under a hero
 * line saying a change had been waiting since Tuesday. Whether everything is
 * synced is the hero's sentence to say, and this row cannot know it.
 */
export function syncIssuesSubtitle(issueCount: number): string {
  return issueCount > 0
    ? plural(issueCount, "# change needs you", "# changes need you")
    : t`Nothing needs you`;
}

/**
 * The Sync issues screen's own title, for the same reason as the row that
 * opens it: the screen lists issues, so empty means nothing needs the user,
 * not that nothing is queued.
 */
export function syncIssuesTitle(issueCount: number): string {
  if (issueCount === 0) return syncIssuesSubtitle(0);
  return issueCount === 1 ? t`A change needs you` : t`Some changes need you`;
}

export function syncHealth(input: SyncHealthInput): SyncHealth {
  const { online, state, lastSyncAt, pendingCount, issueCount } = input;
  const bulk = (input.pendingOpCount ?? pendingCount) >= BULK_UPLOAD_THRESHOLD;
  const now = input.now ?? Date.now();

  // 0. No account. Every branch below is a claim about a server this user
  //    doesn't have one of, and the outbox rows they've accumulated are not
  //    "waiting" for anything — they are the permanent state. The one thing
  //    worth saying is where the data lives, and that nothing else holds a copy.
  if (input.accountState === "guest") {
    return {
      headline: t`Saved on this phone`,
      detail: t`You don't have an account, so nothing is uploaded or backed up.`,
      // Not "ok": a check beside "nothing is backed up" says done to a user who
      // has a risk to know about.
      tone: "info",
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
      headline: t`Couldn't download new data on this phone`,
      detail: t`Retrying won't fix it. Open Account sync issues to download a fresh copy.`,
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
      headline: t`Logjam isn't ready to sync`,
      detail: t`Your changes are safe on this phone and will upload once it is.`,
      tone: "problem",
    };
  }

  // 1. Something is stuck on a decision only the user can make. This outranks
  //    everything because retrying will never clear it.
  if (issueCount > 0) {
    return {
      headline: plural(issueCount, "# change needs you", "# changes need you"),
      detail:
        pendingCount > 0
          ? plural(
              pendingCount,
              "# other change is still queued.",
              "# other changes are still queued.",
            )
          : t`Everything else is synced.`,
      tone: "problem",
    };
  }

  // 1.5. Work is queued, the phone says it is online, and a day of that has
  //      gone by without one answer. Above "Sending…" so the line does not
  //      flip to a promise of progress for the length of every timeout. Below
  //      offline (the `online` test): with no signal the ordinary sentence is
  //      the true one. Tone stays `pending` and there is no verb, because
  //      there is nothing for the reader to do.
  if (input.waitingSince && pendingCount > 0 && online) {
    return {
      headline: plural(
        pendingCount,
        "# change has been waiting since {0}",
        "# changes have been waiting since {0}",
        sinceDay(input.waitingSince, now),
      ),
      detail: t`Logjam GPS keeps trying.`,
      tone: "pending",
    };
  }

  // 2. A cycle is actually running. Only claim this while there is a link
  //    (guard: mobile/src/screens/syncHealth.test.ts) — "Syncing…" with no
  //    signal is the optimistic label shared/DESIGN.md §10 forbids.
  if (state === "syncing" && online) {
    if (bulk) {
      return {
        headline: plural(
          pendingCount,
          "Uploading # change…",
          "Uploading # changes…",
        ),
        detail: t`This can take a while, and photos are the slow part. You can keep using Logjam GPS.`,
        tone: "pending",
      };
    }
    return {
      headline:
        pendingCount > 0
          ? plural(pendingCount, "Sending # change…", "Sending # changes…")
          : t`Syncing…`,
      detail: lastSyncDetail(lastSyncAt, now),
      tone: "pending",
    };
  }

  // 3. Work is queued. Which sentence is true depends on whether it CAN move.
  if (pendingCount > 0) {
    if (bulk && online) {
      return {
        headline: plural(
          pendingCount,
          "# change to upload",
          "# changes to upload",
        ),
        detail: t`They upload in batches. This can take a while.`,
        tone: "pending",
      };
    }
    return {
      headline: plural(
        pendingCount,
        "# change waiting to sync",
        "# changes waiting to sync",
      ),
      detail: online
        ? t`It will go up on the next sync.`
        : t`Saved on this phone. It goes up when you have signal.`,
      tone: "pending",
    };
  }

  // 4. Nothing queued, but the last attempt failed — worth saying, because the
  //    user's mental model ("did my edit land?") deserves the truth even when
  //    the answer is "yes, and then the connection went".
  if (state === "error") {
    return {
      headline: t`Can't reach your account`,
      detail: `${lastSyncDetail(lastSyncAt, now)} ${t`It will keep retrying.`}`,
      tone: "problem",
    };
  }

  // 5. Genuinely clean. Offline with an empty outbox is a fine state, not a
  //    warning — the whole app is built to work this way.
  return {
    headline: t`Everything's synced`,
    detail: online
      ? lastSyncDetail(lastSyncAt, now)
      : t`You're offline, and nothing is waiting.`,
    tone: "ok",
  };
}
