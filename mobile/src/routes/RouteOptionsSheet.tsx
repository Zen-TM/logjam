// The verb list for one route — the sheet behind Saved's three-dots AND the
// map's "View options".
//
// ONE component for both on purpose. The two surfaces offering different verbs
// for the same object is exactly the drift DESIGN.md §7 is about, and the
// actions themselves already have a single source in saved/assetActions.ts.
// This is that descriptor rendered.
//
// Rename lives in the caller (Saved has a rename form; the map does not need a
// second one), so it is passed in rather than assumed.
import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { messageFromError, TRACK_COLORS } from "@logjam/shared";

import { assetHue, fontSize, radius, spacing, theme } from "../theme";
import { BottomSheet, Row } from "../ui";
import { useSharePanel, useShareRowProps } from "../sharing/SharePanel";
import { useConnectivity } from "../map/connectivity";
import { SHARED_READ_ONLY_HINT, routeActions } from "../saved/assetActions";
import type { MirrorRoute } from "../sync/mirrorStore";
import { exportRoute, ExportUnsupportedError } from "../fileExport";

export function RouteOptionsSheet({
  route,
  visible,
  onClose,
  onViewStats,
  onShowOnMap,
  onEdit,
  onRename,
  onLinkCanyon,
  onInfo,
  onError,
}: {
  route: MirrorRoute | null;
  visible: boolean;
  onClose: () => void;
  /** Omitted where the stats are already on screen (the map's stats sheet). */
  onViewStats?: () => void;
  onShowOnMap?: () => void;
  onEdit?: () => void;
  onRename?: () => void;
  onLinkCanyon?: () => void;
  onInfo: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [pickingColor, setPickingColor] = useState(false);
  // The share panel is rendered HERE rather than handed to the caller: this
  // one component is both Saved's three-dots sheet and the map's "View
  // options", and a callback would have given the verb to whichever surface
  // remembered to pass it. That asymmetry is the bug this sheet exists to
  // prevent (DESIGN.md §7).
  const [sharing, setSharing] = useState(false);

  // Reset every sub-mode when the sheet closes. This component stays mounted
  // between openings — `visible` is a prop, not a remount — so a sub-mode left
  // set means the NEXT open lands inside it. That is exactly what shipped:
  // after sharing once, tapping a route's ⋯ went straight to the share panel
  // and the verb list could not be reached again.
  useEffect(() => {
    if (!visible) {
      setSharing(false);
      setPickingColor(false);
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
    onClose();
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
    onClose();
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

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={sharing ? share.title : route.name}
      // The share panel REPLACES the verb list rather than expanding inside it
      // — same sub-mode shape as the waypoint sheet and the canyon sheet. Shown
      // inline it pushed "Delete route" below the friend picker, which put a
      // destructive verb in the middle of a sharing flow and made this the one
      // surface that looked different from the others.
      onBack={sharing ? () => setSharing(false) : undefined}
      footer={sharing ? share.footer : undefined}
    >
      {sharing && actions.share ? (
        share.body
      ) : (
      <View style={styles.body}>
        {onViewStats ? (
          <Row
            title="View stats"
            icon="bar-chart-2"
            hue={assetHue.route}
            disabled={busy}
            onPress={onViewStats}
          />
        ) : null}
        {onShowOnMap && actions.locatable ? (
          <Row
            title="Show on map"
            icon="map-pin"
            hue={assetHue.route}
            disabled={busy}
            onPress={onShowOnMap}
          />
        ) : null}
        {onEdit && actions.editableRouteId ? (
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
              onClose();
              run(actions.reverse!, "Couldn't reverse that route.");
            }}
          />
        ) : null}
        {onLinkCanyon && actions.editableRouteId ? (
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
        {/* Both halves matter: the caller has to HAVE a rename form (the map
            does not), and the route has to be renameable at all — a shared one
            is not, and the form would have swallowed the new name. */}
        {onRename && actions.rename ? (
          <Row
            title="Rename"
            icon="edit-2"
            hue={theme.bonus1}
            disabled={busy}
            onPress={onRename}
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
        ) : (
          <Text style={styles.sharedHint}>{SHARED_READ_ONLY_HINT}</Text>
        )}
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
