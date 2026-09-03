// Account sync issues — "what didn't save, and what do you want me to do?"
//
// ONE LIST, and the merge is the point (2026-09-02). It used to be two tabs:
// Stuck, a change that never reached the server, and Lost, a value that reached
// it and was then beaten by another device's. That split described OUR
// mechanism. To the person reading it both rows say the same thing — a change I
// made is not in my account — and only one of them was being counted, so the
// silent loss was the one nobody was told about. Both are counted now
// (`countSyncIssues`), both are actionable, and nothing on this screen expires:
// a countdown to deleting the last copy of someone's writing is the exact
// failure this page exists to prevent.
//
// WHAT REACHES THIS SCREEN IS WHAT THE APP CANNOT DO ITSELF. A rejection the
// server might answer differently next time (503, 429, a dropped connection)
// is the engine's problem, not the user's: `flush.ts` parks it as `retrying`
// and the cycle comes back for it, up to PUSH_MAX_ATTEMPTS. So a row here is
// either a refusal about the request, a row deleted under the edit, a value
// another device overwrote, or something that has already failed five times —
// which is why the sheet's retry copy can say how many attempts the app spent
// before asking.
//
// PROSE IS RATIONED, NOT BANNED. This page should be rare, and a user who
// reaches it is confused by definition — so a sheet says what the change WAS
// (`opChanges`), why it failed, what happens if they ignore it, and offers the
// fix as a row rather than as an instruction to go and find something. The list
// rows stay one line of cause: the explaining happens where the deciding does.
// The converse rule holds too — where a row below the prose does the thing, the
// prose telling the user to go and do it is deleted.
//
// LAYOUT (DESIGN.md §1, §2, §7): hero states the count; the rail holds the
// one-line hint and becomes the multi-select bar in place, at the same height,
// so the list cannot jump; rows carry a ⋯ that becomes the selection checkbox,
// in the same 40pt box, so nothing resizes there either.
//
// TWO GROUP VERBS, not one: a selection can hold both kinds at once now that
// one list holds both, and Try again and Restore are different verbs on
// different subsets. Each is labelled with its own tally in the count line
// (§7's amended extra-verb rule).
//
// PRIVACY: an op's own field values are what is in question here, so a name can
// appear (user-supplied text, allowed). Never a coordinate: `previewValue`
// deliberately refuses to render latitude/longitude, which a canyon create op
// carries (§11 — a list is what ends up in a screenshot).
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, StyleSheet, Text, View } from "react-native";

import { useConnectivity } from "../map/connectivity";
import { fontSize, spacing, theme } from "../theme";
import {
  BottomSheet,
  HeroHeader,
  IconButton,
  Row,
  SEGMENTED_CONTROL_HEIGHT,
  SelectionBar,
  SelectionMark,
  StatusPill,
  Toast,
  useBulkSelection,
  type ToastMessage,
} from "../ui";
import { onMirrorChanged } from "../sync/syncDb";
import { getMirrorTrip, type MirrorTrip } from "../sync/mirrorStore";
import {
  discardParkedOp,
  dismissShelfEntry,
  getApplyFailureAt,
  keepBothShelfValue,
  listParkedOps,
  listShelfEntries,
  recreateFromDeadRemote,
  restoreShelfValue,
  resyncFromScratch,
  retryParkedOp,
  retryWithoutFields,
  type ParkedOp,
  type ShelfEntry,
} from "../sync/syncIssues";
import {
  bulkDiscardBody,
  canRecreate,
  fieldLabel,
  discardExplanation,
  opAdvice,
  opChanges,
  opTarget,
  opTitle,
  previewValue,
  rejectedFields,
  restoreBlockReason,
  restoreConfirmBody,
  restoreSubtitle,
  salvageableFields,
  selectionCountLabel,
  shelfExplanation,
  shelfSubtitle,
  shelfTitle,
} from "./syncIssueDisplay";
import { relativeTime } from "./syncHealth";

type Issue =
  | { kind: "stuck"; key: string; op: ParkedOp }
  | { kind: "lost"; key: string; entry: ShelfEntry };

