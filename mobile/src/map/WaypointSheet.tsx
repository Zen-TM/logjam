// Everything you can do to one waypoint — the sheet the map opens when a pin
// is tapped AND the sheet behind Saved's three-dots.
//
// This replaces the three-button Alert the map used to show, which offered
// Cancel / Delete / Navigate and no way to reach the name, notes, tags or links
// a waypoint has always been able to carry. Android's Alert also drops buttons
// past three, so the list could not have grown anyway.
//
// ONE component for both surfaces, on the model of TrackOptionsSheet and for
// the same reason (DESIGN.md §7): sharing only the BODIES was not enough — the
// rows AROUND them drifted, so Saved offered "Show on map" and the map offered
// "Navigate to this waypoint" and neither surface had the other's row.
// `onShowOnMap` is the ONE row they may differ by.
//
// MODES of one sheet rather than a stack of sheets (DESIGN.md §6): the body
// swaps between the verb list, the rename form, the tag picker and the canyon
// picker, and the sheet itself never closes underneath the user. The last three
// bodies live in waypoints/waypointSheetBodies.tsx, where the Saved tab's
// CREATE form also reads the edit form.
//
// PRIVACY: a waypoint's whole payload is a coordinate, so linking one to a
// canyon that is already shared PUBLISHES it to that canyon's recipients. That
// is the documented rule (a linked waypoint follows canyon-level media), but it
// is not a rule anyone should meet by accident — the canyon picker names who
// gains sight before the first such link is written. Coordinates render here
// because this is a DETAIL surface the user opened for this exact point (§11);
// copying them is an explicit tap, and the clipboard is the user's own.
import { useEffect, useState } from "react";
import { Alert, Clipboard, StyleSheet, Text, View } from "react-native";
import {
  formatDistanceM,
  haversineMeters,
  initialBearingDegrees,
  compassPointFor,
  messageFromError,
} from "@logjam/shared";

import { assetHue, fontSize, spacing, theme } from "../theme";
import { BottomSheet, Row, StatGrid, type Stat } from "../ui";
import { deleteWaypointLocal, updateWaypointLocal } from "../sync/outbox";
import { SHARED_READ_ONLY_HINT, waypointActions } from "../saved/assetActions";
import type { Bbox } from "../saved/bboxOfPoints";
import { useSharePanel, useShareRowProps } from "../sharing/SharePanel";
import { useConnectivity } from "./connectivity";
import { useMirrorCanyons, useMirrorWaypoints } from "../sync/useSyncQueries";
import {
  WaypointCanyonFilter,
  WaypointCanyonsBody,
  WaypointFormBody,
  type WaypointFormDraft,
  WaypointSubModeHeader,
  WaypointTagsBody,
} from "../waypoints/waypointSheetBodies";
import type { MirrorWaypoint } from "../sync/mirrorStore";

type Mode = "actions" | "edit" | "tags" | "canyons" | "share";

