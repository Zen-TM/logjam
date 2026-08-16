// Everything you can do to one waypoint.
//
// This replaces the three-button Alert the map used to show, which offered
// Cancel / Delete / Navigate and no way to reach the name, notes, tags or links
// a waypoint has always been able to carry. Android's Alert also drops buttons
// past three, so the list could not have grown anyway.
//
// MODES of one sheet rather than a stack of sheets (DESIGN.md §6): the body
// swaps between the verb list, the rename form, the tag picker and the canyon
// picker, and the sheet itself never closes underneath the user. The bodies for
// the last three are shared with the Saved tab's per-item sheet, which offers
// the same verbs (waypoints/waypointSheetBodies.tsx).
//
// PRIVACY: a waypoint's whole payload is a coordinate, so linking one to a
// canyon that is already shared PUBLISHES it to that canyon's recipients. That
// is the documented rule (a linked waypoint follows canyon-level media), but it
// is not a rule anyone should meet by accident — the canyon picker names who
// gains sight before the first such link is written. Coordinates render here
// because this is a DETAIL surface the user opened for this exact point (§11);
// copying them is an explicit tap, and the clipboard is the user's own.
import { useState } from "react";
import { Alert, Clipboard, StyleSheet, Text, View } from "react-native";
import {
  formatDistanceM,
  haversineMeters,
  initialBearingDegrees,
  compassPointFor,
  messageFromError,
} from "@logjam/shared";

import { assetHue, fontSize, spacing, theme } from "../theme";
import { BottomSheet, RenameForm, Row, StatGrid, type Stat } from "../ui";
import { deleteWaypointLocal, updateWaypointLocal } from "../sync/outbox";
import { waypointActions } from "../saved/assetActions";
import { useMirrorCanyons, useMirrorWaypoints } from "../sync/useSyncQueries";
import {
  WaypointCanyonFilter,
  WaypointCanyonsBody,
  WaypointSubModeHeader,
  WaypointTagsBody,
} from "../waypoints/waypointSheetBodies";
import type { MirrorWaypoint } from "../sync/mirrorStore";

type Mode = "actions" | "edit" | "tags" | "canyons";

