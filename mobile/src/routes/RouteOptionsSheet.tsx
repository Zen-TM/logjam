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
import { useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { messageFromError } from "@logjam/shared";

import { assetHue, placeHue, theme } from "../theme";
import { BottomSheet, RenameForm, Row } from "../ui";
import { useSharePanel, useShareRowProps } from "../sharing/SharePanel";
import { useCopyPanel } from "../sharing/CopySheet";
import { requestSync } from "../sync/syncEngine";
import {
  copyShared,
  runCopyAndRemove,
  type CopyAndRemoveTarget,
} from "../sharing/copyAndRemove";
import {
  copyAndRemoveOutcomeMessage,
  copyOutcomeMessage,
} from "../sharing/friendShareRows";
import { useConnectivity } from "../map/connectivity";
import { routeActions } from "../saved/assetActions";
import { usePlacePicker } from "../places/usePlacePicker";
import { useMirrorPlaces } from "../sync/useSyncQueries";
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
  onOpenPlace,
  onInfo,
  onError,
  allowNetwork = true,
}: {
  route: MirrorRoute | null;
  visible: boolean;
  onClose: () => void;
  /**
   * Open the place a SHARED route came with. Not a share verb of its own: a
   * route on this phone because its place is shared has no share row to drop,
   * and the place's screen is where that ends (saved/assetActions.ts).
   */
  onOpenPlace?: (placeId: string, name: string) => void;
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
  const [copyMode, setCopyMode] = useState<"copy" | "copyAndRemove" | null>(null);

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
      setCopyMode(null);
    }
  }, [visible]);
  const online = useConnectivity() === "online";

  // The places this phone can see, so a shared route can tell a share of its
  // own from one it inherited (assetActions.routeActions says why).
  const places = useMirrorPlaces();
  const visiblePlaceIds = (places.data ?? []).map((place) => place.id);
  const actions = route ? routeActions(route, visiblePlaceIds) : null;
  const viaPlaces = (places.data ?? []).filter((place) =>
    (actions?.sharedViaPlaceIds ?? []).includes(place.id),
  );
  // Declared AFTER `actions`, which it now reads: the route's own id. A route
  // drawn in the field is not on the server until the outbox flushes, and the
  // verb dims with the reason rather than firing a grant at a row that isn't
  // there.
  const shareRowProps = useShareRowProps(online, actions?.share?.entityId);
  // THE sharing panel — the same one Saved, the waypoint sheet and the place
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

  // THE copy panel, a sub-mode for the same reason the share panel is one.
  //
  // Offered on a route SHARED WITH this user, whichever arm it arrived on: a
  // route inherited from a shared place is copyable too (the server decides
  // that, and it allows it), even though it has no direct share to remove — so
  // the bundled verb below is gated on `removeShare` while the plain copy is
  // not. No owner username reaches a mirrored route, so the copy says "the
  // owner", as `removeConfirmFields` already does.
  const sharedWithMe = actions?.sharedWithYou === true;
  const copyTargets = useMemo<CopyAndRemoveTarget[]>(
    () =>
      route && sharedWithMe
        ? [{ entityType: "route", entityId: route.id, title: route.name }]
        : [],
    [route, sharedWithMe],
  );
  const copy = useCopyPanel({
    active: copyMode !== null,
    targets: copyTargets,
    mode: copyMode ?? "copy",
    friendName: "the owner",
    busy,
    online,
    onConfirm: (options) => {
      const [target] = copyTargets;
      if (!target) return;
      const bundled = copyMode === "copyAndRemove";
      setBusy(true);
      void (async () => {
        if (bundled) {
          const report = copyAndRemoveOutcomeMessage(
            await runCopyAndRemove([target], options),
          );
          (report.tone === "error" ? onError : onInfo)(report.text);
        } else {
          try {
            await copyShared(target, options);
            const report = copyOutcomeMessage({ copied: 1, failed: [] });
            onInfo(report.text);
          } catch (err) {
            // Our own copy, never the error's: it may carry the name.
            console.error(err);
            onError("Couldn't save a copy of this route.");
          }
          void requestSync().catch((syncErr: unknown) => console.error(syncErr));
        }
        setBusy(false);
        setCopyMode(null);
        close();
      })();
    },
  });

  // THE place picker, as a sub-mode of this sheet rather than a second sheet
  // the caller had to remember to mount (DESIGN.md §6). Same panel a track's
  // and an import's options render.
  const placePicker = usePlacePicker({
    source: "route",
    active: linking,
    currentPlaceId: route?.placeId ?? null,
    ignoreRouteId: route?.id ?? null,
    onUnlink: () =>
      updateRouteLocal(route!.id, { placeId: null }).then(() =>
        onInfo("Route unlinked."),
      ),
    attach: (placeId, placeName) =>
      updateRouteLocal(route!.id, { placeId }).then(() =>
        onInfo(`Route linked to ${placeName}.`),
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
          : copyMode
            ? () => setCopyMode(null)
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
              ? route.placeId
                ? "Change linked place"
                : "Link to a place"
              : copyMode
                ? copy.title
                : route.name
      }
      // A sub-mode REPLACES the verb list rather than expanding inside it —
      // same shape as the waypoint sheet and the place sheet. Shown inline the
      // share panel pushed "Delete route" below the friend picker, which put a
      // destructive verb in the middle of a sharing flow.
      onBack={leaveSubMode ?? undefined}
      footer={sharing ? share.footer : copyMode ? copy.footer : undefined}
      header={linking ? placePicker.header : undefined}
    >
      {sharing && actions.share ? (
        share.body
      ) : copyMode ? (
        copy.body
      ) : linking ? (
        placePicker.body
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
            title={route.placeId ? "Change linked place" : "Link to a place"}
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
            place, so the verb is withheld rather than offered and refused
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
            A route shared through someone else's place carries no delete
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
        ) : null}
        {/* The recipient's keep. Offered on EITHER arm — a route inherited
            from a shared place is copyable too — which is why it is gated on
            "someone else owns this" and not on there being a share row. */}
        {actions.sharedWithYou ? (
          <Row
            title="Save a copy"
            icon="copy"
            {...shareRowProps}
            disabled={busy || shareRowProps.disabled}
            onPress={() => setCopyMode("copy")}
          />
        ) : null}
        {/* The bundled verb, gated on the SECOND half being possible: an
            inherited route has no share of its own to drop, and a button that
            silently did only its first half would be the same button making
            two different promises. */}
        {actions.sharedWithYou && actions.removeShare ? (
          <Row
            title="Save a copy and remove"
            icon="download"
            {...shareRowProps}
            disabled={busy || shareRowProps.disabled}
            onPress={() => setCopyMode("copyAndRemove")}
          />
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
        {/* Nothing to remove here — this route came with a place. Say which,
            and go there, rather than offering a verb the server would refuse. */}
        {viaPlaces.length > 0 && onOpenPlace
          ? viaPlaces.map((place) => (
              <Row
                key={place.id}
                title={`Open ${place.name}`}
                subtitle="This route came with that shared place — remove it there."
                icon="map-pin"
                hue={placeHue.shared}
                disabled={busy}
                onPress={() => {
                  close();
                  onOpenPlace(place.id, place.name);
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
});
