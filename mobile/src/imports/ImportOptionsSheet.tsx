// The verb list for one imported file, rendered from `vectorImportActions` —
// the sheet the map opens when an import is tapped AND the sheet behind Saved's
// three-dots.
//
// ONE component for both, on the model of TrackOptionsSheet and for the same
// reason: the actions have a single definition in saved/assetActions.ts, and an
// import reached from the map must not be a lesser object than one reached from
// Saved (DESIGN.md §7). Until this existed the map offered NOTHING at all — an
// imported line was the one drawn thing on the map that could not be tapped.
//
// Rename, Send a copy and the stats are sub-modes of THIS sheet rather than
// second sheets (§6: never open a second sheet — swap the content), so no
// caller can be the surface that forgot one.
//
// `onShowOnMap` is the ONE row that is Saved-only: on the map you are already
// looking at the file you tapped.
import { useEffect, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { messageFromError } from "@logjam/shared";

import { assetHue, spacing, theme } from "../theme";
import { BottomSheet, RenameForm, Row, Toggle } from "../ui";
import { vectorImportActions } from "../saved/assetActions";
import { useCanyonPicker } from "../canyons/useCanyonPicker";
import type { Bbox } from "../saved/bboxOfPoints";
import { ExportUnsupportedError } from "../fileExport";
import { useSharePanel, useShareRowProps } from "../sharing/SharePanel";
import { useConnectivity } from "../map/connectivity";
import { useElevationProfile } from "../map/useElevationProfile";
import { TrackStatsBody } from "../tracks/TrackStatsBody";
import { setVectorImportVisible, type VectorImport } from "./importsDb";
import { useImportedTrackDetail } from "./useImportedTrackDetail";

export function ImportOptionsSheet({
  imported,
  visible,
  onClose,
  onShowOnMap,
  onInfo,
  onError,
  allowNetwork = true,
}: {
  imported: VectorImport | null;
  visible: boolean;
  onClose: () => void;
  /**
   * Fly the map to this import. Saved-only — the map surface omits it, because
   * the user got here by tapping the file's own features (DESIGN.md §7:
   * "View on map" is the one row the two surfaces differ by).
   */
  onShowOnMap?: (bbox: Bbox) => void;
  onInfo: (message: string) => void;
  onError: (message: string) => void;
  /** False in "Simulating offline mode" — the stats sub-mode then reads
   *  elevation only from tiles already on the phone. */
  allowNetwork?: boolean;
}) {
  const [renaming, setRenaming] = useState(false);
  const [showingStats, setShowingStats] = useState(false);
  const [attaching, setAttaching] = useState(false);
  // Rendered in this sheet rather than handed to the caller: this component is
  // the map's import options as well as Saved's, and a callback would have
  // given the verb only to whichever surface remembered to pass it.
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const online = useConnectivity() === "online";

  // EVERY sub-mode resets when the sheet closes. This component stays mounted
  // between openings — `visible` is a prop, not a remount — so a sub-mode left
  // set means the NEXT open lands inside it instead of on the verb list. That
  // shipped twice: the route sheet opened straight into its share panel, and
  // the options list became unreachable.
  useEffect(() => {
    if (!visible) {
      setRenaming(false);
      setSending(false);
      setShowingStats(false);
      setAttaching(false);
    }
  }, [visible]);

  // Reading the stored GeoJSON back is the expensive part, so it runs only
  // while that sub-mode is actually open.
  const { detail, loading, error, line } = useImportedTrackDetail(
    imported,
    visible && showingStats && imported != null,
  );
  const { profile: demProfile, loading: demLoading } = useElevationProfile(line, {
    allowNetwork,
  });

  const shareRowProps = useShareRowProps(online);
  const actions = imported ? vectorImportActions(imported) : null;
  // THE sharing panel, in its "send a copy" mode — the same component every
  // other surface renders, with the wording the one non-revocable verb needs.
  const share = useSharePanel({
    target: actions?.sendCopy ? { kind: "copy", sendCopy: actions.sendCopy } : null,
    itemLabel: imported?.name ?? "",
    online,
    active: sending,
    onSent: (count) => {
      setSending(false);
      onClose();
      onInfo(`Sent a copy to ${count} friend${count === 1 ? "" : "s"}.`);
    },
  });

  // THE canyon picker, as a sub-mode of this sheet — the same panel the route
  // and track sheets render. Called unconditionally, like the share panel.
  const canyonPicker = useCanyonPicker({
    source: "import",
    active: attaching,
    attach: async (canyonId, canyonName) => {
      if (!actions?.attachToCanyon) throw new Error("This import has no original file.");
      await actions.attachToCanyon(canyonId);
      onInfo(`Attached a copy as ${canyonName}'s route.`);
    },
    onDone: () => {
      setAttaching(false);
      onClose();
    },
    onError,
  });

  if (!imported || !actions) return null;

  const close = () => {
    setRenaming(false);
    setSending(false);
    setShowingStats(false);
    setAttaching(false);
    onClose();
  };

  const save = (option: { run: () => Promise<string | null> }) => {
    close();
    option.run().then(
      (filename) => {
        // Null = the user backed out of the folder picker. Not a failure, and a
        // toast claiming success would be a lie.
        if (filename) onInfo(`Saved ${filename}.`);
      },
      (err: unknown) => {
        if (err instanceof ExportUnsupportedError) {
          onError(err.message);
          return;
        }
        console.error(err);
        onError("Couldn't save that file.");
      },
    );
  };

  // Every sub-mode backs out to the verb list; only the list itself closes the
  // sheet (DESIGN.md §6 — a sub-mode swaps the content, it never stacks).
  const leaveSubMode = renaming
    ? () => setRenaming(false)
    : sending
      ? () => setSending(false)
      : showingStats
        ? () => setShowingStats(false)
        : attaching
          ? () => setAttaching(false)
          : null;

  return (
    <BottomSheet
      visible={visible}
      onClose={leaveSubMode ?? close}
      // The stats sub-mode keeps the file's own name: it is the same subject,
      // seen as numbers.
      title={
        renaming
          ? "Rename import"
          : sending
            ? share.title
            : attaching
              ? "Attach to a canyon"
              : imported.name
      }
      onBack={leaveSubMode ?? undefined}
      footer={sending ? share.footer : undefined}
      header={attaching ? canyonPicker.header : undefined}
    >
      {sending && actions.sendCopy ? (
        share.body
      ) : attaching ? (
        canyonPicker.body
      ) : renaming ? (
        <View style={styles.body}>
          <RenameForm
            initialName={imported.name}
            onSubmit={(changed) => {
              if (!changed.name || !actions.rename) {
                close();
                return;
              }
              setBusy(true);
              actions
                .rename(changed.name)
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
        <View style={styles.body}>
          {/* No `elapsedMs`: an import has no wall-clock recording time, only
              whatever span its own timestamps describe — and a file without
              `<time>` renders no time-derived cell at all. */}
          <TrackStatsBody
            detail={detail}
            loading={loading}
            demProfile={demProfile}
            demLoading={demLoading}
            emptyMessage={
              error ?? "No lines in this file — stats describe a walked line."
            }
          />
        </View>
      ) : (
        <View style={styles.body}>
          {/* The one row the two surfaces differ by, and it leads the list. */}
          {onShowOnMap && actions.locatable ? (
            <Row
              title="Show on map"
              icon="map-pin"
              hue={assetHue.import}
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
          {/* Worded as a STATE, not as the "Show on map" verb above it: one
              draws the file, the other flies to it (DESIGN.md §7). */}
          <Row
            title="Visible on the map"
            icon="eye"
            hue={assetHue.import}
            right={
              <Toggle
                value={imported.visible}
                accessibilityLabel={`Show ${imported.name} on the map`}
                onValueChange={(next) => {
                  setVectorImportVisible(imported.id, next).catch(console.error);
                }}
              />
            }
          />
          <Row
            title="View stats"
            subtitle="Distance, climb, pace and profiles"
            icon="bar-chart-2"
            hue={assetHue.import}
            disabled={busy}
            onPress={() => setShowingStats(true)}
          />
          {/* Absent on a row with no retained original, and on a GeoJSON one:
              a canyon route attachment is track media, so there would be
              nothing legal to upload (assetActions.ts withholds the verb). */}
          {actions.attachToCanyon ? (
            <Row
              title="Attach to a canyon"
              subtitle="As that canyon's route"
              icon="link"
              hue={assetHue.route}
              disabled={busy}
              onPress={() => setAttaching(true)}
            />
          ) : null}
          {actions.exports?.map((option) => (
            <Row
              key={option.title}
              title={option.title}
              icon="download"
              hue={theme.bonus1}
              disabled={busy}
              onPress={() => save(option)}
            />
          ))}
          {/* NOT "Share": an import is a file on this handset with no server
              record to grant a view of, so the friend keeps the copy and there
              is no taking it back. The two verbs must never read alike. */}
          {actions.sendCopy ? (
            <Row
              title="Send a copy"
              icon="send"
              hue={theme.bonus1}
              {...shareRowProps}
              disabled={busy || shareRowProps.disabled}
              onPress={() => setSending((open) => !open)}
            />
          ) : null}
          {actions.rename ? (
            <Row
              title="Rename"
              icon="edit-2"
              hue={theme.bonus1}
              disabled={busy}
              onPress={() => setRenaming(true)}
            />
          ) : null}
          {/* "From device", not "Delete import": an import never syncs, so this
              is a statement about this handset and nothing else. */}
          {actions.delete ? (
            <Row
              title="Delete from device"
              icon="trash-2"
              hue={theme.warning}
              disabled={busy}
              onPress={() => {
                const removal = actions.delete!;
                close();
                Alert.alert(removal.confirmTitle, removal.confirmBody, [
                  { text: "Keep it", style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: () =>
                      removal.run().catch((err: unknown) => {
                        console.error(err);
                        onError("Couldn't delete that import.");
                      }),
                  },
                ]);
              }}
            />
          ) : null}
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing(1) },
});
