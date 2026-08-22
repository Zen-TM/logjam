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
import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { messageFromError, TRACK_COLORS } from "@logjam/shared";

import { assetHue, fontSize, radius, spacing, theme } from "../theme";
import { BottomSheet, RenameForm, Row } from "../ui";
import { useSharePanel, useShareRowProps } from "../sharing/SharePanel";
import { useConnectivity } from "../map/connectivity";
import { SHARED_READ_ONLY_HINT, routeActions } from "../saved/assetActions";
import type { MirrorRoute } from "../sync/mirrorStore";
import { exportRoute, ExportUnsupportedError } from "../fileExport";
import { RouteStatsBody } from "./RouteStatsBody";

export function RouteOptionsSheet({
  route,
  visible,
  onClose,
  onShowOnMap,
  onEdit,
  onLinkCanyon,
  onInfo,
  onError,
  allowNetwork = true,
}: {
  route: MirrorRoute | null;
  visible: boolean;
  onClose: () => void;
  /**
   * Fly the map to this route. Saved-only — the map surface omits it, because
   * the user got here by tapping the line and is already looking at it
   * (DESIGN.md §7: "View on map" is the one row the two surfaces differ by).
   */
  onShowOnMap?: () => void;
  /** Arm the map's draw tool on this route. Editing is a map gesture, so both
   *  surfaces hand it over — Saved navigates to the map first. */
  onEdit: () => void;
  onLinkCanyon: () => void;
  onInfo: (message: string) => void;
  onError: (message: string) => void;
  /** False in "Simulating offline mode" — the stats sub-mode then reads
   *  elevation only from tiles already on the phone. */
  allowNetwork?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [pickingColor, setPickingColor] = useState(false);
  // The share panel is rendered HERE rather than handed to the caller: this
  // one component is both Saved's three-dots sheet and the map's route sheet,
  // and a callback would have given the verb to whichever surface remembered
  // to pass it. That asymmetry is the bug this sheet exists to prevent
  // (DESIGN.md §7).
  const [sharing, setSharing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [showingStats, setShowingStats] = useState(false);

  // Reset every sub-mode when the sheet closes. This component stays mounted
  // between openings — `visible` is a prop, not a remount — so a sub-mode left
  // set means the NEXT open lands inside it. That is exactly what shipped:
  // after sharing once, tapping a route's ⋯ went straight to the share panel
  // and the verb list could not be reached again.
  useEffect(() => {
    if (!visible) {
      setSharing(false);
      setPickingColor(false);
      setRenaming(false);
      setShowingStats(false);
    }
  }, [visible]);
  const online = useConnectivity() === "online";

  const shareRowProps = useShareRowProps(online);
  const actions = route ? routeActions(route) : null;
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

  if (!route || !actions) return null;

  const close = () => {
    setSharing(false);
    setPickingColor(false);
    setRenaming(false);
    setShowingStats(false);
    onClose();
  };

  const run = (action: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    action()
      .catch((err: unknown) => {
        console.error(err);
        onError(messageFromError(err, failure));
      })
      .finally(() => setBusy(false));
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
        : null;

  return (
    <BottomSheet
      visible={visible}
      onClose={leaveSubMode ?? close}
      // The stats sub-mode keeps the route's own name: it is the same subject,
      // seen as numbers.
      title={sharing ? share.title : renaming ? "Rename route" : route.name}
      // A sub-mode REPLACES the verb list rather than expanding inside it —
      // same shape as the waypoint sheet and the canyon sheet. Shown inline the
      // share panel pushed "Delete route" below the friend picker, which put a
      // destructive verb in the middle of a sharing flow.
      onBack={leaveSubMode ?? undefined}
      footer={sharing ? share.footer : undefined}
    >
      {sharing && actions.share ? (
        share.body
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
            title="Edit points"
            icon="edit-3"
            hue={assetHue.route}
            disabled={busy}
            onPress={onEdit}
          />
        ) : null}
        {actions.reverse ? (
          <Row
            title="Reverse direction"
            icon="repeat"
            hue={assetHue.route}
            disabled={busy}
            onPress={() => {
              close();
              run(actions.reverse!, "Couldn't reverse that route.");
            }}
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
            onPress={onLinkCanyon}
          />
        ) : null}
        {actions.setColor ? (
          <>
            <Row
              title="Colour"
              icon="droplet"
              hue={route.color ?? theme.accent}
              disabled={busy}
              onPress={() => setPickingColor((open) => !open)}
              right={
                <View
                  style={[
                    styles.currentSwatch,
                    { backgroundColor: route.color ?? theme.accent },
                  ]}
                />
              }
            />
            {pickingColor ? (
              <View style={styles.palette}>
                {TRACK_COLORS.map((color) => (
                  <Pressable
                    key={color}
                    accessibilityRole="button"
                    accessibilityLabel={`Colour ${color}`}
                    accessibilityState={{ selected: color === route.color }}
                    disabled={busy}
                    onPress={() => {
                      setPickingColor(false);
                      run(
                        () => actions.setColor!(color),
                        "Couldn't change the colour.",
                      );
                    }}
                    style={[
                      styles.swatch,
                      { backgroundColor: color },
                      color === route.color ? styles.swatchSelected : null,
                    ]}
                  >
                    {color === route.color ? (
                      <Text style={styles.swatchTick}>✓</Text>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            ) : null}
          </>
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
      </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 8 },
  sharedHint: { color: theme.textMuted, fontSize: fontSize.xs },
  currentSwatch: { width: 22, height: 22, borderRadius: radius.sm },
  palette: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing(1),
    paddingHorizontal: spacing(1),
    paddingBottom: spacing(0.5),
  },
  swatch: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  swatchSelected: { borderWidth: 2, borderColor: theme.textPrimary },
  swatchTick: { color: theme.primary, fontWeight: "700" },
});