/** Everything here is discardable, so everything is pickable (§7's converse). */
const alwaysSelectable = () => true;
const issueKey = (item: Issue) => item.key;

export function SyncIssuesScreen({
  onBack,
  onOpenCanyon,
  onOpenTrip,
}: {
  onBack: () => void;
  /** The "open it and make the change a way that works" a permanent rejection
   *  needs — pushed inside the More stack, so Back comes back here. */
  onOpenCanyon: (canyonId: string) => void;
  onOpenTrip: (trip: MirrorTrip) => void;
}) {
  const [parked, setParked] = useState<ParkedOp[]>([]);
  const [shelf, setShelf] = useState<ShelfEntry[]>([]);
  // Not an outbox row: the server sent something this app version can't apply,
  // which stops every incoming change until it is resolved. It has no Retry —
  // retrying re-fetches the same page — so it gets its own affordance.
  const [applyFailedAt, setApplyFailedAt] = useState<string | null>(null);
  const [menuIssue, setMenuIssue] = useState<Issue | null>(null);
  // ONE toast channel for every outcome (DESIGN.md §6). A row leaving the list
  // is the only feedback most of these actions have, and "it vanished" is not
  // the same message as "it worked" — especially for Try again, where the row
  // disappearing means the change finally landed.
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const notify = useCallback(
    (text: string, tone: ToastMessage["tone"] = "info") =>
      setToast({ text, tone, nonce: Date.now() }),
    [],
  );
  // Nothing on this screen is disabled offline, and that is deliberate: every
  // action here is a LOCAL write. Discard, Recreate, Restore and Keep both
  // never touch the network, and Try again only flips the op back to `queued`
  // for the next cycle. What offline changes is what Try again can promise.
  const online = useConnectivity() === "online";

  // Every action fires SEVERAL loads — the write's own `notifyMirrorChanged`,
  // the enqueue's, and the explicit one in `act` — and they are not guaranteed
  // to resolve in the order they started. The earliest one winning is what left
  // a row on screen after Keep both had already deleted it: the list only
  // corrected itself when the user left and came back. Last load STARTED wins.
  const loadToken = useRef(0);
  const load = useCallback(() => {
    const token = (loadToken.current += 1);
    Promise.all([listParkedOps(), listShelfEntries(), getApplyFailureAt()])
      .then(([parkedOps, shelfEntries, failedAt]) => {
        if (token !== loadToken.current) return;
        setParked(parkedOps);
        setShelf(shelfEntries);
        setApplyFailedAt(failedAt);
      })
      .catch((err: unknown) => console.error(err));
  }, []);

  const confirmResync = useCallback(() => {
    Alert.alert(
      "Get a fresh copy?",
      "Re-downloads your canyons, trips and photos from scratch. " +
        "Uploads still waiting are kept.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Download again",
          onPress: () =>
            void resyncFromScratch()
              .then(() => {
                notify("Downloading a fresh copy…");
                load();
              })
              .catch((err: unknown) => console.error(err)),
        },
      ],
    );
  }, [load, notify]);

  useEffect(() => {
    load();
    return onMirrorChanged(load);
  }, [load]);

  const act = useCallback(
    (run: Promise<unknown>, done: string, tone: ToastMessage["tone"] = "info") => {
      setMenuIssue(null);
      void run
        .then(() => {
          notify(done, tone);
          load();
        })
        .catch((err: unknown) => {
          console.error(err);
          notify("That didn't work. Try again in a moment.", "error");
        });
    },
    [load, notify],
  );

  // Stuck first, then lost: a change that still wants to happen is worth more of
  // the reader's attention than one that already went.
  const items = useMemo<Issue[]>(
    () => [
      ...parked.map((op): Issue => ({ kind: "stuck", key: `stuck:${op.seq}`, op })),
      ...shelf.map((entry): Issue => ({ kind: "lost", key: `lost:${entry.id}`, entry })),
    ],
    [parked, shelf],
  );

  // Multi-select: the same hook and bar as Canyons, Logs, Saved and the Inbox.
  const {
    selectedKeys,
    clearSelection,
    selectItem,
    selectAll,
    selectedItems,
    selectableItems,
    selecting,
  } = useBulkSelection({
    items,
    keyOf: issueKey,
    isDeletable: alwaysSelectable,
  });

  const selectedStuck = useMemo(
    () => selectedItems.flatMap((item) => (item.kind === "stuck" ? [item.op] : [])),
    [selectedItems],
  );
  const selectedLost = useMemo(
    () => selectedItems.flatMap((item) => (item.kind === "lost" ? [item.entry] : [])),
    [selectedItems],
  );
  const retryable = useMemo(
    () => selectedStuck.filter((op) => opAdvice(op).canRetry),
    [selectedStuck],
  );
  const restorable = useMemo(
    () => selectedLost.filter((entry) => entry.restoreBlock === null),
    [selectedLost],
  );

  const runRetry = useCallback(() => {
    // Not destructive, so the selection stays: the rows are all still there and
    // the obvious next move is another verb on the same set (§7).
    void Promise.all(retryable.map((op) => retryParkedOp(op.seq)))
      .then(() => {
        notify(
          online
            ? `${retryable.length === 1 ? "Change" : `${retryable.length} changes`} sent again.`
            : `${retryable.length === 1 ? "Change" : `${retryable.length} changes`} queued. They go up when you have signal.`,
        );
        load();
      })
      .catch((err: unknown) => console.error(err));
  }, [load, notify, online, retryable]);

  const confirmBulkRestore = useCallback(() => {
    // Restoring is a clobber on every device, and in bulk it is a clobber the
    // user cannot read one value at a time — so it confirms, like the delete
    // beside it, and the body says what it costs.
    Alert.alert(
      restorable.length === 1 ? "Restore this value?" : `Restore ${restorable.length} values?`,
      // A one-row selection gets the same quoted value the sheet's own confirm
      // gives it: the bar is a different route to the same irreversible write,
      // not a reason to say less about it.
      restoreConfirmBody(
        restorable.length,
        restorable.length === 1 && typeof restorable[0].serverValue === "string"
          ? restorable[0].serverValue
          : undefined,
      ),
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Restore",
          onPress: () => {
            void Promise.all(restorable.map((entry) => restoreShelfValue(entry.id)))
              .then(() => {
                notify(
                  restorable.length === 1
                    ? "Value restored."
                    : `${restorable.length} values restored.`,
                );
                clearSelection();
                load();
              })
              .catch((err: unknown) => {
                console.error(err);
                notify("Couldn't restore those.", "error");
              });
          },
        },
      ],
    );
  }, [clearSelection, load, notify, restorable]);

  /** The bulk delete: discard for stuck rows, forget for lost ones. */
  const discardSelected = useCallback(() => {
    const uploadCount = selectedStuck.filter((op) => op.entity === "media").length;
    const body = bulkDiscardBody({
      editCount: selectedStuck.length - uploadCount,
      uploadCount,
      lostCount: selectedLost.length,
    });
    const total = selectedStuck.length + selectedLost.length;
    Alert.alert(total === 1 ? "Discard this?" : `Discard ${total} entries?`, body, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => {
          void Promise.all([
            ...selectedStuck.map((op) => discardParkedOp(op.seq)),
            ...selectedLost.map((entry) => dismissShelfEntry(entry.id)),
          ])
            .then(() => {
              clearSelection();
              notify(total === 1 ? "Discarded." : `${total} entries discarded.`);
              load();
            })
            .catch((err: unknown) => console.error(err));
        },
      },
    ]);
  }, [clearSelection, load, notify, selectedLost, selectedStuck]);

  /**
   * Send the fields the server did not object to, and drop the ones it did.
   * Confirms, because the dropped values are deleted — the sheet behind the
   * dialog is showing them, which is the whole reason this is safe to offer.
   */
  const confirmSendRest = useCallback(
    (op: ParkedOp) => {
      setMenuIssue(null);
      const dropped = rejectedFields(op);
      const kept = salvageableFields(op);
      Alert.alert(
        "Send the rest?",
        `${listFields(kept)} ${kept.length === 1 ? "is" : "are"} saved to your account. ` +
          `${listFields(dropped)} ${dropped.length === 1 ? "is" : "are"} deleted — ` +
          `${dropped.length === 1 ? "it's" : "they're"} what your account refused.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Send the rest",
            onPress: () =>
              void retryWithoutFields(op.seq, dropped)
                .then(() => {
                  notify(
                    online
                      ? "Sending the rest of that change…"
                      : "Queued. It goes up when you have signal.",
                  );
                  load();
                })
                .catch((err: unknown) => {
                  console.error(err);
                  notify("That didn't work. Try again in a moment.", "error");
                }),
          },
        ],
      );
    },
    [load, notify, online],
  );

  const confirmDiscard = useCallback(
    (op: ParkedOp) => {
      setMenuIssue(null);
      Alert.alert("Discard this change?", discardExplanation(op), [
        { text: "Cancel", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () =>
            void discardParkedOp(op.seq)
              .then(() => {
                notify(
                  op.entity === "media"
                    ? "Upload deleted from this phone."
                    : "Change discarded.",
                );
                load();
              })
              .catch((err: unknown) => console.error(err)),
        },
      ]);
    },
    [load, notify],
  );

  const confirmForget = useCallback(
    (entry: ShelfEntry) => {
      setMenuIssue(null);
      Alert.alert(
        "Discard this value?",
        "This is the only copy left of what you typed. It can't be got back.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () =>
              void dismissShelfEntry(entry.id)
                .then(() => {
                  notify("Value discarded.");
                  load();
                })
                .catch((err: unknown) => console.error(err)),
          },
        ],
      );
    },
    [load, notify],
  );

  const confirmRestore = useCallback(
    (entry: ShelfEntry) => {
      setMenuIssue(null);
      // The value about to be destroyed is quoted in the dialog: this is the
      // last moment it exists anywhere, and the sheet that was showing it has
      // closed behind the alert.
      const replacing =
        typeof entry.serverValue === "string" ? entry.serverValue : undefined;
      Alert.alert("Restore this value?", restoreConfirmBody(1, replacing), [
        { text: "Cancel", style: "cancel" },
        {
          text: "Restore",
          onPress: () =>
            void restoreShelfValue(entry.id)
              .then(() => {
                notify(
                  online
                    ? "Value restored. It'll reach your other devices next sync."
                    : "Value restored on this phone. It syncs when you have signal.",
                );
                load();
              })
              .catch((err: unknown) => {
                console.error(err);
                notify("Couldn't restore that value.", "error");
              }),
        },
      ]);
    },
    [load, notify, online],
  );

  const openTarget = useCallback(
    (op: ParkedOp) => {
      const target = opTarget(op);
      if (!target) return;
      setMenuIssue(null);
      if (target.kind === "canyon") {
        onOpenCanyon(target.id);
        return;
      }
      void getMirrorTrip(target.id).then((trip) => {
        // The row can outlive the trip — the mirror is refetched under it — so
        // say so rather than pushing a screen with nothing in it.
        if (trip) onOpenTrip(trip);
        else notify("That trip isn't on this phone any more.", "error");
      });
    },
    [notify, onOpenCanyon, onOpenTrip],
  );

  // Stable identities so the memoised rows don't all re-render on an unrelated
  // state change (DESIGN.md §9).
  const openMenu = useCallback((item: Issue) => setMenuIssue(item), []);
  const renderItem = useCallback(
    ({ item }: { item: Issue }) => (
      <IssueRow
        item={item}
        onMenu={openMenu}
        onToggle={selectItem}
        selecting={selecting}
        selected={selectedKeys.includes(item.key)}
      />
    ),
    [openMenu, selectItem, selectedKeys, selecting],
  );

  const total = parked.length + shelf.length + (applyFailedAt ? 1 : 0);

  return (
    <View style={styles.root}>
      <HeroHeader
        eyebrow="Account sync issues"
        title={total > 0 ? "Some changes need you" : "Everything's synced"}
        onBack={onBack}
        value={total === 1 ? "1 change" : `${total} changes`}
      />

      {total > 0 ? (
        // ONE rail, always the same height: the hint when idle, the bar while
        // selecting. Rendering the bar only when it appears is what made the
        // list jump under the finger that started the selection.
        <View style={styles.rail}>
          {selecting ? (
            <SelectionBar
              countLabel={selectionCountLabel({
                selected: selectedItems.length,
                retryCount: retryable.length,
                restoreCount: restorable.length,
              })}
              showSelectAll={selectedItems.length < selectableItems.length}
              extra={
                <>
                  {retryable.length > 0 ? (
                    <IconButton
                      icon="refresh-cw"
                      accessibilityLabel={
                        online
                          ? `Try ${retryable.length} selected changes again`
                          : `Queue ${retryable.length} selected changes again`
                      }
                      color={theme.accent}
                      onPress={runRetry}
                    />
                  ) : null}
                  {restorable.length > 0 ? (
                    <IconButton
                      icon="corner-up-left"
                      accessibilityLabel={`Restore ${restorable.length} selected values`}
                      color={theme.accent}
                      onPress={confirmBulkRestore}
                    />
                  ) : null}
                </>
              }
              onClear={clearSelection}
              onSelectAll={selectAll}
              onDelete={discardSelected}
            />
          ) : (
            <View style={styles.railHint}>
              <Text style={styles.railHintText} numberOfLines={2}>
                These changes aren&apos;t in your account. Tap one to see what it was.
              </Text>
            </View>
          )}
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
        keyExtractor={issueKey}
        renderItem={renderItem}
        ListEmptyComponent={<EmptyPanel />}
      />

      {/* Per-entry actions, titled with the entry (§7). */}
      <BottomSheet
        visible={menuIssue !== null}
        onClose={() => setMenuIssue(null)}
        title={menuIssue ? issueTitle(menuIssue) : ""}
      >
        {menuIssue?.kind === "stuck" ? (
          <StuckMenu
            op={menuIssue.op}
            online={online}
            onOpen={openTarget}
            onRetry={(op) =>
              act(
                retryParkedOp(op.seq),
                online ? "Sending it again…" : "Queued. It goes up when you have signal.",
              )
            }
            onRecreate={(op) =>
              act(
                recreateFromDeadRemote(op.seq),
                op.entity === "canyon"
                  ? "Canyon recreated with your change."
                  : "Waypoint recreated with your change.",
              )
            }
            onSendRest={confirmSendRest}
            onDiscard={confirmDiscard}
          />
        ) : null}
        {menuIssue?.kind === "lost" ? (
          <LostMenu
            entry={menuIssue.entry}
            onRestore={confirmRestore}
            onKeepBoth={(entry) =>
              act(keepBothShelfValue(entry.id), "Both kept — your text was added below.")
            }
            onForget={confirmForget}
          />
        ) : null}
      </BottomSheet>

      <Toast message={toast} onDismissed={() => setToast(null)} />
    </View>
  );
}

function StuckMenu({
  op,
  online,
  onOpen,
  onRetry,
  onRecreate,
  onSendRest,
  onDiscard,
}: {
  op: ParkedOp;
  online: boolean;
  onOpen: (op: ParkedOp) => void;
  onRetry: (op: ParkedOp) => void;
  onRecreate: (op: ParkedOp) => void;
  onSendRest: (op: ParkedOp) => void;
  onDiscard: (op: ParkedOp) => void;
}) {
  const advice = opAdvice(op);
  const changes = opChanges(op);
  const target = opTarget(op);
  const salvageable = salvageableFields(op);
  return (
    <View style={styles.menuBody}>
      {/* What the change actually WAS. Without it every sentence on this screen
          is about an edit the user is being asked to judge unseen. */}
      {changes.length > 0 ? (
        <View style={styles.valueBlock}>
          <Text style={styles.menuLabel}>What you changed</Text>
          {changes.map((change) => (
            <Text
              key={change.label}
              style={[styles.menuValue, change.rejected && styles.menuValueRejected]}
              selectable
            >
              {change.label}: {change.value}
            </Text>
          ))}
        </View>
      ) : null}
      <Text style={styles.menuCause}>{advice.line}</Text>
      {advice.hint ? <Text style={styles.menuCause}>{advice.hint}</Text> : null}
      {/* Offered only when it will really recreate — `recreateFromDeadRemote`
          quietly discards anything it can't rebuild, and a button that says
          "recreated" while deleting the change is the worst row on the page. */}
      {canRecreate(op) ? (
        <Row
          icon="rotate-ccw"
          title={op.entity === "canyon" ? "Recreate canyon" : "Recreate waypoint"}
          subtitle={
            op.entity === "canyon"
              ? "Makes a new canyon from this phone's copy, with your change."
              : "Makes a new waypoint, with your change."
          }
          onPress={() => onRecreate(op)}
        />
      ) : null}
      {/* The good half of a rejected edit. Only when we can NAME the bad field
          (`rejectedFields` runs the shared range rules rather than reading the
          server's English), so this never re-sends something that parks again. */}
      {salvageable.length > 0 ? (
        <Row
          icon="send"
          title={salvageable.length === 1 ? "Send the other change" : "Send the other changes"}
          subtitle={`Saves ${listFields(salvageable)}, and drops ${listFields(rejectedFields(op))}.`}
          onPress={() => onSendRest(op)}
        />
      ) : null}
      {/* The action instead of the instruction: a permanent rejection names a
          field, and this is the screen the user has to fix it on. */}
      {target && !advice.canRetry && op.state !== "deadRemote" ? (
        <Row
          icon="external-link"
          title={target.kind === "canyon" ? "Open the canyon and fix it" : "Open the trip and fix it"}
          subtitle="Change it there, and it'll save."
          onPress={() => onOpen(op)}
        />
      ) : null}
      {/* Absent, not dimmed, when a retry could only fail the same way. */}
      {advice.canRetry ? (
        <Row
          icon="refresh-cw"
          title={online ? "Try again" : "Queue it again"}
          subtitle={online ? undefined : "It goes up when you have signal."}
          onPress={() => onRetry(op)}
        />
      ) : null}
      <Row
        icon="trash-2"
        hue={theme.warning}
        title="Discard this change"
        onPress={() => onDiscard(op)}
      />
    </View>
  );
}

function LostMenu({
  entry,
  onRestore,
  onKeepBoth,
  onForget,
}: {
  entry: ShelfEntry;
  onRestore: (entry: ShelfEntry) => void;
  onKeepBoth: (entry: ShelfEntry) => void;
  onForget: (entry: ShelfEntry) => void;
}) {
  // The other device's value is absent when it CLEARED the field — there is no
  // "Kept" to show, and a block reading "(empty)" was three lines of chrome
  // around nothing.
  const hasKept = entry.serverValue !== null;
  return (
    <View style={styles.menuBody}>
      <Text style={styles.menuCause}>{shelfExplanation(entry)}</Text>
      {/* Labelled by which value is LIVE, not by whose it is — both are the
          user's. Selectable rather than a Copy button: RN's own text selection
          is the platform's copy affordance and costs no dependency. */}
      <View style={styles.valueBlock}>
        <Text style={styles.menuLabel}>Discarded</Text>
        <Text style={styles.menuValue} selectable>
          {previewValue(entry.field, entry.shelvedValue)}
        </Text>
      </View>
      {hasKept ? (
        <View style={styles.valueBlock}>
          <Text style={styles.menuLabel}>Kept</Text>
          <Text style={styles.menuValue} selectable>
            {previewValue(entry.field, entry.serverValue)}
          </Text>
        </View>
      ) : null}
      <Text style={styles.menuCause}>
        {hasKept
          ? "Press and hold either value to copy it."
          : "Press and hold the value to copy it."}
      </Text>
      {/* Keep both first: it is the only way out of this sheet that destroys
          nothing, so it goes above the one that does. */}
      {entry.canKeepBoth ? (
        <Row
          icon="git-merge"
          title="Keep both"
          subtitle="Appends the discarded text to what's there now."
          onPress={() => onKeepBoth(entry)}
        />
      ) : null}
      {entry.restoreBlock === null ? (
        <Row
          icon="corner-up-left"
          title="Restore the discarded value"
          subtitle={restoreSubtitle(entry)}
          onPress={() => onRestore(entry)}
        />
      ) : (
        <Text style={styles.menuCause}>{restoreBlockReason(entry)}</Text>
      )}
      <Row
        icon="trash-2"
        hue={theme.warning}
        title="Discard this value"
        onPress={() => onForget(entry)}
      />
    </View>
  );
}

/** "notes and longest abseil" — field labels for a sentence. */
function listFields(fields: string[]): string {
  const labels = fields.map(fieldLabel);
  if (labels.length <= 1) return labels[0] ?? "nothing";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

function issueTitle(issue: Issue): string {
  if (issue.kind === "stuck") return opTitle(issue.op);
  return shelfTitle(issue.entry);
}

// Memoised, with callbacks that take the item rather than closing over it —
// DESIGN.md §9.
const IssueRow = memo(function IssueRow({
  item,
  onMenu,
  onToggle,
  selecting,
  selected,
}: {
  item: Issue;
  onMenu: (item: Issue) => void;
  onToggle: (item: Issue) => void;
  selecting: boolean;
  selected: boolean;
}) {
  const now = Date.now();
  const openOrToggle = () => (selecting ? onToggle(item) : onMenu(item));
  // The ⋯ and the checkbox share one 40pt box, so entering the mode cannot
  // resize a row and shift the list under the finger that started it (§7).
  const trailing = selecting ? (
    <SelectionMark selected={selected} />
  ) : (
    <IconButton
      icon="more-horizontal"
      accessibilityLabel="What can I do about this?"
      onPress={() => onMenu(item)}
    />
  );
  if (item.kind === "stuck") {
    const advice = opAdvice(item.op);
    return (
      <Row
        icon="alert-triangle"
        hue={theme.warning}
        title={opTitle(item.op)}
        subtitle={`${advice.line} · ${relativeTime(item.op.createdAt, now)}`}
        titleNumberOfLines={2}
        selected={selected}
        onPress={openOrToggle}
        onLongPress={() => onToggle(item)}
        right={trailing}
      />
    );
  }
  return (
    <Row
      icon="alert-triangle"
      hue={theme.warning}
      title={shelfTitle(item.entry)}
      subtitle={shelfSubtitle(item.entry, now)}
      titleNumberOfLines={2}
      selected={selected}
      onPress={openOrToggle}
      onLongPress={() => onToggle(item)}
      right={trailing}
    />
  );
});

function EmptyPanel() {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>Nothing to sort out</Text>
      <Text style={styles.emptyHint}>
        Every change you&apos;ve made has reached your account.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.primary },
  rail: { paddingHorizontal: spacing(2), paddingTop: spacing(1.5), paddingBottom: spacing(1.5) },
  // Matches the SelectionBar it swaps with, so the list below cannot move.
  railHint: { height: SEGMENTED_CONTROL_HEIGHT, justifyContent: "center" },
  railHintText: { color: theme.textMuted, fontSize: fontSize.sm, lineHeight: 17 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing(2), gap: spacing(1), paddingBottom: spacing(4) },
  menuBody: { gap: spacing(1) },
  menuCause: { color: theme.textMuted, fontSize: fontSize.sm },
  valueBlock: { gap: spacing(0.25) },
  menuLabel: { color: theme.textMuted, fontSize: fontSize.xs },
  menuValue: { color: theme.textPrimary, fontSize: fontSize.base },
  // The line the rejection is about, so two changes over one complaint stop
  // being a guessing game.
  menuValueRejected: { color: theme.warning },
  empty: { alignItems: "center", gap: spacing(1), paddingVertical: spacing(6) },
  emptyTitle: { color: theme.textPrimary, fontSize: fontSize.base },
  emptyHint: {
    color: theme.textMuted,
    fontSize: fontSize.sm,
    textAlign: "center",
    paddingHorizontal: spacing(2),
  },
});
