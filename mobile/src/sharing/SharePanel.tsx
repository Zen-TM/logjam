// THE sharing panel. One component, both verbs, every kind of item.
//
// Canyons, waypoints, routes, LiDAR topos, GeoPDFs, imports and recorded
// tracks all render this — from Saved's item sheet, the route sheet, the track
// sheet, the map's waypoint sheet and the canyon detail screen. The only
// per-kind parts are the API calls behind `target` and the sentence describing
// what the recipient gets; the layout, the search, the recipient list, the
// empty states and the offline door live here once.
//
// TWO VERBS, ONE PANEL, AND THE WORDING IS THE DIFFERENCE:
//
//   Share ("share"/"canyon" targets) — a LIVE, revocable view of a row the
//     sender still owns. Tapping a friend acts IMMEDIATELY, because the action
//     can be taken back; there is no confirm step and no footer button.
//   Send a copy ("copy" target) — a FILE handed over. Tapping a friend ticks a
//     box and NOTHING happens until the footer button fires, because the send
//     cannot be undone and a mis-tap must not be the whole action.
//
// A user who believes a sent file can be taken back has been misled by this
// screen, so the two never borrow each other's words: the promise banner at the
// top states which one this is, in that verb's own terms, before the list.
//
// It is a HOOK returning `{ title, body, footer }` rather than a plain
// component because a sheet's primary action belongs in `BottomSheet`'s pinned
// `footer` (DESIGN.md §6) — a Send button that scrolls away behind a long
// friend list leaves the drag handle as the only exit, and the handle means
// discard. Callers spread the three pieces onto the sheet they already own;
// nothing opens a second sheet.
//
// PRIVACY: usernames only, never email — the friends endpoints are
// username-only server-side and this must not become the surface that wants
// more. Error copy is OURS, never the server's message.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";

import { messageFromError, type SharableEntityType } from "@logjam/shared";

import { useAccountState } from "../auth/AccountStateContext";
import {
  capabilityRowProps,
  capabilityStatus,
  unavailableReasonText,
} from "../auth/capabilities";
import { getFriends, getCanyonShares, shareCanyon, unshareCanyon, type Friend } from "../api/friends";
import { getShares, shareItem, unshareItem } from "../api/shares";
import { sendFileCopy } from "../api/fileSends";
import type { AssetActions } from "../saved/assetActions";
import { Button, ErrorBanner, SectionHeader, Row } from "../ui";
import { fontSize, lineHeight, radius, spacing, surface, theme, withAlpha } from "../theme";
import { FriendAvatar } from "./FriendAvatar";
import { friendMatches } from "./friendSearch";
import {
  RecipientRows,
  SharingError,
  shareRowSubtitle,
  useSharing,
  type SharingCalls,
} from "./useSharing";

/**
 * What this panel is acting on. The three cases are the three API shapes:
 * canyons keep their own endpoints (the hybrid share model lives behind them),
 * every other shareable row uses `/shares`, and a file has no server row to
 * grant access to at all — it can only be copied.
 */
export type SharePanelTarget =
  | { kind: "entity"; entityType: SharableEntityType; entityId: string }
  | { kind: "canyon"; canyonId: string }
  | { kind: "copy"; sendCopy: NonNullable<AssetActions["sendCopy"]> };

/**
 * THE PROMISE, per kind, and the only place either sentence is written.
 *
 * Not a prop: two call sites wording the same grant differently is the drift
 * this panel exists to end, and a canyon is now shared from two screens (its
 * detail page and the Canyons list's options sheet). A canyon sharee sees
 * notes and photos — a bigger promise than a line on a map — so it says so,
 * and says what stays private.
 */
const SHARE_BLURB =
  "Friends you pick can view and export this. They can't change it, and you can stop sharing whenever you like.";
const CANYON_SHARE_BLURB =
  "Friends you pick can see this canyon, its notes and its photos. Your trip logs stay private. You can stop sharing whenever you like.";

/**
 * Row props for a Share / Send a copy verb: `disabled` plus the REASON as a
 * subtitle when the verb cannot run right now.
 *
 * Both verbs need the network — a grant is not an outbox operation and a send
 * is an upload — so offline the row is dimmed and says "Needs a connection"
 * rather than disappearing or opening a panel that can only apologise
 * (DESIGN.md §10). Sharing is also the FIRST thing on most saved items that
 * needs a connection at all, which is why the row has to say so itself.
 *
 * One helper rather than six call sites reaching for `capabilityRowProps`,
 * because six sites is six chances to pick a different capability or forget the
 * guest case (`needs-account` beats `needs-connection`).
 */
