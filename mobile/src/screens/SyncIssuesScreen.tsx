// Sync issues — "what couldn't be saved, and what do you want me to do about it?"
//
// The fail-loudly rule made visible (stage8-sync.md §8.4/§8.5): parked ops the
// server rejected or that lost an edit↔delete race, plus shelved conflict values.
// Nothing is ever silently dropped, and every entry has an explicit way out.
//
// LAYOUT (DESIGN.md §1, §2): hero states how many things need a decision; a rail
// partitions Parked (things that still want to happen) from Shelved (values that
// already lost). Rows, not cards with button rows — the per-entry actions live in
// an overflow sheet titled with the entry, which is the same shape as every other
// list in the app and keeps a destructive action off the row itself (§7).
//
// PRIVACY: an op's own field values are what is in question here, so a name can
// appear (user-supplied text, allowed). Never a coordinate: `previewValue`
// deliberately refuses to render latitude/longitude, which a canyon create op
// carries (§11 — a list is what ends up in a screenshot).
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Alert, FlatList, StyleSheet, Text, View } from "react-native";

import { useConnectivity } from "../map/connectivity";
import { fontSize, spacing, theme } from "../theme";
import {
  BottomSheet,
  HeroHeader,
  Row,
  SegmentedControl,
  StatusPill,
  type SegmentOption,
} from "../ui";
import { onMirrorChanged } from "../sync/syncDb";
import {
  discardParkedOp,
  dismissShelfEntry,
  getApplyFailureAt,
  listParkedOps,
  listShelfEntries,
  recreateFromDeadRemote,
  resyncFromScratch,
  retryParkedOp,
  type ParkedOp,
  type ShelfEntry,
} from "../sync/syncIssues";
import {
  discardExplanation,
  opCause,
  opTitle,
  previewValue,
  shelfTitle,
} from "./syncIssueDisplay";

type Bucket = "all" | "parked" | "shelved";

type Issue =
  | { kind: "parked"; key: string; op: ParkedOp }
  | { kind: "shelved"; key: string; entry: ShelfEntry };

export function SyncIssuesScreen({ onBack }: { onBack: () => void }) {
  const [parked, setParked] = useState<ParkedOp[]>([]);
  const [shelf, setShelf] = useState<ShelfEntry[]>([]);
  // Not an outbox row: the server sent something this app version can't apply,
  // which stops every incoming change until it is resolved. It has no Retry —
  // retrying re-fetches the same page — so it gets its own affordance.
  const [applyFailedAt, setApplyFailedAt] = useState<string | null>(null);
  const [bucket, setBucket] = useState<Bucket>("all");
  const [menuIssue, setMenuIssue] = useState<Issue | null>(null);
  // Nothing on this screen is disabled offline, and that is deliberate: every
  // action here is a LOCAL write. Discard and Recreate never touch the network,
  // and Retry only flips the op back to `queued` for the next cycle. What offline
  // does change is what Retry can honestly promise (§10).
  const online = useConnectivity() === "online";

  const load = useCallback(() => {
    Promise.all([listParkedOps(), listShelfEntries(), getApplyFailureAt()])
      .then(([parkedOps, shelfEntries, failedAt]) => {
        setParked(parkedOps);
        setShelf(shelfEntries);
        setApplyFailedAt(failedAt);
      })
      .catch((err: unknown) => console.error(err));
  }, []);

  const confirmResync = useCallback(() => {
    Alert.alert(
      "Get a fresh copy?",
      "The app downloads your canyons, trips and photos again from scratch. " +
        "Changes still waiting to upload are kept.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Download again",
          onPress: () =>
            void resyncFromScratch()
              .then(load)
              .catch((err: unknown) => console.error(err)),
        },
      ],
    );
  }, [load]);

  useEffect(() => {
    load();
    return onMirrorChanged(load);
  }, [load]);

  const act = useCallback(
    (run: Promise<unknown>) => {
      setMenuIssue(null);
      void run.then(load).catch((err: unknown) => console.error(err));
    },
    [load],
  );

  const confirmDiscard = useCallback(
    (op: ParkedOp) => {
      setMenuIssue(null);
      Alert.alert(
        "Discard this change?",
        discardExplanation(op),
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => void discardParkedOp(op.seq).then(load),
          },
        ],
      );
    },
    [load],
  );

  // Stable identities so the memoised rows don't all re-render on an unrelated
  // state change (DESIGN.md §9).
  const openMenu = useCallback((item: Issue) => setMenuIssue(item), []);
  const keyExtractor = useCallback((item: Issue) => item.key, []);
  const renderItem = useCallback(
    ({ item }: { item: Issue }) => <IssueRow item={item} onMenu={openMenu} />,
    [openMenu],
  );

  const items = useMemo<Issue[]>(() => {
    const parkedItems: Issue[] = parked.map((op) => ({
      kind: "parked",
      key: `parked:${op.seq}`,
      op,
    }));
    const shelvedItems: Issue[] = shelf.map((entry) => ({
      kind: "shelved",
      key: `shelf:${entry.id}`,
      entry,
    }));
    if (bucket === "parked") return parkedItems;
    if (bucket === "shelved") return shelvedItems;
    // Parked first: those still want to happen, shelved values already lost.
    return [...parkedItems, ...shelvedItems];
  }, [bucket, parked, shelf]);

  const total = parked.length + shelf.length + (applyFailedAt ? 1 : 0);
  const buckets: SegmentOption<Bucket>[] = [
    { value: "all", label: "All", count: total },
    { value: "parked", label: "Parked", count: parked.length, disabled: parked.length === 0 },
    {
      value: "shelved",
      label: "Shelved",
      count: shelf.length,
      disabled: shelf.length === 0,
    },
  ];

  return (
    <View style={styles.root}>
      <HeroHeader
        eyebrow="Sync issues"
        title={
          parked.length > 0 || applyFailedAt
            ? "Needs a decision"
            : total > 0
              ? "Nothing blocked"
              : "All clear"
        }
        onBack={onBack}
        value={String(total)}
        valueSuffix={total === 1 ? "entry" : "entries"}
      />

      {total > 0 ? (
        <View style={styles.rail}>
          <SegmentedControl options={buckets} value={bucket} onChange={setBucket} scroll />
        </View>
      ) : null}

      {applyFailedAt ? (
        <View style={styles.rail}>
          <Row
            icon="alert-octagon"
            hue={theme.warning}
            title="This phone couldn't apply an update"
            subtitle="Nothing new is arriving. Download a fresh copy to fix it."
            titleNumberOfLines={2}
            onPress={confirmResync}
            right={<StatusPill label="Stuck" tone="warning" />}
          />
        </View>
      ) : null}

      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={items}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListHeaderComponent={
          bucket === "shelved" && shelf.length > 0 ? (
            <Text style={styles.sectionHint}>
              Values overwritten by a change made elsewhere. Cleared automatically
              after 30 days.
            </Text>
          ) : null
        }
        ListEmptyComponent={<EmptyPanel bucket={bucket} />}
      />

      {/* Per-entry actions, titled with the entry (§7). */}
      <BottomSheet
        visible={menuIssue !== null}
        onClose={() => setMenuIssue(null)}
        title={menuIssue ? issueTitle(menuIssue) : ""}
      >
        {menuIssue?.kind === "parked" ? (
          <View style={styles.menuBody}>
            <Text style={styles.menuCause}>{opCause(menuIssue.op)}</Text>
            {menuIssue.op.state === "deadRemote" ? (
              <Row
                icon="rotate-ccw"
                title="Recreate it"
                onPress={() => act(recreateFromDeadRemote(menuIssue.op.seq))}
              />
            ) : (
              <Row
                icon="refresh-cw"
                title={online ? "Try again" : "Queue it again"}
                subtitle={online ? undefined : "It goes up when you have signal."}
                onPress={() => act(retryParkedOp(menuIssue.op.seq))}
              />
            )}
            <Row
              icon="trash-2"
              hue={theme.warning}
              title="Discard this change"
              onPress={() => confirmDiscard(menuIssue.op)}
            />
          </View>
        ) : null}
        {menuIssue?.kind === "shelved" ? (
          <View style={styles.menuBody}>
            <Text style={styles.menuCause}>
              Yours: {previewValue(menuIssue.entry.field, menuIssue.entry.shelvedValue)}
            </Text>
            <Text style={styles.menuCause}>
              Kept: {previewValue(menuIssue.entry.field, menuIssue.entry.serverValue)}
            </Text>
            <Row
              icon="check"
              title="Dismiss"
              onPress={() => act(dismissShelfEntry(menuIssue.entry.id))}
            />
          </View>
        ) : null}
      </BottomSheet>
    </View>
  );
}

