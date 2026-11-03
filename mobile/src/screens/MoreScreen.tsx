// More tab — the hub for the surfaces folded off the tab bar (Inbox, Plans,
// Friends, Sync issues, Settings, Account).
//
// A hub is a menu, and a menu is not very interesting. What makes this screen
// worth opening is the ONE question it can answer that no other screen owns:
// "is my work safe?" (DESIGN.md). Every other tab is about places, trips or
// maps; this is the only place that can be about the app itself, so the hero is
// the sync answer in a sentence and the menu sits under it.
//
// DELIBERATE DEPARTURE from §10's pills: on every other screen the offline and
// "N waiting to sync" pills exist to carry this answer onto a screen that is
// about something else. Here it IS the subject, stated in words — so repeating
// it as pills beside its own headline would be the four-status-lines
// anti-pattern §8 warns about. One channel, and on this screen the channel is
// the sentence.
//
// Row subtitles are live STATE, never an explanation of what the row does
// ("Notifications, shares and requests" told the user nothing they couldn't read
// off the title). Where there is no state to report, there is no subtitle — §7.
//
// PRIVACY: counts, a username, a storage figure. No place names, no coordinates.
import {
  Fragment,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Text, View } from "react-native";
import {
  labelWithBadge,
  navBadgeNoun,
  navFor,
  navLabel,
  tripPlansBadgeCount,
  tripPlansMoreSubtitle,
  type NavId,
  type NavIdOn,
  type TripPlanSummary,
} from "@logjam/shared";

import { fetchCurrentUser, useApiQuery } from "../api/queries";
import { useAccountState } from "../auth/AccountStateContext";
import {
  capabilityRowProps,
  capabilityStatus,
  unavailableReasonText,
} from "../auth/capabilities";
import { formatBytes } from "../format";
import { useConnectivity } from "../map/connectivity";
import { readPlansList } from "../plans/plansCache";
import { onMirrorChanged } from "../sync/syncDb";
import {
  usePendingOpCount,
  usePendingSyncCount,
  useSyncIssueCount,
  useSyncStatus,
} from "../sync/useSyncQueries";
import { getSyncStatus, requestSync } from "../sync/syncEngine";
import { spacing, makeStyles, makeThemed, useTheme, muted } from "../theme";
import {
  Button,
  Hero,
  Row,
  ScreenScroll,
  Icon,
  Toast,
  todayDateKey,
  type Glyph,
  type ToastMessage,
} from "../ui";
import { syncHealth, type SyncTone } from "./syncHealth";

// Tone → the glyph and colour the headline wears. `warning` is the scheme's own
// warning token; "pending" borrows the muted text colour rather than inventing a
// third state hue, because waiting is not a problem.
const useToneStyle = makeThemed(
  (theme): Record<SyncTone, { icon: Glyph; color: string }> => ({
    ok: { icon: "success", color: theme.accent },
    info: { icon: "info", color: theme.textMuted },
    pending: { icon: "pending", color: theme.textMuted },
    problem: { icon: "warning", color: theme.warning },
  }),
);

// The row has the room to name the whole chooser; the hero's compact button
// shares a line with "No account" and a longer label truncates it.
const GUEST_SIGN_IN = "Sign in or create an account";

/** The entries of More: every Logjam GPS destination that is not a tab. */
type MoreId = Exclude<NavIdOn<"gps">, "places" | "logs" | "saved">;

const navIcon = (id: NavId) => navFor("gps").find((e) => e.id === id)!.icon;

