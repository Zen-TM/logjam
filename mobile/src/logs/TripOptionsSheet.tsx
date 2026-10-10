// The verb list for one trip — the sheet the Logs list opens from a row AND the
// one a trip's own page opens from its ⋯. One component for both, so a trip
// reached from its page is not a lesser object than one in the logbook.
//
// WHICH verbs, in what order and under what words is `TRIP_VERBS` in
// `@logjam/shared`, the declaration Logjam Web's menus render from too. This
// sheet only says how each one runs here. A form is a sheet of its own, so
// Edit is the caller's: this one closes and the caller opens that one.
import { Fragment } from "react";
import { Alert, StyleSheet, View } from "react-native";

import {
  tripDeleteConfirm,
  tripTitle,
  tripVerbs,
  type TripVerbId,
} from "@logjam/shared";

import type { MirrorTrip } from "../sync/mirrorStore";
import { deleteTripLocal } from "../sync/outbox";
import { theme } from "../theme";
import { BottomSheet, Row } from "../ui";

export function TripOptionsSheet({
  trip,
  surface,
  onClose,
  onOpen,
  onEdit,
  onInfo,
  onError,
  onGone,
}: {
  /** The trip whose verbs these are; null while the sheet is closed. */
  trip: MirrorTrip | null;
  /** Where the sheet was opened from: a row in the logbook, or the trip's page. */
  surface: "row" | "page";
  onClose: () => void;
  /** Its page. The row's first verb; the page leaves it out. */
  onOpen?: (trip: MirrorTrip) => void;
  /** Open the trip form. The caller's, because a form is a sheet of its own. */
  onEdit: (trip: MirrorTrip) => void;
  onInfo: (message: string) => void;
  onError: (message: string) => void;
  /** The trip is deleted: a page showing it must leave. */
  onGone?: () => void;
}) {
  const confirmDelete = (target: MirrorTrip) => {
    const confirm = tripDeleteConfirm(1);
    Alert.alert(confirm.confirmTitle, confirm.confirmBody, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          deleteTripLocal(target.id)
            .then(() => {
              onInfo("Trip deleted.");
              onGone?.();
            })
            .catch((err: unknown) => {
              console.error(err);
              onError("Couldn't delete this trip.");
            });
        },
      },
    ]);
  };

  // Exhaustive by type: every verb the contract names runs here. The sheet
  // closes first, so nothing opens over an open sheet.
  const run = (id: TripVerbId, target: MirrorTrip) => {
    onClose();
    if (id === "open") onOpen?.(target);
    else if (id === "edit") onEdit(target);
    else confirmDelete(target);
  };

  return (
    // Titled with the trip, so a mis-tap can't destroy the wrong one.
    <BottomSheet
      visible={trip !== null}
      onClose={onClose}
      title={trip ? tripTitle(trip) : ""}
    >
      {trip ? (
        <View style={styles.body}>
          {tripVerbs(surface).map((verb, index, all) => (
            <Fragment key={verb.id}>
              {/* A rule above the verbs that end things. */}
              {verb.separated && index > 0 && !all[index - 1].separated ? (
                <View style={styles.rule} />
              ) : null}
              <Row
                icon={verb.icon}
                hue={verb.danger ? theme.warning : undefined}
                title={verb.label}
                onPress={() => run(verb.id, trip)}
              />
            </Fragment>
          ))}
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 8 },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: theme.line },
});
