// "Get this out of my account" for something a friend shared WITH you — the
// one control behind it on every web surface that lists shared things: places,
// waypoints, routes and LiDAR topos.
//
// It is NOT a delete and must never be styled or worded as one (shared/src/sharing.test.ts). The owner keeps
// their row; this drops the caller's own share (`DELETE .../me`, which both
// share endpoints have always accepted), so the confirm comes from
// `removeShareConfirm` in shared/src/sharing.ts rather than from five panels
// wording the same promise five ways.
//
// Only ever rendered where `sharedRowVisibility` says "direct". A waypoint or
// route seen through a shared place has no share row of its own to drop, and
// the surfaces point at the place instead.
import { useState, type ReactNode } from "react";

import ConfirmDialog from "../dialogs/ConfirmDialog";
import { useToast } from "../feedback/ToastProvider";
import { messageFromError } from "../../errors/messageFromError";
import { Button, Icon } from "../../ui";
import { removeShareConfirm, t } from "@logjam/shared";

function removeFailedMessage(kindLabel: string): string {
  switch (kindLabel) {
    case "place":
      return t`Couldn't remove that place.`;
    case "route":
      return t`Couldn't remove that route.`;
    case "topo":
      return t`Couldn't remove that LiDAR map.`;
    case "sharpened area":
      return t`Couldn't remove that sharpened area.`;
    default:
      return t`Couldn't remove that.`;
  }
}

function removeButtonTitle(kindLabel: string): string {
  switch (kindLabel) {
    case "place":
      return t`Remove this shared place`;
    case "route":
      return t`Remove this shared route`;
    case "topo":
      return t`Remove this shared LiDAR map`;
    case "sharpened area":
      return t`Remove this shared sharpened area`;
    default:
      return t`Remove this shared item`;
  }
}

export default function RemoveSharedButton({
  kindLabel,
  itemName,
  ownerName,
  className,
  title,
  children,
  disabledReason,
  remove,
  onRemoved,
}: {
  /** Lower-case kind as it reads mid-sentence: "place", "waypoint", "topo". */
  kindLabel: string;
  itemName: string;
  /** The owner's username where the surface knows it; the copy softens if not. */
  ownerName?: string | null;
  /** Trigger styling, so an icon row and a button row can both use this. */
  className?: string;
  title?: string;
  children?: ReactNode;
  /** Why the button is off while the surface is busy with something else. */
  disabledReason?: string;
  /** The revoke itself — `unsharePlaceWith(id, "me")` or its `/shares` twin. */
  remove: () => Promise<unknown>;
  /** Re-pull whatever list this row came from; the row is gone now. */
  onRemoved: () => void;
}): React.JSX.Element {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirm = removeShareConfirm({ kindLabel, itemName, ownerName });

  async function handleConfirm() {
    setBusy(true);
    try {
      await remove();
      setConfirming(false);
      toast.done(t`${itemName} removed.`);
      onRemoved();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, removeFailedMessage(kindLabel)));
    } finally {
      setBusy(false);
    }
  }

  const label = title ?? removeButtonTitle(kindLabel);
  const off = busy ? t`Removing…` : disabledReason;

  return (
    <>
      {/* A caller that brings its own class is a panel not yet rebuilt onto the
          kit, and keeps the icon row or button it already styles. Everything
          else gets the kit's own button: the bare `.btn btnGhost` styling looks
          out of place beside rebuilt controls. */}
      {className ? (
        <button
          type="button"
          className={className}
          title={label}
          disabled={Boolean(off)}
          onClick={() => setConfirming(true)}
        >
          {children ?? (
            <>
              <Icon idea="hide" size={14} /> {t`Remove`}
            </>
          )}
        </button>
      ) : (
        <Button
          compact
          variant="outline"
          icon="hide"
          title={label}
          disabled={Boolean(off)}
          disabledReason={off ?? ""}
          onClick={() => setConfirming(true)}
        >
          {children ?? t`Remove`}
        </Button>
      )}

      <ConfirmDialog
        open={confirming}
        // Not destructive: removing a share destroys nothing, and the warning
        // button the delete confirms use would say otherwise.
        copy={{
          confirmTitle: confirm.title,
          confirmBody: confirm.body,
          confirmLabel: t`Remove`,
          tone: "filled",
        }}
        busy={busy}
        onConfirm={() => void handleConfirm()}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}