export function MoreScreen({
  unreadCount,
  onOpenInbox,
  onOpenAccount,
  onOpenFriends,
  onOpenPlans,
  onOpenSyncIssues,
  onOpenSettings,
}: {
  unreadCount: number | null;
  onOpenInbox: () => void;
  onOpenAccount: () => void;
  onOpenFriends: () => void;
  onOpenPlans: () => void;
  onOpenSyncIssues: () => void;
  onOpenSettings: () => void;
}) {
  const theme = useTheme();
  const styles = useStyles();

  const { accountState } = useAccountState();
  const isGuest = accountState === "guest";
  // Best-effort: the hub is fully usable without it (offline, or a failed
  // fetch), so a failure costs one subtitle rather than the screen. A guest has
  // no user record to fetch at all.
  const userQuery = useApiQuery(
    fetchCurrentUser,
    "Couldn't load your account.",
    !isGuest,
  );
  const online = useConnectivity() === "online";
  const syncStatus = useSyncStatus();
  const pendingCount = usePendingSyncCount();
  const pendingOpCount = usePendingOpCount();
  const issueCount = useSyncIssueCount();
  const plans = useCachedPlansList(isGuest);
  const plansWaiting = plans ? tripPlansBadgeCount(plans) : 0;

  const health = syncHealth({
    online,
    state: syncStatus.state,
    lastSyncAt: syncStatus.lastSyncAt,
    pendingCount,
    pendingOpCount,
    issueCount,
    errorKind: syncStatus.errorKind,
    waitingSince: syncStatus.waitingSince,
    accountState,
  });
  const TONE_STYLE = useToneStyle();
  const tone = TONE_STYLE[health.tone];

  // The hero's "Sync now" says how it went. A failure already has its words (the
  // health line and its detail), so only a clean cycle is announced here.
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const syncNow = useCallback(async () => {
    await requestSync();
    if (getSyncStatus().state !== "error")
      setToast({ text: "Synced.", tone: "done", nonce: Date.now() });
  }, [setToast]);
  const user = userQuery.data;
  const syncNowStatus = capabilityStatus("syncNow", accountState, online);

  // The menu is `NAV`'s More entries in `NAV`'s order; this only says what each
  // row shows. tsc refuses an entry with no row here.
  const rows: Record<MoreId, ReactNode> = {
    // The one "something is waiting on you" signal. Files a friend sent are
    // answered inline in the inbox, so their waiting count is part of this one.
    inbox: (
      <Row
        icon={navIcon("inbox")}
        title={navLabel("inbox")}
        badge={unreadCount ?? 0}
        accessibilityLabel={labelWithBadge(navLabel("inbox"), unreadCount ?? 0)}
        onPress={onOpenInbox}
        {...capabilityRowProps("inbox", accountState, online)}
        chevron
      />
    ),
    // Read from the plans cache, which the shell's poll keeps fresh: the hub
    // fetches nothing of its own. An invite is also an unread inbox row, so it
    // badges this row, not the tab a second time.
    plans: (
      <Row
        icon={navIcon("plans")}
        title={navLabel("plans")}
        subtitle={
          plans && !plansWaiting
            ? tripPlansMoreSubtitle(plans, todayDateKey())
            : undefined
        }
        badge={plansWaiting}
        accessibilityLabel={labelWithBadge(
          navLabel("plans"),
          plansWaiting,
          navBadgeNoun("plans"),
        )}
        onPress={onOpenPlans}
        {...capabilityRowProps("plans", accountState, online)}
        chevron
      />
    ),
    friends: (
      <Row
        icon={navIcon("friends")}
        title={navLabel("friends")}
        // Managing friendships needs an account and a connection; say which in
        // place of a subtitle rather than letting the screen fail after the tap
        // (DESIGN.md).
        onPress={onOpenFriends}
        {...capabilityRowProps("friends", accountState, online)}
        chevron
      />
    ),
    // Sync issues can only exist once something has tried to sync.
    syncIssues: isGuest ? null : (
      <Row
        icon={navIcon("syncIssues")}
        hue={issueCount > 0 ? theme.warning : undefined}
        title="Account sync issues"
        badge={issueCount}
        accessibilityLabel={labelWithBadge(
          "Account sync issues",
          issueCount,
          navBadgeNoun("syncIssues"),
        )}
        onPress={onOpenSyncIssues}
        chevron
      />
    ),
    settings: (
      <Row
        icon={navIcon("settings")}
        title={navLabel("settings")}
        onPress={onOpenSettings}
        chevron
      />
    ),
    account: (
      <Row
        icon={navIcon("account")}
        // The Account row stays live for a guest: it is the way IN to an
        // account, so disabling it with "Needs an account" would be a joke at
        // the user's expense.
        title={isGuest ? GUEST_SIGN_IN : navLabel("account")}
        subtitle={
          isGuest
            ? "Back up and share what's on this phone"
            : user
              ? `${formatBytes(user.storageUsedBytes)} of ${formatBytes(user.storageQuotaBytes)} used`
              : undefined
        }
        onPress={onOpenAccount}
        chevron
      />
    ),
  };

  return (
    // Hero pinned, menu scrolls (DESIGN.md) — the menu is short today, but the rule is
    // the rule and a sixth entry shouldn't push the sync answer off screen.
    <View style={styles.root}>
      <Hero
        eyebrow={isGuest ? "Logjam GPS" : user ? "Signed in as" : "Logjam GPS"}
        title={isGuest ? "No account" : (user?.username ?? "Your account")}
        actions={
          // "Sync now" is meaningless without an account, so the hero's one
          // action becomes the way to get one — the same affordance slot, the
          // offer instead of the operation.
          isGuest ? (
            <Button
              label="Sign in"
              icon="signIn"
              variant="outlineAccent"
              compact
              // The Account page, like the row: its button asks before merging
              // this phone's data into an account.
              onPress={onOpenAccount}
            />
          ) : (
            <Button
              label="Sync now"
              icon="refresh"
              variant="outlineAccent"
              compact
              loading={syncStatus.state === "syncing"}
              disabled={syncNowStatus.status !== "available"}
              disabledReason={
                syncNowStatus.status === "available"
                  ? ""
                  : unavailableReasonText(syncNowStatus.reason)
              }
              onPress={() => void syncNow()}
            />
          )
        }
      >
        <View style={styles.health}>
          <Icon idea={tone.icon} size={18} color={tone.color} />
          <View style={styles.healthText}>
            <Text style={[styles.headline, { color: tone.color }]}>
              {health.headline}
            </Text>
            <Text style={styles.detail}>{health.detail}</Text>
          </View>
        </View>
      </Hero>

      <ScreenScroll padded={false} contentStyle={styles.menu}>
        {navFor("gps")
          .filter((entry) => !entry.tab)
          .map((entry) => (
            <Fragment key={entry.id}>{rows[entry.id as MoreId]}</Fragment>
          ))}
      </ScreenScroll>
      <Toast message={toast} onDismissed={() => setToast(null)} />
    </View>
  );
}

/** The last GET /plans, re-read whenever the cache changes; null for a guest. */
function useCachedPlansList(isGuest: boolean): TripPlanSummary[] | null {
  const [plans, setPlans] = useState<TripPlanSummary[] | null>(null);
  useEffect(() => {
    if (isGuest) return;
    const read = () =>
      readPlansList()
        .then((list) => setPlans(list?.plans ?? null))
        .catch(console.error);
    read();
    return onMirrorChanged(read);
  }, [isGuest]);
  return plans;
}

const useStyles = makeStyles((theme, textRole) => ({
  root: { flex: 1, backgroundColor: theme.page },
  // The hero runs edge to edge; only the menu takes the body padding.
  menu: { padding: spacing(2), gap: spacing(1), paddingBottom: spacing(4) },
  health: { flexDirection: "row", alignItems: "flex-start", gap: spacing(1) },
  healthText: { flex: 1, gap: spacing(0.25) },
  headline: { ...textRole.rowTitle },
  detail: { ...muted(theme, textRole.detail) },
}));
