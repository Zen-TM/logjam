// Save a copy (`PLAN_ITEM_VERBS`): the caller's own copy of a plan item, in
// their places, ways or maps. The copy is theirs from then on, and changes on
// either side don't reach the other (`saveCopyLine`), so it confirms first;
// a place with photos asks whether they come, as a friend's copy does
// (`useRememberedCopyMedia`). Logjam Web's twin is
// frontend/src/components/plans/PlanItems.tsx's confirm. It works on an
// archived plan too.
//
// A PANEL, not only a sheet: the plan place sheet draws it as its own
// sub-mode (so a plan pin on the map has it too), and the way and map rows
// in this sheet (mobile/DESIGN.md §4, ADR 0016: the verb's panel lives with
// the verb, never handed to a caller as a callback).
import { useState } from "react";
import { Text, View } from "react-native";
import {
  ApiError,
  mediaSkippedSentence,
  messageFromError,
  PLAN_ITEM_VERBS,
  tripPlanSavedMessage,
  TRIP_PLAN_PAGE,
  type TripPlanItemKind,
} from "@logjam/shared";

import { unavailableReasonText } from "../auth/capabilities";
import { useRememberedCopyMedia } from "../sharing/rememberedCopyMedia";
import { requestSync } from "../sync/syncEngine";
import { makeStyles, muted, spacing } from "../theme";
import { BottomSheet, Button, ErrorBanner, SwitchRow } from "../ui";
import { savePlanItem } from "./plansApi";
import { afterPlanWrite } from "./plansCache";

const copy = TRIP_PLAN_PAGE.copy;
const OFFLINE = unavailableReasonText("needs-connection");
export const SAVE_A_COPY = PLAN_ITEM_VERBS.find((verb) => verb.id === "save")!;

export type SaveCopyTarget = {
  kind: TripPlanItemKind;
  id: string;
  title: string;
  /** A place's photos: the switch shows only when there are some. */
  photos: number;
};

/**
 * Save a copy's panel for `target`: the line, the photos switch, then Save in
 * the footer. A host passes `closable` to its BottomSheet, so a save in
 * flight can't be dismissed and land on the next target. `onFinished` closes
 * the host's sheet before the toast, which a Modal sheet would cover.
 */
export function useSaveCopyPanel({
  planId,
  target,
  online,
  onFinished,
  onDone,
}: {
  planId: string;
  /** Null while no panel is open. */
  target: SaveCopyTarget | null;
  online: boolean;
  onFinished: () => void;
  onDone: (message: string, tone: "info" | "error") => void;
}) {
  const styles = useStyles();
  const [withMedia, toggleMedia] = useRememberedCopyMedia(target !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Each target starts clean.
  const key = target ? `${target.kind}:${target.id}` : null;
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (key !== openedFor) {
    setOpenedFor(key);
    setError(null);
  }
  const asksPhotos = target?.kind === "place" && target.photos > 0;

  async function save(item: SaveCopyTarget) {
    setBusy(true);
    setError(null);
    try {
      const result = await savePlanItem(
        planId,
        item.kind,
        item.id,
        asksPhotos ? withMedia : undefined,
      );
      // The copy is a row of the caller's own, which reaches the phone by
      // the next sync pull: asked for now, so it shows at once.
      void requestSync().catch(console.error);
      const skipped = mediaSkippedSentence(
        result.mediaSkipped ?? 0,
        result.mediaOutOfSpace === true,
      );
      onFinished();
      onDone(
        [tripPlanSavedMessage(item.kind), skipped].filter(Boolean).join(" "),
        skipped ? "error" : "info",
      );
    } catch (err) {
      const message = messageFromError(err, copy.saveCopyFailed);
      if (err instanceof ApiError && err.status === 404) {
        // Gone from the plan: the refetch takes its sheet away, so the
        // reason is the page's toast, not a banner on a sheet that went.
        onFinished();
        onDone(message, "error");
      } else setError(message);
      // Fetched again, the page shows the plan as it is.
      if (err instanceof ApiError) await afterPlanWrite(planId);
    } finally {
      setBusy(false);
    }
  }

  return {
    closable: !busy,
    title: SAVE_A_COPY.label,
    body: target ? (
      <View style={styles.body}>
        <Text style={styles.line}>
          {target.title}. {copy.saveCopyLine}
        </Text>
        {asksPhotos ? (
          <SwitchRow
            title={copy.bringPhotos}
            checked={withMedia}
            disabled={busy}
            onChange={toggleMedia}
          />
        ) : null}
      </View>
    ) : null,
    footer: target ? (
      <View style={styles.footer}>
        {error ? <ErrorBanner message={error} /> : null}
        <Button
          label={SAVE_A_COPY.label}
          icon={SAVE_A_COPY.icon}
          loading={busy}
          disabled={!online}
          disabledReason={OFFLINE}
          onPress={() => void save(target)}
        />
        {online ? null : <Text style={styles.offline}>{OFFLINE}</Text>}
      </View>
    ) : undefined,
  };
}

/** Save a copy for a way or a map on the plan's Map tab. */
export function SaveCopySheet({
  planId,
  target,
  online,
  onClose,
  onDone,
}: {
  planId: string;
  /** Null while closed. */
  target: SaveCopyTarget | null;
  online: boolean;
  onClose: () => void;
  onDone: (message: string, tone: "info" | "error") => void;
}) {
  const panel = useSaveCopyPanel({
    planId,
    target,
    online,
    onFinished: onClose,
    onDone,
  });
  return (
    <BottomSheet
      visible={target !== null}
      onClose={onClose}
      closable={panel.closable}
      title={panel.title}
      footer={panel.footer}
    >
      {panel.body}
    </BottomSheet>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  body: { gap: spacing(1.5) },
  line: { ...textRole.body, color: theme.text },
  offline: { ...muted(theme, textRole.detail), textAlign: "center" },
  footer: { gap: spacing(1) },
}));
