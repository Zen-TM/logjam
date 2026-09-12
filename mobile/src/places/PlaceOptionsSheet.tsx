// The verb list for one place — the sheet the Places list opens from its
// three-dots AND the sheet the map opens when a place pin is tapped.
//
// ONE component for both, on the model of TrackOptionsSheet and for the same
// reason (DESIGN.md §7): a place reached by tapping its pin must not be a
// lesser object than one reached from the list. Tapping a pin used to go
// straight to the detail screen, which meant the map offered exactly one of
// this list's six verbs; "Open place" is now the first row, because it is what
// the tap used to do.
//
// `onShowOnMap` is the ONE row that is list-only: on the map you are already
// looking at the pin you tapped.
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
import { useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";

import { removeShareConfirm } from "@logjam/shared";

import { spacing, theme } from "../theme";
import { BottomSheet, Row } from "../ui";
import { removeSharedPlace } from "../sharing/removeShare";
import { useCopyPanel } from "../sharing/CopySheet";
import {
  copyShared,
  runCopyAndRemove,
  type CopyAndRemoveTarget,
} from "../sharing/copyAndRemove";
import { copyAndRemoveOutcomeMessage, copyOutcomeMessage } from "../sharing/friendShareRows";
import { useSharePanel, useShareRowProps } from "../sharing/SharePanel";
import { requestSync } from "../sync/syncEngine";
import { useConnectivity } from "../map/connectivity";
import { useMirrorTrips } from "../sync/useSyncQueries";
import type { MirrorPlace } from "../sync/mirrorStore";
import { deletePlaceLocal } from "../sync/outbox";
import { placeDeleteConfirm } from "./placeDeleteConfirm";

export function PlaceOptionsSheet({
  place,
  visible,
  onClose,
  onOpenPlace,
  onShowOnMap,
  onLogTrip,
  onEdit,
  onInfo,
  onError,
}: {
  place: MirrorPlace | null;
  visible: boolean;
  onClose: () => void;
  /** Its detail page — the first row, because it is what tapping a pin did. */
  onOpenPlace: (place: MirrorPlace) => void;
  /**
   * Fly the map to this place. List-only — the map surface omits it, because
   * the user got here by tapping the pin (DESIGN.md §7: "Show on map" is the
   * one row the two surfaces may differ by).
   */
  onShowOnMap?: (place: MirrorPlace) => void;
  /**
   * Open the trip form with this place already linked. The caller's, not this
   * sheet's: a form is a sheet of its own and nothing may open a second sheet
   * over an open one (§6), so the caller closes this and opens that.
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

  // The sub-mode resets when the sheet closes. This component stays mounted
  // between openings — `visible` is a prop, not a remount — so a sub-mode left
  // set means the NEXT open lands inside it instead of on the verb list. That
  // has shipped twice on the sibling sheets.
  useEffect(() => {
    if (!visible) setSharing(false);
  }, [visible]);

  const isOwner = place?.syncRole === "owner";
  // The place's own id: one added in the field is not on the server until the
  // outbox flushes, and the live-share verb dims with the reason until it is.
  const shareRowProps = useShareRowProps(online, place?.id);
  // THE sharing panel, the same one the place's detail screen renders — and
  // withheld on a place shared WITH this user, because re-sharing is the
  // owner's to do and the API refuses it. Memoised on the id: an object literal
  // reloads the hook forever (mobile/CLAUDE.md, SharePanel).
  const shareTarget = useMemo(
    () => (place && isOwner ? ({ kind: "place", placeId: place.id } as const) : null),
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
  const [copyMode, setCopyMode] = useState<"copy" | "copyAndRemove" | null>(null);
  const [copyBusy, setCopyBusy] = useState(false);
  useEffect(() => {
    if (!visible) setCopyMode(null);
  }, [visible]);

  const copyTargets = useMemo<CopyAndRemoveTarget[]>(
    () =>
      place ? [{ entityType: "place", entityId: place.id, title: place.name }] : [],
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
          void requestSync().catch((syncErr: unknown) => console.error(syncErr));
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
            .then(() => onInfo("Removed."))
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
    // and it is written once, in placeDeleteConfirm (DESIGN.md §7). The count
    // is derived HERE from the mirrored trips rather than passed in, so neither
    // surface can hand this dialog a number of its own.
    const linkedTrips = (trips.data ?? []).filter((trip) =>
      trip.places.some((link) => link.id === place.id),
    ).length;
    const confirm = placeDeleteConfirm(place.name, linkedTrips);
    close();
    Alert.alert(confirm.confirmTitle, confirm.confirmBody, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          deletePlaceLocal(place.id)
            .then(() => onInfo("Place deleted."))
            .catch((err: unknown) => {
              // Our own copy, never the error's: it may carry the name.
              console.error(err);
              onError("Couldn't delete this place.");
            });
        },
      },
    ]);
  };

  return (
    <BottomSheet
      visible={visible}
      // Either sub-mode backs out to the verb list; only the list closes the
      // sheet.
      onClose={
        sharing ? () => setSharing(false) : copyMode ? () => setCopyMode(null) : close
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
          <Row
            icon="book-open"
            title="Open place"
            onPress={() => {
              close();
              onOpenPlace(place);
            }}
          />
          {/* The one row the two surfaces differ by. */}
          {onShowOnMap ? (
            <Row
              icon="map"
              title="Show on map"
              onPress={() => {
                close();
                onShowOnMap(place);
              }}
            />
          ) : null}
          <Row
            icon="edit-3"
            title="Log a trip here"
            onPress={() => {
              close();
              onLogTrip(place);
            }}
          />
          {isOwner ? (
            <>
              <Row
                icon="edit-2"
                title="Edit place"
                onPress={() => {
                  close();
                  onEdit(place);
                }}
              />
              <Row
                icon="share-2"
                title="Share"
                {...shareRowProps}
                onPress={() => setSharing(true)}
              />
              <Row
                icon="trash-2"
                hue={theme.warning}
                title="Delete place"
                onPress={confirmDelete}
              />
            </>
          ) : (
            // The recipient's own verbs, in the slot the owner's Edit / Share /
            // Delete take. This sheet IS the place's options button, so a
            // shared place has to be keepable and removable from here and not
            // only from its detail screen — the sheet used to explain the
            // missing owner verbs with a sentence instead of offering the ones
            // that are the sharee's.
            //
            // Copy sits ABOVE Remove deliberately: the bundled verb between
            // them is the recoverable path through the destructive one, and a
            // user who reads the list top to bottom meets it before the tap
            // that cannot be undone.
            <>
              <Row
                icon="copy"
                title="Save a copy"
                {...shareRowProps}
                onPress={() => setCopyMode("copy")}
              />
              <Row
                icon="archive"
                title="Save a copy and remove"
                {...shareRowProps}
                onPress={() => setCopyMode("copyAndRemove")}
              />
              <Row
                icon="x-circle"
                hue={theme.warning}
                title="Remove from my account"
                {...shareRowProps}
                onPress={confirmRemoveShare}
              />
            </>
          )}
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing(1) },
});
