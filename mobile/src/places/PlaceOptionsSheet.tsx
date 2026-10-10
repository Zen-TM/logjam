// The verb list for one place — the sheet the Places list opens from its
// three-dots AND the sheet the map opens when a place pin is tapped.
//
// ONE component for both, on the model of TrackOptionsSheet and for the same
// reason (DESIGN.md): a place reached by tapping its pin must not be a
// lesser object than one reached from the list.
//
// WHICH verbs, in what order and under what words is `PLACE_VERBS` in
// `@logjam/shared`, the declaration Logjam Web's menus render from too. This
// sheet only says how each one runs here. "Show on map" is the one row the
// list has and the pin does not: on the map you are already looking at it.
//
// Share is a SUB-MODE of this sheet rather than a second sheet (§6 — swap the
// content, never stack), so no caller can be the surface that forgot it. The
// two verbs that need a FORM (a trip, an edit) are the caller's, because a
// form is a sheet of its own: the caller closes this one and opens that one.
//
// PRIVACY: sharing a place is owner-only and username-only. `syncRole` is the
// single gate here — a place shared WITH this user shows the read-only hint
// and no Edit, Share or Delete, on BOTH surfaces, because the gate lives in
// this component rather than in its callers.
import { Fragment, useMemo, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";

import {
  placeDeleteConfirm,
  placeVerbs,
  removeShareConfirm,
  type PlaceVerbIdOn,
  copyAndRemoveOutcomeMessage,
  copyOutcomeMessage,
} from "@logjam/shared";

import { spacing, theme } from "../theme";
import { BottomSheet, Row } from "../ui";
import { removeSharedPlace } from "../sharing/removeShare";
import { useCopyPanel } from "../sharing/CopySheet";
import {
  copyShared,
  runCopyAndRemove,
  type CopyAndRemoveTarget,
} from "../sharing/copyAndRemove";
import { useSharePanel, useShareRowProps } from "../sharing/SharePanel";
import { requestSync } from "../sync/syncEngine";
import { useConnectivity } from "../map/connectivity";
import { useMirrorTrips } from "../sync/useSyncQueries";
import type { MirrorPlace } from "../sync/mirrorStore";
import { deletePlaceLocal } from "../sync/outbox";

type GpsPlaceVerbId = PlaceVerbIdOn<"gps">;

/** The verbs that reach the server, so they dim with the reason offline. */
const NEEDS_CONNECTION: ReadonlySet<GpsPlaceVerbId> = new Set([
  "share",
  "copy",
  "copyAndRemove",
  "remove",
]);

export function PlaceOptionsSheet({
  place,
  surface,
  visible,
  onClose,
  onGone,
  onOpenPlace,
  onShowOnMap,
  onLogTrip,
  onEdit,
  onInfo,
  onError,
}: {
  place: MirrorPlace | null;
  /** Where the sheet was opened from: a row in the list, a pin on the map, or
   *  the place's own page. */
  surface: "row" | "pin" | "page";
  visible: boolean;
  onClose: () => void;
  /** The place is no longer this account's (deleted, or removed from the
   *  share): the page showing it must leave. */
  onGone?: () => void;
  /** Its detail page — the first row, because it is what tapping a pin did. */
  onOpenPlace: (place: MirrorPlace) => void;
  /** Fly the map to this place. The list's; the pin's verbs leave it out. */
  onShowOnMap?: (place: MirrorPlace) => void;
  /**
   * Open the trip form with this place already linked. The caller's, not this
   * sheet's: a form is a sheet of its own and nothing may open a second sheet
   * over an open one (DESIGN.md), so the caller closes this and opens that.
   */
  onLogTrip: (place: MirrorPlace) => void;
  /** Open the place form. The caller's, for the same reason as `onLogTrip`. */
  onEdit: (place: MirrorPlace) => void;
  onInfo: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [sharing, setSharing] = useState(false);
  const online = useConnectivity() === "online";
  const trips = useMirrorTrips();

  const isOwner = place?.syncRole === "owner";
  // The place's own id: one added in the field is not on the server until the
  // outbox flushes, and the live-share verb dims with the reason until it is.
  const shareRowProps = useShareRowProps(online, place?.id);
  // THE sharing panel, the same one the place's detail screen renders — and
  // withheld on a place shared WITH this user, because re-sharing is the
  // owner's to do and the API refuses it. Memoised on the id: an object literal
  // reloads the hook forever (mobile/CLAUDE.md, SharePanel).
  const shareTarget = useMemo(
    () =>
      place && isOwner ? ({ kind: "place", placeId: place.id } as const) : null,
    [place, isOwner],
  );
  const share = useSharePanel({
    target: shareTarget,
    itemLabel: place?.name ?? "",
    online,
    enabled: place != null,
    active: sharing,
  });

  // THE RECIPIENT'S OTHER TWO VERBS, as a second sub-mode of this sheet for the
  // same reason sharing is one: the copy panel has a photos switch to draw and
  // §6 says swap the content, never stack a sheet on a sheet.
  //
  // No owner USERNAME here — a mirrored place carries an `ownerId` and no name
  // (`removeShareConfirm`'s own note) — so the confirms fall back to "the
  // owner" themselves, rather than this sheet inventing a lookup for one line.
  const [copyMode, setCopyMode] = useState<"copy" | "copyAndRemove" | null>(
    null,
  );
  const [copyBusy, setCopyBusy] = useState(false);

  // The sub-modes reset when the sheet closes. This component stays mounted
  // between openings — `visible` is a prop, not a remount — so a sub-mode left
  // set means the NEXT open lands inside it instead of on the verb list. That
  // has shipped twice on the sibling sheets.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (!visible) {
      setSharing(false);
      setCopyMode(null);
    }
  }

  const copyTargets = useMemo<CopyAndRemoveTarget[]>(
    () =>
      place
        ? [{ entityType: "place", entityId: place.id, title: place.name }]
        : [],
    [place],
  );

  const copy = useCopyPanel({
    active: copyMode !== null,
    targets: copyTargets,
    mode: copyMode ?? "copy",
    // No username reaches a mirrored row, so the confirms spell their own
    // fallback — in both sentence positions. Passing "the owner" here is what
    // put a lowercase word at the start of a sentence on the device.
    friendName: null,
    busy: copyBusy,
    online,
    onConfirm: (options) => {
      const [target] = copyTargets;
      if (!target) return;
      const bundled = copyMode === "copyAndRemove";
      setCopyBusy(true);
      void (async () => {
        if (bundled) {
          const outcome = await runCopyAndRemove([target], options);
          const report = copyAndRemoveOutcomeMessage(outcome);
          (report.tone === "error" ? onError : onInfo)(report.text);
          if (outcome.done.length > 0) onGone?.();
        } else {
          try {
            const media = await copyShared(target, options);
            const report = copyOutcomeMessage({
              copied: 1,
              failed: [],
              mediaSkipped: media.skipped,
              mediaOutOfSpace: media.outOfSpace,
            });
            (report.tone === "error" ? onError : onInfo)(report.text);
          } catch (err) {
            // Our own copy, never the error's: it may carry the name.
            console.error(err);
            onError("Couldn't save a copy of this place.");
          }
          // A plain copy leaves nothing locally to update, so the pull is what
          // brings the new row in. The bundled verb does its own pull mid-way.
          void requestSync().catch((syncErr: unknown) =>
            console.error(syncErr),
          );
        }
        setCopyBusy(false);
        setCopyMode(null);
        onClose();
      })();
    },
  });

  if (!place) return null;

  const close = () => {
    setSharing(false);
    setCopyMode(null);
    onClose();
  };

  const confirmRemoveShare = () => {
    const confirm = removeShareConfirm({
      kindLabel: "place",
      itemName: place.name,
    });
    close();
    Alert.alert(confirm.title, confirm.body, [
      { text: "Cancel", style: "cancel" },
      {
        // Not `destructive`: alice keeps her place, its notes and its photos.
        text: "Remove",
        onPress: () => {
          removeSharedPlace(place.id)
            .then(() => {
              onInfo("Removed.");
              onGone?.();
            })
            .catch((err: unknown) => {
              // Our own copy, never the error's: it may carry the name.
              console.error(err);
              onError("Couldn't remove this shared place.");
            });
        },
      },
    ]);
  };

  const confirmDelete = () => {
    // The sentence is per-instance — it counts the trips that lose their link —
    // and it is written once, in placeDeleteConfirm (DESIGN.md). The count
    // is derived HERE from the mirrored trips rather than passed in, so neither
    // surface can hand this dialog a number of its own.
    const linkedTrips = (trips.data ?? []).filter((trip) =>
      trip.places.some((link) => link.id === place.id),
    ).length;
    const confirm = placeDeleteConfirm({ name: place.name }, linkedTrips);
    close();
    Alert.alert(confirm.confirmTitle, confirm.confirmBody, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          deletePlaceLocal(place.id)
            .then(() => {
              onInfo("Place deleted.");
              onGone?.();
            })
            .catch((err: unknown) => {
              // Our own copy, never the error's: it may carry the name.
              console.error(err);
              onError("Couldn't delete this place.");
            });
        },
      },
    ]);
  };

  // Exhaustive by type: every verb the contract gives Logjam GPS runs here.
  // The two that need a FORM are the caller's: a form is a sheet of its own,
  // so this one closes and the caller opens that one.
  const leaveFor = (go: (place: MirrorPlace) => void) => () => {
    close();
    go(place);
  };
  const run: Record<GpsPlaceVerbId, () => void> = {
    open: leaveFor(onOpenPlace),
    show: leaveFor((target) => onShowOnMap?.(target)),
    logTrip: leaveFor(onLogTrip),
    edit: leaveFor(onEdit),
    share: () => setSharing(true),
    copy: () => setCopyMode("copy"),
    copyAndRemove: () => setCopyMode("copyAndRemove"),
    remove: confirmRemoveShare,
    delete: confirmDelete,
  };

  return (
    <BottomSheet
      visible={visible}
      // Either sub-mode backs out to the verb list; only the list closes the
      // sheet.
      onClose={
        sharing
          ? () => setSharing(false)
          : copyMode
            ? () => setCopyMode(null)
            : close
      }
      title={sharing ? share.title : copyMode ? copy.title : place.name}
      onBack={
        sharing
          ? () => setSharing(false)
          : copyMode
            ? () => setCopyMode(null)
            : undefined
      }
      footer={copyMode ? copy.footer : undefined}
    >
      {sharing ? (
        share.body
      ) : copyMode ? (
        copy.body
      ) : (
        <View style={styles.body}>
          {placeVerbs("gps", surface, isOwner).map((verb, index, all) => (
            <Fragment key={verb.id}>
              {/* A rule above the verbs that end the user's relationship with
                  the place, so parting is never next to an ordinary verb. */}
              {verb.separated && index > 0 && !all[index - 1].separated ? (
                <View style={styles.rule} />
              ) : null}
              <Row
                icon={verb.icon}
                // Only Delete wears the warning: removing a share destroys
                // nothing.
                hue={verb.danger ? theme.warning : undefined}
                title={verb.label}
                {...(NEEDS_CONNECTION.has(verb.id) ? shareRowProps : {})}
                onPress={run[verb.id]}
              />
            </Fragment>
          ))}
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing(1) },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: theme.line },
});
