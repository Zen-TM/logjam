import type { ReactNode } from "react";
import { Button, Dialog } from "../../ui";

/**
 * The confirm every destructive or irreversible verb raises, on the kit
 * `Dialog`. `message` says what goes and what stays (DESIGN.md §7). Cancel
 * first, then the verb on the right: a warning fill for the default `error`,
 * the accent fill for a confirm that loses nothing (Rename, Fetch from
 * RopeWiki). While `busy`, both buttons wait and nothing dismisses it.
 * Small and centred at every width.
 */
function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  confirmColor = "error",
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: ReactNode;
  message: ReactNode;
  confirmLabel?: string;
  confirmColor?: "error" | "primary" | "secondary";
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      dismissible={!busy}
      alert
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={confirmColor === "error" ? "destructive" : "filled"}
            busy={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message}
    </Dialog>
  );
}

export default ConfirmDialog;