export function useShareRowProps(online: boolean): {
  disabled: boolean;
  subtitle?: string;
} {
  const { accountState } = useAccountState();
  return capabilityRowProps("sharing", accountState, online);
}

export function useSharePanel({
  target,
  itemLabel,
  online,
  enabled = true,
  active = true,
  onSent,
}: {
  /** Null while the caller has nothing selected — body and footer are null. */
  target: SharePanelTarget | null;
  /** The item's own name, for the title and the confirm copy. */
  itemLabel: string;
  online: boolean;
  /** Gates the recipient load: false while the item is not on screen at all. */
  enabled?: boolean;
  /** True while the PANEL is what the sheet is showing — gates the friend load. */
  active?: boolean;
  /** A copy left the device. The caller closes the sheet and says so. */
  onSent?: (recipientCount: number) => void;
}): { title: string; body: React.ReactNode; footer: React.ReactNode | null; sharing: ReturnType<typeof useSharing> } {
  const isCopy = target?.kind === "copy";

  // WHAT the target is, as primitives. Every caller builds `target` as an
  // object literal in its render, so its identity changes on every pass —
  // depending on the object itself made the reset effect below fire on each
  // render and clear the user's ticks as fast as they made them (a tap on a
  // friend appeared to do nothing at all). Deps are keyed on these instead.
  const canyonId = target?.kind === "canyon" ? target.canyonId : null;
  const entityType = target?.kind === "entity" ? target.entityType : null;
  const entityId = target?.kind === "entity" ? target.entityId : null;
  const targetKey =
    target?.kind === "copy"
      ? `copy:${target.sendCopy.sourceKind}:${target.sendCopy.filename}`
      : (canyonId ?? (entityId ? `${entityType}:${entityId}` : null));

  // The API calls are the only per-kind part. A copy target has none, and its
  // sharing state is never read — `enabled` below keeps it from ever loading.
  const calls = useMemo((): SharingCalls => {
    if (canyonId) {
      return {
        load: () => getCanyonShares(canyonId),
        grant: (userId) => shareCanyon(canyonId, userId),
        revoke: (userId) => unshareCanyon(canyonId, userId),
      };
    }
    if (entityType && entityId) {
      return {
        load: () => getShares(entityType, entityId),
        grant: (userId) => shareItem(entityType, entityId, userId),
        revoke: (userId) => unshareItem(entityType, entityId, userId),
      };
    }
    return NO_CALLS;
  }, [canyonId, entityId, entityType]);

  const sharing = useSharing({
    calls,
    online,
    enabled: enabled && target != null && !isCopy,
    itemLabel,
    revokeBody: (): string =>
      canyonId
        ? `They'll lose access to ${itemLabel} and its photos.`
        : `They'll no longer see ${itemLabel}.`,
  });

  const friends = useFriendList({ active: active && target != null, online });
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(EMPTY_SELECTION);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // A different item is a different pick. Without this, backing out of one
  // send and opening another arrives with the first one's ticks in place.
  useEffect(() => {
    setSelected(EMPTY_SELECTION);
    setSendError(null);
    setQuery("");
  }, [targetKey]);

  const sendCopy = target?.kind === "copy" ? target.sendCopy : null;
  const send = useCallback(async () => {
    if (!sendCopy) return;
    setSending(true);
    setSendError(null);
    let cleanup: (() => Promise<void>) | undefined;
    try {
      const file = await sendCopy.resolveFile();
      cleanup = file.cleanup;
      await sendFileCopy({
        fileUri: file.uri,
        filename: sendCopy.filename,
        sourceKind: sendCopy.sourceKind,
        recipientIds: [...selected],
      });
      onSent?.(selected.size);
    } catch (err) {
      console.error(err);
      setSendError(messageFromError(err, "Couldn't send that file."));
    } finally {
      // The track scratch file goes whether the send worked or not; an
      // import's stored original has no cleanup and is never touched.
      await cleanup?.().catch(() => {});
      setSending(false);
    }
  }, [onSent, selected, sendCopy]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (target == null) {
    return { title: itemLabel, body: null, footer: null, sharing };
  }

  const search = (
    <SearchField value={query} onChangeText={setQuery} disabled={sending} />
  );

  if (target.kind === "copy") {
    // The closed door names itself rather than the panel vanishing
    // (DESIGN.md §10) — a feature that comes and goes is worse than one that
    // says why. Sharing's capability covers this: a guest has no friends and
    // no endpoint that would answer, and offline it cannot work at all.
    if (friends.status.status === "unavailable") {
      return {
        title: `Send a copy of ${itemLabel}`,
        body: <ClosedDoor text={unavailableReasonText(friends.status.reason)} />,
        footer: null,
        sharing,
      };
    }
    const shown = (friends.list ?? []).filter((friend) =>
      friendMatches(friend.username, query),
    );
    return {
      title: `Send a copy of ${itemLabel}`,
      sharing,
      body: (
        <View style={styles.body}>
          {sendError ? <ErrorBanner message={sendError} /> : null}
          {friends.error ? (
            <ErrorBanner message={friends.error} onRetry={friends.retry} />
          ) : null}
          {/* The promise, stated plainly and in the warning hue, because it
              cannot be undone: this is where a user learns Send is not Share. */}
          <PromiseBanner
            tone="copy"
            text={`They'll get their own copy of ${target.sendCopy.filename} to keep. It becomes theirs — you can't take it back, and changes you make later won't reach them.`}
          />
          {search}
          <SectionHeader label="Send to" />
          <FriendRows
            friends={friends.list}
            shown={shown}
            query={query}
            mode="select"
            selectedIds={selected}
            disabled={sending}
            onPress={(friend) => toggle(friend.id)}
            emptyText="No friends yet — add friends from the More tab."
          />
        </View>
      ),
      footer: (
        <Button
          label={selected.size === 0 ? "Send a copy" : `Send a copy to ${selected.size}`}
          icon="send"
          onPress={() => void send()}
          disabled={selected.size === 0 || sending}
          loading={sending}
        />
      ),
    };
  }

  if (!sharing.canShare) {
    return {
      title: `Share ${itemLabel}`,
      body: <ClosedDoor text={shareRowSubtitle(sharing) ?? "Sharing isn't available."} />,
      footer: null,
      sharing,
    };
  }

  const recipients = (sharing.recipients ?? []).filter((recipient) =>
    friendMatches(recipient.sharedWith.username, query),
  );
  // `shareable`, not every friend: someone who already has it belongs in the
  // list above with a revoke button, not in the one that grants.
  const shareable = (friends.list ?? []).filter(
    (friend) => !sharing.sharedIds.has(friend.id),
  );
  const shown = shareable.filter((friend) => friendMatches(friend.username, query));

  return {
    title: `Share ${itemLabel}`,
    sharing,
    footer: null,
    body: (
      <View style={styles.body}>
        <SharingError sharing={sharing} />
        {friends.error ? (
          <ErrorBanner message={friends.error} onRetry={friends.retry} />
        ) : null}
        <PromiseBanner
          tone="share"
          text={canyonId ? CANYON_SHARE_BLURB : SHARE_BLURB}
        />
        {search}
        {recipients.length > 0 ? (
          <>
            <SectionHeader label={`Shared with · ${recipients.length}`} />
            <RecipientRows sharing={sharing} recipients={recipients} />
          </>
        ) : null}
        <SectionHeader label="Share with" />
        <FriendRows
          friends={friends.list && shareable}
          shown={shown}
          query={query}
          mode="grant"
          busyId={sharing.busyId}
          onPress={(friend) => {
            void sharing.grant(friend);
          }}
          emptyText={
            (friends.list?.length ?? 0) === 0
              ? "No friends yet — add friends from the More tab."
              : "All your friends already have access."
          }
        />
      </View>
    ),
  };
}

/** A share target that is never called — a copy target has no share state. */
const NO_CALLS: SharingCalls = {
  load: () => Promise.reject(new Error("no share target")),
  grant: () => Promise.reject(new Error("no share target")),
  revoke: () => Promise.reject(new Error("no share target")),
};

const EMPTY_SELECTION: ReadonlySet<string> = new Set<string>();

/**
 * The friend list, loaded once the panel is on screen and not before — a
 * sheet that is closed (or a guest, who has no friends and no endpoint that
 * would answer) issues no request.
 */
function useFriendList({ active, online }: { active: boolean; online: boolean }) {
  const [list, setList] = useState<Friend[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A failed load leaves `list` null and changes none of the other deps, so
  // without this the effect never runs again: the panel showed "Couldn't load
  // friends." until the whole sheet was closed and reopened. Bumping the
  // attempt is the retry.
  const [attempt, setAttempt] = useState(0);
  const { accountState } = useAccountState();
  const status = capabilityStatus("sharing", accountState, online);
  const available = status.status === "available";

  useEffect(() => {
    if (!active || !available || list !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const friends = await getFriends();
        if (!cancelled) setList(friends);
      } catch (err) {
        console.error(err);
        if (!cancelled) setError(messageFromError(err, "Couldn't load friends."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, available, list, attempt]);

  const retry = useCallback(() => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  return { list, error, status, retry };
}

function FriendRows({
  friends,
  shown,
  query,
  mode,
  selectedIds,
  busyId,
  disabled = false,
  onPress,
  emptyText,
}: {
  /** null = still loading. */
  friends: Friend[] | null;
  /** Those matching the current query. */
  shown: Friend[];
  query: string;
  mode: "grant" | "select";
  selectedIds?: ReadonlySet<string>;
  busyId?: string | null;
  disabled?: boolean;
  onPress: (friend: Friend) => void;
  /** What to say when there is nobody to offer. Per-surface wording. */
  emptyText: string;
}) {
  if (friends === null) {
    return <ActivityIndicator color={theme.accent} style={styles.spinner} />;
  }
  if (friends.length === 0) {
    return <Text style={styles.muted}>{emptyText}</Text>;
  }
  if (shown.length === 0) {
    // Distinct from `emptyText`: "nobody matches what you typed" is a dead end
    // you can back out of, "you have no friends" is not.
    return <Text style={styles.muted}>No friends match “{query.trim()}”.</Text>;
  }
  return (
    <>
      {shown.map((friend) => {
        const selected = selectedIds?.has(friend.id) ?? false;
        const busy = busyId === friend.id;
        return (
          <Row
            key={friend.id}
            leading={<FriendAvatar username={friend.username} selected={selected} />}
            title={friend.username}
            selected={selected}
            accessibilityLabel={
              mode === "select"
                ? `${friend.username}${selected ? ", selected" : ""}`
                : `Share with ${friend.username}`
            }
            onPress={
              disabled || busy || (mode === "grant" && busyId != null)
                ? undefined
                : () => onPress(friend)
            }
            right={
              busy ? (
                <ActivityIndicator color={theme.accent} />
              ) : (
                // In select mode the tick IS the state of the row; in grant
                // mode a tap is the whole interaction, and a checkbox there
                // would imply a pending one.
                <Feather
                  name={mode === "select" ? (selected ? "check-circle" : "circle") : "plus-circle"}
                  size={20}
                  color={selected ? theme.accent : theme.textMuted}
                />
              )
            }
          />
        );
      })}
    </>
  );
}

/**
 * What happens when you pick someone, before you pick them. Accent for a grant
 * you can undo, warning for a copy you cannot — the colour carries the
 * difference for anyone who reads the panel rather than the sentence.
 */
function PromiseBanner({ tone, text }: { tone: "share" | "copy"; text: string }) {
  const hue = tone === "copy" ? theme.warning : theme.accent;
  return (
    <View
      style={[
        styles.promise,
        { backgroundColor: withAlpha(hue, 0.12), borderColor: withAlpha(hue, 0.5) },
      ]}
    >
      <Feather
        name={tone === "copy" ? "alert-triangle" : "eye"}
        size={18}
        color={hue}
        style={styles.promiseIcon}
      />
      <Text style={styles.promiseText}>{text}</Text>
    </View>
  );
}

/** The reason, in place of the panel. DESIGN.md §10 — never a blank space. */
function ClosedDoor({ text }: { text: string }) {
  return <Text style={styles.muted}>{text}</Text>;
}

function SearchField({
  value,
  onChangeText,
  disabled,
}: {
  value: string;
  onChangeText: (next: string) => void;
  disabled: boolean;
}) {
  return (
    <View style={styles.search}>
      <Feather name="search" size={18} color={theme.textMuted} />
      <TextInput
        style={styles.searchInput}
        value={value}
        onChangeText={onChangeText}
        editable={!disabled}
        placeholder="Search friends"
        placeholderTextColor={theme.textMuted}
        accessibilityLabel="Search friends"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />
      {value.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChangeText("")}
        >
          <Feather name="x" size={18} color={theme.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing(1) },
  muted: { color: theme.textMuted, fontSize: fontSize.sm },
  spinner: { alignSelf: "flex-start" },
  promise: {
    flexDirection: "row",
    gap: spacing(1),
    alignItems: "flex-start",
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing(1.5),
  },
  promiseIcon: { marginTop: 1 },
  promiseText: {
    flex: 1,
    color: theme.textPrimary,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.tight,
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1),
    backgroundColor: surface.card,
    borderWidth: 1,
    borderColor: surface.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing(1.5),
    minHeight: 44,
  },
  searchInput: {
    flex: 1,
    color: theme.textPrimary,
    fontSize: fontSize.base,
    paddingVertical: spacing(1),
  },
});