export function WaypointSheet({
  waypoint,
  visible,
  userCoord,
  autoEdit = false,
  draft = null,
  picked = null,
  onPickOnMap,
  onShowOnMap,
  onClose,
  onNavigate,
  onInfo,
  onError,
}: {
  waypoint: MirrorWaypoint | null;
  /**
   * Whether this sheet is logically OPEN — which is not the same as having a
   * waypoint. `waypoint` goes null while the edit form is away at the point
   * picker (a Modal cannot sit over a full-screen map) and that must not read
   * as a close, or the user comes back to the verb list instead of the form
   * they were filling in.
   */
  visible: boolean;
  /** Latest fix as [lon, lat], or null when the dot isn't running. */
  userCoord: [number, number] | null;
  /**
   * Open straight into the name/notes form. Set by the drop actions: the
   * waypoint is already saved by the time this renders, so naming is one
   * keystroke away without the drop itself ever waiting on a modal — which
   * matters when the drop happened one-handed on a ledge.
   */
  autoEdit?: boolean;
  /** The form's own fields, held by the map while this sheet was closed for
   *  the point picker (a Modal cannot sit over a full-screen map). */
  draft?: WaypointFormDraft | null;
  /** A coordinate just chosen on the picker, replacing the two fields. */
  picked?: { latitude: number; longitude: number } | null;
  onPickOnMap?: (current: WaypointFormDraft) => void;
  /**
   * Fly the map to this waypoint. Saved-only — the map surface omits it,
   * because the user got here by tapping the pin and is already looking at it
   * (DESIGN.md §7: "Show on map" is the one row the two surfaces differ by).
   */
  onShowOnMap?: (bbox: Bbox) => void;
  onClose: () => void;
  /**
   * Start navigating to it. Present on BOTH surfaces: the map owns the bearing
   * line, so Saved hands over exactly as it does for "Continue recording" —
   * needing the map is not a reason to withhold the verb from the other
   * surface (DESIGN.md §7).
   */
  onNavigate: (waypoint: MirrorWaypoint) => void;
  onInfo: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [mode, setMode] = useState<Mode>(autoEdit ? "edit" : "actions");
  const online = useConnectivity() === "online";
  const [busy, setBusy] = useState(false);
  const [canyonQuery, setCanyonQuery] = useState("");

  const canyons = useMirrorCanyons();
  const waypoints = useMirrorWaypoints();

  // EVERY sub-mode resets when the sheet closes. This component stays mounted
  // between openings — `visible` is a prop, not a remount — so a sub-mode left
  // set means the NEXT open lands inside it instead of on the verb list. That
  // shipped twice on the sibling sheets, and closing this one is not always the
  // sheet's own doing: leaving the Saved tab or changing its filter drops it
  // from outside, nowhere near `close()` below.
  //
  // It keys on the OPEN EDGE rather than on `waypoint`, because the picker
  // round trip nulls the waypoint mid-edit (above) — and `autoEdit` flipping
  // true is exactly how both hosts ask to land in the form: a fresh drop, or a
  // return from the picker.
  useEffect(() => {
    setMode(visible && autoEdit ? "edit" : "actions");
    setCanyonQuery("");
  }, [autoEdit, visible]);

  // One descriptor for every verb on this sheet, same source as Saved
  // (saved/assetActions.ts). `share` and `delete` are both absent on a
  // waypoint seen through someone else's canyon.
  const actions = waypoint ? waypointActions(waypoint) : null;
  // A waypoint dropped on the trail reaches the server only when the outbox
  // flushes; until then the live-share verb dims and says so.
  const shareRowProps = useShareRowProps(online, actions?.share?.entityId);
  // THE sharing panel, identical to the one Saved, the route sheet and the
  // canyon screen render — the hook is called unconditionally (a closed sheet
  // passes a null target and issues no request).
  const share = useSharePanel({
    target: actions?.share
      ? { kind: "entity", entityType: actions.share.entityType, entityId: actions.share.entityId }
      : null,
    itemLabel: waypoint?.name ?? "",
    online,
    enabled: waypoint != null,
    active: mode === "share",
  });

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
          : mode === "share"
            ? share.title
            : waypoint.name;

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      title={title}
      // Sub-modes get a back arrow on the title line; the actions list is the
      // top of this sheet and has nowhere to go back to.
      onBack={mode === "actions" ? undefined : () => setMode("actions")}
      footer={mode === "share" ? share.footer : undefined}
      header={
        mode === "canyons" ? (
          <WaypointSubModeHeader hint="Waypoints are visible to people you share the canyon with.">
            <WaypointCanyonFilter value={canyonQuery} onChangeText={setCanyonQuery} />
          </WaypointSubModeHeader>
        ) : undefined
      }
    >
      {mode === "actions" ? (
        <View style={styles.body}>
          <StatGrid stats={stats} />
          {actions?.sharedWithYou ? (
            <Text style={styles.hint}>{SHARED_READ_ONLY_HINT}</Text>
          ) : null}
          {waypoint.notes ? <Text style={styles.notes}>{waypoint.notes}</Text> : null}
          {/* The one row the two surfaces differ by, and it leads the list. */}
          {onShowOnMap && actions ? (
            <Row
              icon="map-pin"
              title="Show on map"
              hue={assetHue.waypoint}
              disabled={busy}
              onPress={() => {
                close();
                actions.resolveBbox().then(
                  (bbox) => {
                    if (bbox) onShowOnMap(bbox);
                  },
                  (err: unknown) => console.error(err),
                );
              }}
            />
          ) : null}
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
                // Not "Edit name and notes": the form also owns the position,
                // and a verb that lists two of its three fields reads as a
                // promise that the third is not in there.
                title="Edit"
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
              {/* Owner-only by construction: waypointActions omits `share` on
                  a waypoint reached through someone else's canyon, and this
                  whole block is already behind `readOnly`. Offered HERE as
                  well as in Saved because a waypoint is most often looked at
                  on the map, and a verb that exists on one surface and not the
                  other is the drift DESIGN.md §7 is about. */}
              {actions?.share ? (
                <Row
                  icon="share-2"
                  title="Share"
                  {...shareRowProps}
                  disabled={busy || shareRowProps.disabled}
                  onPress={() => setMode("share")}
                />
              ) : null}
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
        <WaypointFormBody
          waypoint={waypoint}
          draft={draft}
          picked={picked}
          onPickOnMap={onPickOnMap}
          onSubmit={(changed) => {
            if (Object.keys(changed).length > 0) write(changed);
            // A drop lands here directly, so backing out of the form must
            // return to the waypoint rather than to the map.
            setMode("actions");
          }}
        />
      ) : null}

      {mode === "tags" ? (
        <WaypointTagsBody
          waypoint={waypoint}
          allWaypoints={waypoints.data ?? []}
          onWrite={write}
        />
      ) : null}

      {mode === "share" ? share.body : null}

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
