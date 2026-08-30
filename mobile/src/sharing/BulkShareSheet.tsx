// The sheet the selection bar's share button opens, on every screen that has
// one.
//
// It exists so Canyons and Saved cannot drift: both hand it the rows they have
// selected, and everything else — the triage line, which verb each row gets,
// both promise banners, the confirm, the upload queue's progress and the
// sentence afterwards — is decided once, below the two screens rather than
// inside each of them. That is the same rule `assetActions.ts` and
// `SharePanel.tsx` already hold the single-item verbs to (DESIGN.md §7); a bulk
// share is a bigger promise made about more rows at once, so it is the last
// place two surfaces should get to word things their own way.
//
// It is a component rather than another hook because, unlike the single-item
// panel, it has no parent sheet to be a sub-mode OF: a multi-selection is not
// an item, so there is no item sheet already open. It owns its own
// `BottomSheet` and the panel's footer goes in the pinned slot (DESIGN.md §6).
import { useMemo } from "react";

import { BottomSheet, IconButton } from "../ui";
import { theme } from "../theme";
import { useShareRowProps, useSharePanel } from "./SharePanel";
import {
  bulkShareOutcomeMessage,
  planBulkShareSelection,
  type BulkShareCandidate,
  type BulkShareOutcome,
} from "./bulkShareTargets";

/**
 * The selection bar's share verb, for the bar's `extra` slot.
 *
 * `share-2` and NOT `send`: the paper plane already means the irrevocable verb
 * on the copy panel's own footer button, and this one bar action stands for
 * BOTH verbs at once. Reusing the plane here would promise the wrong one for
 * every selection that is all shares.
 *
 * It stays TAPPABLE when sharing is unavailable, and only dims. The panel it
 * opens already states the reason in place of its body (DESIGN.md §10) — a
 * dead glyph could only be a mystery, and this is the bar's newest button, so
 * it is the one a user is most likely to go looking for and not find.
 */
export function BulkShareButton({
  online,
  onPress,
}: {
  online: boolean;
  onPress: () => void;
}) {
  const { disabled } = useShareRowProps(online);
  return (
    <IconButton
      icon="share-2"
      accessibilityLabel="Share the selected items"
      color={disabled ? theme.textMuted : theme.accent}
      onPress={onPress}
    />
  );
}

export function BulkShareSheet<C extends BulkShareCandidate>({
  visible,
  selection,
  online,
  onClose,
  onDone,
}: {
  visible: boolean;
  /** The rows currently picked, in the screen's own order. */
  selection: C[];
  online: boolean;
  onClose: () => void;
  /**
   * The run finished. The screen closes the sheet, clears its selection and
   * shows `text` at `tone` — never its own wording, because a run where six of
   * eight files went is neither "sent" nor "failed" and two screens choosing
   * their own word for it is exactly the drift this sheet prevents.
   */
  onDone: (report: { text: string; tone: "info" | "error" }) => void;
}) {
  // Memoised on the selection, not rebuilt per render: `useSharePanel` keys its
  // reset effect on the plan's CONTENT for that reason, and an unstable plan
  // would also re-run the triage on every keystroke in the friend search.
  const plan = useMemo(() => planBulkShareSelection(selection), [selection]);

  const panel = useSharePanel({
    target: visible ? { kind: "bulk", plan } : null,
    // Unused by the bulk branch — a selection has no one name — but the panel
    // needs the prop for its title fallback when there is no target at all.
    itemLabel: "these items",
    online,
    enabled: visible,
    active: visible,
    onBulkDone: (outcome: BulkShareOutcome) => {
      onDone(bulkShareOutcomeMessage(outcome));
    },
  });

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
