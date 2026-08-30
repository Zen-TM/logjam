// More tab — the hub for the surfaces folded off the tab bar (Inbox, Friends,
// Sync issues, Settings, Account).
//
// A hub is a menu, and a menu is not very interesting. What makes this screen
// worth opening is the ONE question it can answer that no other screen owns:
// "is my work safe?" (DESIGN.md §10). Every other tab is about canyons, trips or
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
// PRIVACY: counts, a username, a storage figure. No canyon names, no coordinates.
import { Feather } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { fetchCurrentUser, useApiQuery } from "../api/queries";
import { useAccountState } from "../auth/AccountStateContext";
import { capabilityRowProps, capabilityStatus } from "../auth/capabilities";
import { formatBytes } from "../format";
import { useConnectivity } from "../map/connectivity";
import {
  usePendingSyncCount,
  useSyncIssueCount,
  useSyncStatus,
} from "../sync/useSyncQueries";
import { requestSync } from "../sync/syncEngine";
import { fontSize, fontWeight, spacing, theme } from "../theme";
import { Button, HeroHeader, Row, ScreenScroll, StatusPill } from "../ui";
import { syncHealth, type SyncTone } from "./syncHealth";

// Tone → the glyph and colour the headline wears. `warning` is the scheme's own
// warning token; "pending" borrows the muted text colour rather than inventing a
// third state hue, because waiting is not a problem.
const TONE_STYLE: Record<
  SyncTone,
  { icon: React.ComponentProps<typeof Feather>["name"]; color: string }
> = {
  ok: { icon: "check-circle", color: theme.accent },
  pending: { icon: "clock", color: theme.textMuted },
  problem: { icon: "alert-triangle", color: theme.warning },
};

export function MoreScreen({
  unreadCount,
  onOpenInbox,
  onOpenAccount,
  onOpenFriends,
  onOpenSyncIssues,
  onOpenSettings,
}: {
  unreadCount: number | null;
  onOpenInbox: () => void;
  onOpenAccount: () => void;
  onOpenFriends: () => void;
  onOpenSyncIssues: () => void;
  onOpenSettings: () => void;
}) {
  const { accountState, linkAccount } = useAccountState();
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
  const issueCount = useSyncIssueCount();

  const health = syncHealth({
    online,
    state: syncStatus.state,
    lastSyncAt: syncStatus.lastSyncAt,
    pendingCount,
    issueCount,
    errorKind: syncStatus.errorKind,
    accountState,
  });
  const tone = TONE_STYLE[health.tone];
  const user = userQuery.data;

  return (
    // Hero pinned, menu scrolls (§2) — the menu is short today, but the rule is
    // the rule and a sixth entry shouldn't push the sync answer off screen.
    <View style={styles.root}>
      <HeroHeader
        eyebrow={isGuest ? "Logjam" : user ? "Signed in as" : "Logjam"}
        title={isGuest ? "No account" : (user?.username ?? "Your account")}
        action={
          // "Sync now" is meaningless without an account, so the hero's one
          // action becomes the way to get one — the same affordance slot, the
          // offer instead of the operation.
          isGuest ? (
            <Button
              label="Create account"
              icon="user-plus"
              variant="outlineAccent"
              compact
              onPress={linkAccount}
            />
          ) : (
            <Button
              label="Sync now"
              icon="refresh-cw"
              variant="outlineAccent"
              compact
              loading={syncStatus.state === "syncing"}
              disabled={
                capabilityStatus("syncNow", accountState, online).status !==
                "available"
              }
              onPress={() => void requestSync()}
            />
          )
        }
      >
        <View style={styles.health}>
          <Feather name={tone.icon} size={18} color={tone.color} />
          <View style={styles.healthText}>
            <Text style={[styles.headline, { color: tone.color }]}>{health.headline}</Text>
            <Text style={styles.detail}>{health.detail}</Text>
          </View>
        </View>
      </HeroHeader>

      <ScreenScroll padded={false} contentStyle={styles.menu}>
        {/* The ONE "something is waiting on you" signal. Files a friend sent
            used to have a row of their own here; they are answered inline in
            the inbox now, so their waiting count is part of this one. */}
        <Row
          icon="inbox"
          title="Inbox"
          subtitle={unreadCount ? `${unreadCount} unread` : "Nothing new"}
          onPress={onOpenInbox}
          {...capabilityRowProps("inbox", accountState, online)}
          right={
            <Trailing
              badge={unreadCount ? <StatusPill label={String(unreadCount)} tone="accent" /> : null}
            />
          }
        />
        <Row
          icon="users"
          title="Friends"
          // Managing friendships needs an account and a connection; say which
          // in place of a subtitle rather than letting the screen fail after
          // the tap (§10).
          onPress={onOpenFriends}
          {...capabilityRowProps("friends", accountState, online)}
          right={<Trailing />}
        />
        {/* Sync issues can only exist once something has tried to sync. */}
        {isGuest ? null : (
          <Row
            icon="alert-triangle"
            hue={issueCount > 0 ? theme.warning : undefined}
            title="Sync issues"
            subtitle={
              issueCount > 0
                ? `${issueCount} ${issueCount === 1 ? "needs" : "need"} your attention`
                : "Nothing waiting on you"
            }
            onPress={onOpenSyncIssues}
            right={
              <Trailing
                badge={
                  issueCount > 0 ? (
                    <StatusPill label={String(issueCount)} tone="warning" />
                  ) : null
                }
              />
            }
          />
        )}
        <Row icon="settings" title="Settings" onPress={onOpenSettings} right={<Trailing />} />
        <Row
          icon="user"
          // The Account row stays live for a guest: it is the way IN to an
          // account, so disabling it with "Needs an account" would be a joke at
          // the user's expense.
          title={isGuest ? "Create an account" : "Account"}
          subtitle={
            isGuest
              ? "Back up and share what's on this phone"
              : user
                ? `${formatBytes(user.storageUsedBytes)} of ${formatBytes(user.storageQuotaBytes)} used`
                : undefined
          }
          onPress={onOpenAccount}
          right={<Trailing />}
        />
      </ScreenScroll>
    </View>
  );
}

/** Optional badge, then the chevron — the §5 trailing order. */
function Trailing({ badge }: { badge?: React.ReactNode }) {
  return (
    <View style={styles.trailing}>
      {badge}
      <Feather name="chevron-right" size={20} color={theme.textMuted} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.primary },
  // The hero runs edge to edge; only the menu takes the body padding.
  menu: { padding: spacing(2), gap: spacing(1), paddingBottom: spacing(4) },
  health: { flexDirection: "row", alignItems: "flex-start", gap: spacing(1) },
  healthText: { flex: 1, gap: spacing(0.25) },
  headline: { fontSize: fontSize.base, fontWeight: fontWeight.medium },
  detail: { color: theme.textMuted, fontSize: fontSize.sm },
  trailing: { flexDirection: "row", alignItems: "center", gap: spacing(1) },
});
