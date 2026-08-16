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
import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { messageFromError, TRACK_COLORS } from "@logjam/shared";

import { assetHue, fontSize, radius, spacing, theme } from "../theme";
import { BottomSheet, Row } from "../ui";
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

  if (!route) return null;
  const actions = routeActions(route);

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
    <BottomSheet visible={visible} onClose={onClose} title={route.name}>
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
