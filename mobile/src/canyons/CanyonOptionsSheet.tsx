// The verb list for one canyon — the sheet the Canyons list opens from its
// three-dots AND the sheet the map opens when a canyon pin is tapped.
//
// ONE component for both, on the model of TrackOptionsSheet and for the same
// reason (DESIGN.md §7): a canyon reached by tapping its pin must not be a
// lesser object than one reached from the list. Tapping a pin used to go
// straight to the detail screen, which meant the map offered exactly one of
// this list's six verbs; "Open canyon" is now the first row, because it is what
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
// PRIVACY: sharing a canyon is owner-only and username-only. `syncRole` is the
// single gate here — a canyon shared WITH this user shows the read-only hint
// and no Edit, Share or Delete, on BOTH surfaces, because the gate lives in
// this component rather than in its callers.
import { useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { fontSize, spacing, theme } from "../theme";
import { BottomSheet, Row } from "../ui";
import { SHARED_READ_ONLY_HINT } from "../saved/assetActions";
import { useSharePanel, useShareRowProps } from "../sharing/SharePanel";
import { useConnectivity } from "../map/connectivity";
import { useMirrorTrips } from "../sync/useSyncQueries";
import type { MirrorCanyon } from "../sync/mirrorStore";
import { deleteCanyonLocal } from "../sync/outbox";
import { canyonDeleteConfirm } from "./canyonDeleteConfirm";

export function CanyonOptionsSheet({
  canyon,
  visible,
  onClose,
  onOpenCanyon,
  onShowOnMap,
  onLogTrip,
  onEdit,
  onInfo,
  onError,
}: {
  canyon: MirrorCanyon | null;
  visible: boolean;
  onClose: () => void;
  /** Its detail page — the first row, because it is what tapping a pin did. */
  onOpenCanyon: (canyon: MirrorCanyon) => void;
  /**
   * Fly the map to this canyon. List-only — the map surface omits it, because
   * the user got here by tapping the pin (DESIGN.md §7: "Show on map" is the
   * one row the two surfaces may differ by).
   */
  onShowOnMap?: (canyon: MirrorCanyon) => void;
  /**
   * Open the trip form with this canyon already linked. The caller's, not this
   * sheet's: a form is a sheet of its own and nothing may open a second sheet
   * over an open one (§6), so the caller closes this and opens that.
   */
  onLogTrip: (canyon: MirrorCanyon) => void;
  /** Open the canyon form. The caller's, for the same reason as `onLogTrip`. */
  onEdit: (canyon: MirrorCanyon) => void;
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

  const isOwner = canyon?.syncRole === "owner";
  // The canyon's own id: one added in the field is not on the server until the
  // outbox flushes, and the live-share verb dims with the reason until it is.
  const shareRowProps = useShareRowProps(online, canyon?.id);
  // THE sharing panel, the same one the canyon's detail screen renders — and
  // withheld on a canyon shared WITH this user, because re-sharing is the
  // owner's to do and the API refuses it. Memoised on the id: an object literal
  // reloads the hook forever (mobile/CLAUDE.md, SharePanel).
  const shareTarget = useMemo(
    () => (canyon && isOwner ? ({ kind: "canyon", canyonId: canyon.id } as const) : null),
    [canyon, isOwner],
  );
  const share = useSharePanel({
    target: shareTarget,
    itemLabel: canyon?.name ?? "",
    online,
    enabled: canyon != null,
    active: sharing,
  });

  if (!canyon) return null;

  const close = () => {
    setSharing(false);
    onClose();
  };

  const confirmDelete = () => {
    // The sentence is per-instance — it counts the trips that lose their link —
    // and it is written once, in canyonDeleteConfirm (DESIGN.md §7). The count
    // is derived HERE from the mirrored trips rather than passed in, so neither
    // surface can hand this dialog a number of its own.
    const linkedTrips = (trips.data ?? []).filter((trip) =>
      trip.canyons.some((link) => link.id === canyon.id),
    ).length;
    const confirm = canyonDeleteConfirm(canyon.name, linkedTrips);
    close();
    Alert.alert(confirm.confirmTitle, confirm.confirmBody, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          deleteCanyonLocal(canyon.id)
            .then(() => onInfo("Canyon deleted."))
            .catch((err: unknown) => {
              // Our own copy, never the error's: it may carry the name.
              console.error(err);
              onError("Couldn't delete this canyon.");
            });
        },
      },
    ]);
  };

  return (
    <BottomSheet
      visible={visible}
      // The sub-mode backs out to the verb list; only the list closes the sheet.
      onClose={sharing ? () => setSharing(false) : close}
      title={sharing ? share.title : canyon.name}
      onBack={sharing ? () => setSharing(false) : undefined}
    >
      {sharing ? (
        share.body
      ) : (
        <View style={styles.body}>
          {/* Edit, Share and Delete are all absent below on someone else's
              canyon, and three verbs vanishing with nothing said reads as a
              broken sheet. Same sentence as every other kind. */}
          {isOwner ? null : <Text style={styles.hint}>{SHARED_READ_ONLY_HINT}</Text>}
          <Row
            icon="book-open"
            title="Open canyon"
            onPress={() => {
              close();
              onOpenCanyon(canyon);
            }}
          />
          {/* The one row the two surfaces differ by. */}
          {onShowOnMap ? (
            <Row
              icon="map"
              title="Show on map"
              onPress={() => {
                close();
                onShowOnMap(canyon);
              }}
            />
          ) : null}
          <Row
            icon="edit-3"
            title="Log a trip here"
            onPress={() => {
              close();
              onLogTrip(canyon);
            }}
          />
          {isOwner ? (
            <>
              <Row
                icon="edit-2"
                title="Edit canyon"
                onPress={() => {
                  close();
                  onEdit(canyon);
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
                title="Delete canyon"
                onPress={confirmDelete}
              />
            </>
          ) : null}
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing(1) },
  hint: { color: theme.textMuted, fontSize: fontSize.xs },
});
