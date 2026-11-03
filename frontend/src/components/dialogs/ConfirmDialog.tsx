import type { ReactNode } from "react";
import type { ConfirmCopy } from "@logjam/shared";
import { Button, Dialog } from "../../ui";

/**
 * The confirm every destructive or irreversible verb raises, on the kit
 * `Dialog`. The copy says what goes and what stays (DESIGN.md). Cancel
 * first, then the verb on the right: a warning fill and glyph for a
 * `destructive` tone, the accent fill for a `filled` one that loses nothing
 * (Rename, Fetch from RopeWiki). `children` sit under the body (a choice that
 * belongs to the confirm). While `busy`, both buttons wait and nothing
 * dismisses it. `confirmDisabledReason` holds the verb back until the choice in
 * `children` is made, and says why. `copy` is null once the verb is closed. Small and centred at
 * every width.
 */
function ConfirmDialog({
  open,
  copy,
  busy = false,
  confirmDisabledReason,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  copy: ConfirmCopy | null | undefined;
  busy?: boolean;
  confirmDisabledReason?: string;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const hold = confirmDisabledReason
    ? ({ disabled: true, disabledReason: confirmDisabledReason } as const)
    : {};
  return (
    <Dialog
      open={open}
      title={copy?.confirmTitle ?? ""}
      onClose={onClose}
      dismissible={!busy}
      alert
      footer={
        <>
          <Button onClick={onClose} disabled={busy} disabledReason="Working…">
            Cancel
          </Button>
          {copy?.tone === "filled" ? (
            <Button variant="filled" busy={busy} onClick={onConfirm} {...hold}>
              {copy.confirmLabel}
            </Button>
          ) : (
            <Button
              variant="destructive"
              icon={copy?.icon ?? "delete"}
              busy={busy}
              onClick={onConfirm}
              {...hold}
            >
              {copy?.confirmLabel}
            </Button>
          )}
        </>
      }
    >
      {copy?.confirmBody}
      {children}
    </Dialog>
  );
}

export default ConfirmDialog;