function issueTitle(issue: Issue): string {
  if (issue.kind === "parked") return opTitle(issue.op);
  return shelfTitle(issue.entry);
}

// Memoised, with a callback that takes the item rather than closing over it —
// DESIGN.md §9.
const IssueRow = memo(function IssueRow({
  item,
  onMenu,
}: {
  item: Issue;
  onMenu: (item: Issue) => void;
}) {
  if (item.kind === "parked") {
    const dead = item.op.state === "deadRemote";
    return (
      <Row
        icon="alert-triangle"
        hue={theme.warning}
        title={opTitle(item.op)}
        subtitle={opCause(item.op)}
        titleNumberOfLines={2}
        onPress={() => onMenu(item)}
        right={<StatusPill label={dead ? "Gone" : "Rejected"} tone="warning" />}
      />
    );
  }
  return (
    <Row
      icon="archive"
      title={shelfTitle(item.entry)}
      subtitle={`Kept: ${previewValue(item.entry.field, item.entry.serverValue)}`}
      onPress={() => onMenu(item)}
      right={<StatusPill label="Shelved" tone="muted" />}
    />
  );
});

function EmptyPanel({ bucket }: { bucket: Bucket }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>
        {bucket === "shelved" ? "Nothing shelved" : "No sync issues"}
      </Text>
      <Text style={styles.emptyHint}>
        {bucket === "shelved"
          ? "A value replaced by an edit made elsewhere would be kept here."
          : "Changes the server can't accept would wait here for you. Nothing does."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.primary },
  rail: { paddingHorizontal: spacing(2), paddingTop: spacing(1.5), paddingBottom: spacing(1.5) },
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing(2), gap: spacing(1), paddingBottom: spacing(4) },
  sectionHint: { color: theme.textMuted, fontSize: fontSize.sm, paddingBottom: spacing(1) },
  menuBody: { gap: spacing(1) },
  menuCause: { color: theme.textMuted, fontSize: fontSize.sm },
  empty: { alignItems: "center", gap: spacing(1), paddingVertical: spacing(6) },
  emptyTitle: { color: theme.textPrimary, fontSize: fontSize.base },
  emptyHint: {
    color: theme.textMuted,
    fontSize: fontSize.sm,
    textAlign: "center",
    paddingHorizontal: spacing(2),
  },
});
