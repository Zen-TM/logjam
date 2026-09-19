// The sheet behind "Save a copy" and "Save a copy and remove".
//
// IT IS A SHEET RATHER THAN AN ALERT for one reason: the media switch. A copy
// spends the copier's storage quota when it brings photos, and that is a choice
// the user gets to make — but the sane place to make it is on the copy itself,
// where the count and the size are in front of them, not in a first-run modal
// that asks about a future they cannot see yet. So the switch lives here,
// pre-set from the account's remembered `copyPlaceMedia`, and flipping it
// writes the new default back.
//
// THE SWITCH IS ABSENT WHEN THERE IS NOTHING TO DECIDE. Most places carry no
// photos at all, and a switch offering to copy zero of them is the kind of
// control that teaches people to stop reading controls.
//
// WHY IT ASKS AT ALL ON A PLAIN COPY. It does not, much — the confirm exists
// because "Save a copy" does not say where the copy goes or what happens when
// the friend stops sharing (`copyConfirm` has always said so). What is NEW is
// the remove variant, and there the sentence has to name what the copy leaves
// behind: after the remove there is no second chance to notice.
//
// PRIVACY: place names reach this sheet — a user cannot decide about "3 things"
// — and nothing here logs.
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { copyAndRemoveConfirm, messageFromError , copyConfirm } from "@logjam/shared";

import { apiFetch } from "../api/apiFetch";
import { fetchCurrentUser, useApiQuery } from "../api/queries";
import { useAccountState } from "../auth/AccountStateContext";
import type { TUser } from "../api/types";
import { formatBytes } from "../format";
import { listMediaForLinked } from "../sync/mirrorStore";
import { fontSize, lineHeight, spacing, theme } from "../theme";
import { BottomSheet, Button, Row, Toggle } from "../ui";
import type { CopyAndRemoveTarget } from "./copyAndRemove";

/** What the sheet found attached to the places being copied. */
type PlaceMediaTally = { count: number; bytes: number };

const NO_MEDIA: PlaceMediaTally = { count: 0, bytes: 0 };

/**
 * Place-level media across the targets, read from the MIRROR.
 *
 * The phone already holds these rows — place-level media is part of what a
 * sharee can see — so the count and the size need no request, and the sheet can
 * state both while offline even though the copy itself cannot run.
 */
async function tallyPlaceMedia(
  targets: CopyAndRemoveTarget[],
): Promise<PlaceMediaTally> {
  const places = targets.filter((target) => target.entityType === "place");
  let count = 0;
  let bytes = 0;
  for (const place of places) {
    for (const media of await listMediaForLinked("place", place.entityId)) {
      count += 1;
      bytes += media.fileSizeBytes ?? 0;
    }
  }
  return { count, bytes };
}

export type CopyPanelArgs = {
  /** Off while the panel is not on screen — it does no work then. */
  active: boolean;
  targets: CopyAndRemoveTarget[];
  /** "copy" keeps the share; "copyAndRemove" drops it once the copy lands. */
  mode: "copy" | "copyAndRemove";
  /**
   * The owner's username, where the surface knows it. NULL where it does not —
   * the confirms spell the generic fallback themselves, in both the
   * mid-sentence and the sentence-initial position.
   */
  friendName?: string | null;
  busy: boolean;
  online: boolean;
  /**
   * `copyMedia` is undefined when the panel never asked (no media to decide
   * about) — the server then uses the account's remembered value, which is the
   * same answer by a shorter route.
   */
  onConfirm: (options: { copyMedia?: boolean }) => void;
};

/**
 * The panel as `{ title, body, footer }`, for a surface that ALREADY OWNS A
 * SHEET to spread onto its own.
 *
 * The same shape and the same reason as `useSharePanel`: a place's options
 * sheet cannot open a second sheet over itself, so a verb whose panel needs
 * room is rendered as a sub-mode of the sheet that offers the verb. The footer
 * is separate because a sheet's primary action belongs in `BottomSheet`'s
 * pinned `footer` slot (DESIGN.md §6).
 */
