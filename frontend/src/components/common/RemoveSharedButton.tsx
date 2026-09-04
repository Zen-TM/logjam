// "Get this out of my account" for something a friend shared WITH you — the
// one control behind it on every web surface that lists shared things: canyons,
// waypoints, routes, LiDAR topos and GeoPDFs.
//
// It is NOT a delete and must never be styled or worded as one. The owner keeps
// their row; this drops the caller's own share (`DELETE .../me`, which both
// share endpoints have always accepted), so the confirm comes from
// `removeShareConfirm` in shared/src/sharing.ts rather than from five panels
// wording the same promise five ways.
//
// Only ever rendered where `sharedRowVisibility` says "direct". A waypoint or
// route seen through a shared canyon has no share row of its own to drop, and
// the surfaces point at the canyon instead.
import { useState, type ReactNode } from "react";
import { X } from "lucide-react";

import ConfirmDialog from "../dialogs/ConfirmDialog";
import { useToast } from "../feedback/ToastProvider";
import { messageFromError } from "../../errors/messageFromError";
import shared from "../../styles/shared.module.css";
import { removeShareConfirm } from "@logjam/shared";

export default function RemoveSharedButton({
  kindLabel,
  itemName,
  ownerName,
  className,
  title,
  children,
  disabled = false,
  remove,
  onRemoved,
}: {
  /** Lower-case kind as it reads mid-sentence: "canyon", "waypoint", "topo". */
  kindLabel: string;
  itemName: string;
  /** The owner's username where the surface knows it; the copy softens if not. */
  ownerName?: string | null;
  /** Trigger styling, so an icon row and a button row can both use this. */
  className?: string;
  title?: string;
  children?: ReactNode;
  disabled?: boolean;
  /** The revoke itself — `unshareCanyonWith(id, "me")` or its `/shares` twin. */
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
      toast.success(`${itemName} removed.`);
      onRemoved();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, `Couldn't remove that ${kindLabel}.`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={className ?? `${shared.btn} ${shared.btnGhost} ${shared.btnSm}`}
        title={title ?? `Remove this shared ${kindLabel}`}
        disabled={disabled || busy}
        onClick={() => setConfirming(true)}
      >
        {children ?? (
          <>
            <X size={14} /> Remove
          </>
        )}
      </button>

      <ConfirmDialog
        open={confirming}
        title={confirm.title}
        message={confirm.body}
        confirmLabel="Remove"
        // Not `error`: removing a share destroys nothing, and the red button
        // the delete confirms use would say otherwise.
        confirmColor="primary"
        busy={busy}
        onConfirm={() => void handleConfirm()}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}