export function WaypointSheet({
  waypoint,
  userCoord,
  autoEdit = false,
  onClose,
  onNavigate,
  onInfo,
  onError,
}: {
  waypoint: MirrorWaypoint | null;
  /** Latest fix as [lon, lat], or null when the dot isn't running. */
  userCoord: [number, number] | null;
  /**
   * Open straight into the name/notes form. Set by the drop actions: the
   * waypoint is already saved by the time this renders, so naming is one
   * keystroke away without the drop itself ever waiting on a modal — which
   * matters when the drop happened one-handed on a ledge.
   */
  autoEdit?: boolean;
  onClose: () => void;
  onNavigate: (waypoint: MirrorWaypoint) => void;
  onInfo: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [mode, setMode] = useState<Mode>(autoEdit ? "edit" : "actions");
  const [busy, setBusy] = useState(false);
  const [canyonQuery, setCanyonQuery] = useState("");

  const canyons = useMirrorCanyons();
  const waypoints = useMirrorWaypoints();

  const close = () => {
    setMode("actions");
    setCanyonQuery("");
    onClose();
  };

  // Mounted only with a waypoint: the mirror hooks above must not keep running
  // for a sheet that is closed.
  if (!waypoint) return null;

  const readOnly = waypoint.syncRole === "shared";

  const write = (fields: Record<string, unknown>, done?: () => void) => {
    setBusy(true);
    updateWaypointLocal(waypoint.id, fields)
      .then(() => done?.())
      .catch((err: unknown) => {
        console.error(err);
        onError(messageFromError(err, "Couldn't save that change."));
      })
      .finally(() => setBusy(false));
  };

  const linkedNames = (canyons.data ?? [])
    .filter((canyon) => waypoint.canyonIds.includes(canyon.id))
    .map((canyon) => canyon.name);

  const position = `${waypoint.latitude.toFixed(5)}, ${waypoint.longitude.toFixed(5)}`;
  const copyPosition = () => {
    // RN core Clipboard: deprecated upstream but still shipped in 0.79, and it
    // needs no native module — expo-clipboard would mean a dev-client rebuild
    // for one string copy.
    // ponytail: swap to expo-clipboard when RN drops this, or when a native
    // rebuild is happening anyway.
    Clipboard.setString(position);
    onInfo("Coordinates copied.");
  };

  const confirmDelete = () => {
    // The copy comes from the same descriptor the Saved tab's sheet uses
    // (DESIGN.md §7): this surface used to say only "Delete this waypoint?",
    // which left out that the delete reaches every device on the account and
    // anyone the linked canyons are shared with.
    // Absent on a waypoint shared with this user, which is exactly when the
    // button below is not rendered — this guard is the type-level half of that.
    const removal = waypointActions(waypoint).delete;
    if (!removal) return;
    Alert.alert(removal.confirmTitle, removal.confirmBody, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          deleteWaypointLocal(waypoint.id)
            .then(() => {
              onInfo("Waypoint deleted.");
              close();
            })
            .catch((err: unknown) => {
              console.error(err);
              onError(messageFromError(err, "Couldn't delete that waypoint."));
            });
        },
      },
    ]);
  };

  // Distance and bearing are a pair — they answer one question together — so
  // they share a row, under the position, which gets the full width because a
  // coordinate pair wraps at half.
  const secondaryStats: Stat[] = userCoord
    ? [
        {
          label: "Distance",
          value: formatDistanceM(
            haversineMeters(
              userCoord[1],
              userCoord[0],
              waypoint.latitude,
              waypoint.longitude,
            ),
          ),
        },
        {
          label: "Bearing",
          value: (() => {
            const bearing = initialBearingDegrees(
              userCoord[1],
              userCoord[0],
              waypoint.latitude,
              waypoint.longitude,
            );
            return `${compassPointFor(bearing)} ${Math.round(bearing)}°`;
          })(),
        },
      ]
    : [];

  const stats: Stat[] = [
    { label: "Position", value: position, wide: true, onPress: copyPosition },
    ...(waypoint.elevation != null
      ? [{ label: "Elevation", value: `${Math.round(waypoint.elevation)} m` }]
      : []),
    ...secondaryStats,
  ];

  const title =
    mode === "edit"
      ? "Edit waypoint"
      : mode === "tags"
        ? "Tags"
        : mode === "canyons"
          ? "Linked canyons"
          : waypoint.name;

  return (
    <BottomSheet
      visible
      onClose={close}
      title={title}
      // Sub-modes get a back arrow on the title line; the actions list is the
      // top of this sheet and has nowhere to go back to.
      onBack={mode === "actions" ? undefined : () => setMode("actions")}
      header={
        mode === "canyons" ? (
          <WaypointSubModeHeader hint="Anyone you share a canyon with can see its waypoints.">
            <WaypointCanyonFilter value={canyonQuery} onChangeText={setCanyonQuery} />
          </WaypointSubModeHeader>
        ) : undefined
      }
    >
      {mode === "actions" ? (
        <View style={styles.body}>
          <StatGrid stats={stats} />
          {readOnly ? (
            <Text style={styles.hint}>
              Shared with you through a canyon — you can view it, but only its
              owner can change it.
            </Text>
          ) : null}
          {waypoint.notes ? <Text style={styles.notes}>{waypoint.notes}</Text> : null}
          <Row
            icon="navigation"
            title="Navigate to this waypoint"
            onPress={() => {
              onNavigate(waypoint);
              close();
            }}
          />
          {readOnly ? null : (
            <>
              <Row
                icon="edit-2"
                title="Edit name and notes"
                disabled={busy}
                onPress={() => setMode("edit")}
              />
              <Row
                icon="tag"
                title="Tags"
                subtitle={waypoint.tags.length ? waypoint.tags.join(", ") : "None yet"}
                hue={assetHue.track}
                disabled={busy}
                onPress={() => setMode("tags")}
              />
              <Row
                icon="link-2"
                title="Linked canyons"
                subtitle={linkedNames.length ? linkedNames.join(", ") : "Not linked"}
                hue={assetHue.route}
                disabled={busy}
                onPress={() => setMode("canyons")}
              />
              <Row
                icon="trash-2"
                title="Delete waypoint"
                hue={theme.warning}
                disabled={busy}
                onPress={confirmDelete}
              />
            </>
          )}
        </View>
      ) : null}

      {mode === "edit" ? (
        <View style={styles.body}>
          <RenameForm
            initialName={waypoint.name}
            initialNotes={waypoint.notes}
            onSubmit={(changed) => {
              if (Object.keys(changed).length > 0) write(changed);
              // A drop lands here directly, so backing out of the form must
              // return to the waypoint rather than to the map.
              setMode("actions");
            }}
          />
        </View>
      ) : null}

      {mode === "tags" ? (
        <WaypointTagsBody
          waypoint={waypoint}
          allWaypoints={waypoints.data ?? []}
          onWrite={write}
        />
      ) : null}

      {mode === "canyons" ? (
        <WaypointCanyonsBody
          waypoint={waypoint}
          query={canyonQuery}
          onWrite={write}
        />
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing(1) },
  hint: { color: theme.textMuted, fontSize: fontSize.xs },
  notes: { color: theme.textPrimary, fontSize: fontSize.sm },
});
