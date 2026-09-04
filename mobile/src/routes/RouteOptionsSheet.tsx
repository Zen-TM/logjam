// The verb list for one route — the sheet behind Saved's three-dots AND the
// sheet the map opens when a route line is tapped.
//
// ONE component for both on purpose. The two surfaces offering different verbs
// for the same object is exactly the drift DESIGN.md §7 is about, and the
// actions themselves already have a single source in saved/assetActions.ts.
// This is that descriptor rendered.
//
// A tap on the map opens THIS, not the stats — the stats are a sub-mode one
// tap in ("View stats"), reached the same way from either surface. Rename is a
// sub-mode too rather than a caller callback, because a callback is only as
// good as the caller that remembers to pass it: the map never did, so a route
// tapped on the map could not be renamed at all.
//
// `onShowOnMap` is the ONE row that is Saved-only: on the map you are already
// looking at the line you tapped.
//
// There is ONE "Edit" row, not three. Edit points, Reverse direction and Colour
// were separate rows that all edited the route, two of them acting on a line
// the user could not see while deciding. Edit now opens the map's draw tool on
// this route, and reverse and colour are controls in the tool's own panel,
// acting on the draft (DraftToolPanel.tsx).
import { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { messageFromError } from "@logjam/shared";

import { assetHue, canyonHue, fontSize, theme } from "../theme";
import { BottomSheet, RenameForm, Row } from "../ui";
import { useSharePanel, useShareRowProps } from "../sharing/SharePanel";
import { useConnectivity } from "../map/connectivity";
import { SHARED_READ_ONLY_HINT, routeActions } from "../saved/assetActions";
import { useCanyonPicker } from "../canyons/useCanyonPicker";
import { useMirrorCanyons } from "../sync/useSyncQueries";
import { updateRouteLocal } from "../sync/outbox";
import type { MirrorRoute } from "../sync/mirrorStore";
import { exportRoute, ExportUnsupportedError } from "../fileExport";
import { RouteStatsBody } from "./RouteStatsBody";

export function RouteOptionsSheet({
  route,
  visible,
  onClose,
  onShowOnMap,
  onEdit,
  onOpenCanyon,
  onInfo,
  onError,
  allowNetwork = true,
}: {
  route: MirrorRoute | null;
  visible: boolean;
  onClose: () => void;
  /**
   * Open the canyon a SHARED route came with. Not a share verb of its own: a
   * route on this phone because its canyon is shared has no share row to drop,
   * and the canyon's screen is where that ends (saved/assetActions.ts).
   */
  onOpenCanyon?: (canyonId: string, name: string) => void;
  /**
   * Fly the map to this route. Saved-only — the map surface omits it, because
   * the user got here by tapping the line and is already looking at it
   * (DESIGN.md §7: "View on map" is the one row the two surfaces differ by).
   */
  onShowOnMap?: () => void;
  /** Arm the map's draw tool on this route. Editing is a map gesture, so both
   *  surfaces hand it over — Saved navigates to the map first. */
  onEdit: () => void;
  onInfo: (message: string) => void;
  onError: (message: string) => void;
  /** False in "Simulating offline mode" — the stats sub-mode then reads
   *  elevation only from tiles already on the phone. */
  allowNetwork?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  // The share panel is rendered HERE rather than handed to the caller: this
  // one component is both Saved's three-dots sheet and the map's route sheet,
  // and a callback would have given the verb to whichever surface remembered
  // to pass it. That asymmetry is the bug this sheet exists to prevent
  // (DESIGN.md §7).
  const [sharing, setSharing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [showingStats, setShowingStats] = useState(false);
  const [linking, setLinking] = useState(false);

  // Reset every sub-mode when the sheet closes. This component stays mounted
  // between openings — `visible` is a prop, not a remount — so a sub-mode left
  // set means the NEXT open lands inside it. That is exactly what shipped:
  // after sharing once, tapping a route's ⋯ went straight to the share panel
  // and the verb list could not be reached again.
  useEffect(() => {
    if (!visible) {
      setSharing(false);
      setRenaming(false);
      setShowingStats(false);
      setLinking(false);
    }
  }, [visible]);
  const online = useConnectivity() === "online";

  const shareRowProps = useShareRowProps(online);
  // The canyons this phone can see, so a shared route can tell a share of its
  // own from one it inherited (assetActions.routeActions says why).
  const canyons = useMirrorCanyons();
  const visibleCanyonIds = (canyons.data ?? []).map((canyon) => canyon.id);
  const actions = route ? routeActions(route, visibleCanyonIds) : null;
  const viaCanyons = (canyons.data ?? []).filter((canyon) =>
    (actions?.sharedViaCanyonIds ?? []).includes(canyon.id),
  );
  // THE sharing panel — the same one Saved, the waypoint sheet and the canyon
  // screen render. Called unconditionally; a closed sheet passes a null target
  // and issues no request.
  const share = useSharePanel({
    target: actions?.share
      ? { kind: "entity", entityType: actions.share.entityType, entityId: actions.share.entityId }
      : null,
    itemLabel: route?.name ?? "",
    online,
    enabled: visible && route != null,
    active: sharing,
  });

  // THE canyon picker, as a sub-mode of this sheet rather than a second sheet
  // the caller had to remember to mount (DESIGN.md §6). Same panel a track's
  // and an import's options render.
  const canyonPicker = useCanyonPicker({
    source: "route",
    active: linking,
    currentCanyonId: route?.canyonId ?? null,
    ignoreRouteId: route?.id ?? null,
    onUnlink: () =>
      updateRouteLocal(route!.id, { canyonId: null }).then(() =>
        onInfo("Route unlinked."),
      ),
    attach: (canyonId, canyonName) =>
      updateRouteLocal(route!.id, { canyonId }).then(() =>
        onInfo(`Route linked to ${canyonName}.`),
      ),
    onDone: () => {
      setLinking(false);
      onClose();
    },
    onError,
  });

  if (!route || !actions) return null;

  const close = () => {
    setSharing(false);
    setRenaming(false);
    setShowingStats(false);
    setLinking(false);
    onClose();
  };

  const save = (format: "gpx" | "kml") => {
    close();
    setBusy(true);
    exportRoute(route, format)
      .then((filename) => {
        // Null = the user backed out of the folder picker. Not a failure, and
        // a toast claiming success would be a lie.
        if (filename) onInfo(`Saved ${filename}.`);
      })
      .catch((err: unknown) => {
        if (err instanceof ExportUnsupportedError) {
          onError(err.message);
          return;
        }
        console.error(err);
        onError("Couldn't save that file.");
      })
      .finally(() => setBusy(false));
  };

  const confirmRemoveShare = () => {
    const removal = actions.removeShare;
    if (!removal) return;
    close();
    Alert.alert(removal.confirmTitle, removal.confirmBody, [
      { text: "Cancel", style: "cancel" },
      {
        // NOT `destructive`: the owner keeps the route, and the red button the
        // delete confirm uses would say otherwise.
        text: "Remove",
        onPress: () =>
          removal
            .run()
            .then(() => onInfo("Removed."))
            .catch((err: unknown) => {
              console.error(err);
              onError(messageFromError(err, "Couldn't remove that route."));
            }),
      },
    ]);
  };

  const confirmDelete = () => {
    const removal = actions.delete;
    if (!removal) return;
    close();
    Alert.alert(removal.confirmTitle, removal.confirmBody, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          removal.run().catch((err: unknown) => {
            console.error(err);
            onError("Couldn't delete that route.");
          }),
      },
    ]);
  };

  // Every sub-mode backs out to the verb list; only the list itself closes the
  // sheet (DESIGN.md §6 — a sub-mode swaps the content, it never stacks).
  const leaveSubMode = sharing
    ? () => setSharing(false)
    : renaming
      ? () => setRenaming(false)
      : showingStats
        ? () => setShowingStats(false)
        : linking
          ? () => setLinking(false)
          : null;

  return (
    <BottomSheet
      visible={visible}
      onClose={leaveSubMode ?? close}
      // The stats sub-mode keeps the route's own name: it is the same subject,
      // seen as numbers.
      title={
        sharing
          ? share.title
          : renaming
            ? "Rename route"
            : linking
              ? route.canyonId
                ? "Change linked canyon"
                : "Link to a canyon"
              : route.name
      }
      // A sub-mode REPLACES the verb list rather than expanding inside it —
      // same shape as the waypoint sheet and the canyon sheet. Shown inline the
      // share panel pushed "Delete route" below the friend picker, which put a
      // destructive verb in the middle of a sharing flow.
      onBack={leaveSubMode ?? undefined}
      footer={sharing ? share.footer : undefined}
      header={linking ? canyonPicker.header : undefined}
    >
      {sharing && actions.share ? (
        share.body
      ) : linking ? (
        canyonPicker.body
      ) : renaming && actions.rename ? (
        <View style={styles.body}>
          <RenameForm
            initialName={route.name}
            onSubmit={(changed) => {
              if (!changed.name) {
                close();
                return;
              }
              setBusy(true);
              actions
                .rename!(changed.name)
                .then(() => close())
                .catch((err: unknown) => {
                  console.error(err);
                  onError(messageFromError(err, "Couldn't rename that."));
                })
                .finally(() => setBusy(false));
            }}
          />
        </View>
      ) : showingStats ? (
        <RouteStatsBody route={route} allowNetwork={allowNetwork} />
      ) : (
      <View style={styles.body}>
        {/* The one row the two surfaces differ by, and it leads the list. */}
        {onShowOnMap && actions.locatable ? (
          <Row
            title="Show on map"
            icon="map-pin"
            hue={assetHue.route}
            disabled={busy}
            onPress={onShowOnMap}
          />
        ) : null}
        <Row
          title="View stats"
          icon="bar-chart-2"
          hue={assetHue.route}
          disabled={busy}
          onPress={() => setShowingStats(true)}
        />
        {actions.editableRouteId ? (
          <Row
            // ONE verb for every way of editing this route. It opens the draw
            // tool on the map, where the points, the direction and the colour
            // are all in reach of the line they change.
            title="Edit"
            icon="edit-3"
            hue={assetHue.route}
            disabled={busy}
            onPress={onEdit}
          />
        ) : null}
        {actions.editableRouteId ? (
          <Row
            // No subtitle: the sheet it opens says the same thing, and saying
            // it twice makes the row taller for no new information.
            title={route.canyonId ? "Change linked canyon" : "Link to a canyon"}
            icon="link"
            hue={assetHue.route}
            disabled={busy}
            onPress={() => setLinking(true)}
          />
        ) : null}
        <Row
          title="Save as GPX"
          icon="download"
          hue={theme.bonus1}
          disabled={busy}
          onPress={() => save("gpx")}
        />
        <Row
          title="Save as KML"
          icon="download"
          hue={theme.bonus1}
          disabled={busy}
          onPress={() => save("kml")}
        />
        {/* A shared route is not renameable — the API refuses the write — so
            the verb is absent rather than offered and its typing thrown away.
            The form behind it is a sub-mode of THIS sheet, so neither surface
            can be the one that lacks it. */}
        {actions.rename ? (
          <Row
            title="Rename"
            icon="edit-2"
            hue={theme.bonus1}
            disabled={busy}
            onPress={() => setRenaming(true)}
          />
        ) : null}
        {/* `actions.share` is absent on a route reached through someone else's
            canyon, so the verb is withheld rather than offered and refused
            with a 403. The panel behind it is a sub-mode of THIS sheet. */}
        {actions.share ? (
          <Row
            title="Share"
            icon="share-2"
            hue={theme.bonus1}
            {...shareRowProps}
            disabled={busy || shareRowProps.disabled}
            onPress={() => setSharing((open) => !open)}
          />
        ) : null}
        {/* A route is a synced record, so this removes it from the ACCOUNT —
            "from device" would promise the copy on another phone survives.
            A route shared through someone else's canyon carries no delete
            descriptor at all (the API's delete is owner-only), so the verb is
            absent rather than offered and refused. */}
        {actions.delete ? (
          <Row
            title="Delete route"
            icon="trash-2"
            hue={theme.warning}
            disabled={busy}
            onPress={confirmDelete}
          />
        ) : actions.sharedWithYou ? (
          // Keyed on ownership rather than on the delete verb's absence — the
          // two only coincide for kinds whose delete is the owner's.
          <Text style={styles.sharedHint}>{SHARED_READ_ONLY_HINT}</Text>
        ) : null}
        {/* The recipient's own verb. Present only on a DIRECT share; it needs a
            connection for the same reason granting one does, so it is dimmed
            offline with the reason in place of its subtitle, never hidden. */}
        {actions.removeShare ? (
          <Row
            title="Remove from my account"
            icon="x-circle"
            hue={theme.warning}
            {...shareRowProps}
            disabled={busy || shareRowProps.disabled}
            onPress={confirmRemoveShare}
          />
        ) : null}
        {/* Nothing to remove here — this route came with a canyon. Say which,
            and go there, rather than offering a verb the server would refuse. */}
        {viaCanyons.length > 0 && onOpenCanyon
          ? viaCanyons.map((canyon) => (
              <Row
                key={canyon.id}
                title={`Open ${canyon.name}`}
                subtitle="This route came with that shared canyon — remove it there."
                icon="map-pin"
                hue={canyonHue.shared}
                disabled={busy}
                onPress={() => {
                  close();
                  onOpenCanyon(canyon.id, canyon.name);
                }}
              />
            ))
          : null}
      </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 8 },
  sharedHint: { color: theme.textMuted, fontSize: fontSize.xs },
});