export function useCopyPanel({
  active,
  targets,
  mode,
  friendName,
  busy,
  online,
  onConfirm,
}: CopyPanelArgs): { title: string; body: React.ReactNode; footer: React.ReactNode } {
  const visible = active;
  const { accountState } = useAccountState();
  // Gated on `active` as well as on having an account: this hook now lives
  // inside two sheets that stay MOUNTED between openings, so an ungated query
  // would fetch on every sheet mount for a panel nobody opened. (`/users/me` is
  // cached for 60 s in apiFetch, which makes the open itself free anyway.)
  const userQuery = useApiQuery(
    fetchCurrentUser,
    "Couldn't load your settings.",
    active && accountState !== "guest",
  );

  const [media, setMedia] = useState<PlaceMediaTally>(NO_MEDIA);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    void tallyPlaceMedia(targets)
      .then((tally) => {
        if (alive) setMedia(tally);
      })
      .catch((err: unknown) => {
        console.error(err);
        // A tally we could not read is reported as none: the switch disappears
        // and the copy falls back to the account preference, rather than the
        // sheet claiming a count it does not have.
        if (alive) setMedia(NO_MEDIA);
      });
    return () => {
      alive = false;
    };
  }, [visible, targets]);

  // Undefined until the account answers; the switch renders from the same
  // default the server would apply, so it never shows a position that is a lie.
  const remembered = userQuery.data?.uiPreferences?.copyPlaceMedia ?? true;
  const [copyMedia, setCopyMedia] = useState<boolean | null>(null);
  useEffect(() => {
    if (!visible) return;
    setCopyMedia(remembered);
  }, [visible, remembered]);

  /** Flipping the switch also moves the remembered default — that IS the memory. */
  const toggleMedia = useCallback(() => {
    setCopyMedia((current) => {
      const next = !(current ?? true);
      apiFetch<TUser>("/users/me", {
        method: "PATCH",
        body: { copyPlaceMedia: next },
      }).catch((err: unknown) => {
        // The copy still honours THIS sheet's answer (it is sent explicitly),
        // so a failed save costs the memory, not the action.
        console.error(messageFromError(err, "Couldn't save that preference."));
      });
      return next;
    });
  }, []);

  const one = targets.length === 1;
  const itemName = one ? targets[0].title : "";
  const kindLabel = one ? targets[0].entityType : "item";
  const withMedia = copyMedia ?? true;

  const confirm =
    mode === "copyAndRemove"
      ? copyAndRemoveConfirm({
          kindLabel,
          itemName: one ? itemName : `${targets.length} items`,
          ownerName: friendName,
          // The count only counts as "left behind" while the switch is off.
          mediaLeftBehind: withMedia ? 0 : media.count,
        })
      : copyConfirm({
          count: targets.length,
          friendName,
          ...(one ? { itemName, kindLabel } : {}),
        });

  return {
    title: confirm.title,
    body: (
      <>
        <Text style={styles.body}>{confirm.body}</Text>

        {media.count > 0 ? (
          <Row
            icon="image"
            title={
              media.count === 1
                ? "Also copy 1 photo or file"
                : `Also copy ${media.count} photos and files`
            }
            subtitle={`${formatBytes(media.bytes)} of your storage.`}
            right={
              <Toggle
                value={withMedia}
                onValueChange={toggleMedia}
                disabled={busy}
                accessibilityLabel="Also copy photos and files"
              />
            }
          />
        ) : null}

        {/* Dimmed with the reason rather than hidden — the same rule every
            share verb follows (`useShareRowProps`). */}
        {!online ? (
          <View style={styles.note}>
            <Text style={styles.noteText}>Saving a copy needs a connection.</Text>
          </View>
        ) : null}
      </>
    ),
    footer: (
      <Button
        label={mode === "copyAndRemove" ? "Save a copy and remove" : "Save a copy"}
        onPress={() => onConfirm(media.count > 0 ? { copyMedia: withMedia } : {})}
        disabled={busy || !online}
        loading={busy}
        grow
      />
    ),
  };
}

/**
 * The panel in a sheet of its own — for a surface with no sheet already open
 * (the per-friend screen's bulk bar and its row menu, which closes first).
 */
export function CopySheet({
  visible,
  onClose,
  ...args
}: Omit<CopyPanelArgs, "active"> & { visible: boolean; onClose: () => void }) {
  const panel = useCopyPanel({ ...args, active: visible });
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={panel.title}
      footer={panel.footer}
    >
      {panel.body}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    color: theme.textMuted,
    fontSize: fontSize.base,
    lineHeight: lineHeight.body,
    paddingHorizontal: spacing(2),
    paddingBottom: spacing(1.5),
  },
  note: { paddingHorizontal: spacing(2), paddingTop: spacing(1.5) },
  noteText: { color: theme.warning, fontSize: fontSize.sm },
});
