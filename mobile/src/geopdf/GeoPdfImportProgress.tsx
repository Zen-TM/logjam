// The screen a GeoPDF import owns while it runs.
//
// WHY IT TAKES THE SCREEN. An import is not a background job, and pretending
// otherwise is what made the app read as broken. Its opening phases run in
// JavaScript on the UI thread and cannot be yielded out of: the picked file is
// read into memory whole, hashed, written back, and then handed to pdf-lib,
// which parses the entire document object graph in one synchronous pass. On a
// large sheet that is seconds to tens of seconds during which NOTHING in the
// app can respond — taps, scrolls and animations all queue up behind it. The
// later phases (rasterising and overviews) do run off the JS thread, on the
// native module's own worker, so the app breathes again once they start.
//
// So the honest UI is a surface that says "this is what the app is doing" for
// the whole run, rather than a progress row on a list the user can try to
// scroll and find frozen. Cancel is offered because it is real — the rasteriser
// checks the token between batches — but it cannot interrupt the parse, which
// is why the copy says the early phases have to finish.
//
// PRIVACY: the label is the user's own file name. Nothing else about the file
// (path, extent, contents) is shown or logged.
import { Modal, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { assetHue, fontSize, fontWeight, spacing, theme, withAlpha } from "../theme";
import { Button } from "../ui";
import type { GeoPdfImportState } from "./geoPdfImportsDb";

/**
 * What each phase is actually doing, in the user's terms. "Reading" covers the
 * three front phases at once: they are one indivisible stretch of blocked UI,
 * and naming them separately would only flicker three labels past too fast to
 * read.
 */
const PHASE_LABEL: Record<GeoPdfImportState, string> = {
  copying: "Reading the file",
  hashing: "Reading the file",
  parsing: "Reading the map's georeferencing",
  planning: "Working out the tiles",
  rasterising: "Rendering the map",
  overviews: "Building the zoomed-out levels",
  finalising: "Finishing up",
  ready: "Done",
  failed: "That didn't work",
};

/**
 * The phases that hold the UI thread. Cancel is dropped here rather than shown
 * doing nothing: the token is only read between rasteriser batches, so a Cancel
 * offered during the parse would be a button that ignores you.
 */
const BLOCKING_PHASES: GeoPdfImportState[] = ["copying", "hashing", "parsing", "planning"];

export function GeoPdfImportProgress({
  visible,
  label,
  phase,
  fraction,
  onCancel,
}: {
  visible: boolean;
  /** The file being imported, as the user named it. */
  label: string;
  phase: GeoPdfImportState;
  /** 0–1 within the measurable phases, null while the phase has no count. */
  fraction: number | null;
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  const blocking = BLOCKING_PHASES.includes(phase);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      // No onRequestClose dismissal: hardware back during an import would drop
      // the user onto a list while the thread is still busy, which is the
      // confusion this screen exists to remove. Cancel is the way out.
      onRequestClose={() => {}}
    >
      <View
        style={[
          styles.root,
          { paddingTop: insets.top + spacing(2), paddingBottom: insets.bottom + spacing(2) },
        ]}
      >
        <View style={styles.body}>
          <Text style={styles.eyebrow}>GeoPDF import</Text>
          <Text style={styles.title} numberOfLines={2}>
            {label}
          </Text>
          <Text style={styles.phase}>{PHASE_LABEL[phase]}</Text>

          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                fraction != null
                  ? { width: `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%` }
                  : // No count yet: a full-width bar at low opacity says "busy,
                    // don't read a percentage into this" without a spinner that
                    // would freeze mid-rotation whenever the thread blocks.
                    styles.indeterminate,
              ]}
            />
          </View>

          <Text style={styles.note}>
            {blocking
              ? "Reading a large map takes a while, and the app can't respond until it's done. Leave Logjam open."
              : "Keep Logjam open. You can cancel and finish this later from Saved."}
          </Text>
        </View>

        <Button
          label="Cancel this import"
          variant="ghost"
          onPress={onCancel}
          // Honest rather than optimistic: the cancel token is read between
          // rasteriser batches, so during the front phases there is nothing for
          // it to interrupt.
          disabled={blocking}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.primary,
    paddingHorizontal: spacing(3),
    justifyContent: "space-between",
  },
  body: { flex: 1, justifyContent: "center", gap: spacing(1) },
  eyebrow: {
    color: theme.textMuted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  title: {
    color: theme.textPrimary,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  phase: { color: theme.textPrimary, fontSize: fontSize.base },
  track: {
    height: 6,
    borderRadius: 3,
    marginTop: spacing(1),
    backgroundColor: withAlpha(theme.textPrimary, 0.12),
    overflow: "hidden",
  },
  fill: { height: 6, borderRadius: 3, backgroundColor: assetHue.geoPdf },
  indeterminate: { width: "100%", opacity: 0.35 },
  note: {
    color: theme.textMuted,
    fontSize: fontSize.sm,
    lineHeight: 20,
    marginTop: spacing(1),
  },
});
