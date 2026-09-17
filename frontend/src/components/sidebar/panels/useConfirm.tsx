// One confirm for a whole page, asked for by whichever verb needs it — the Maps
// views raise a dozen different confirms and hold one dialog for all of them.
import { useCallback, useState, type ReactNode } from "react";
import ConfirmDialog from "../../dialogs/ConfirmDialog";

type ConfirmRequest = {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  /** `primary` when nothing is destroyed (removing a share). */
  tone?: "error" | "primary";
  /** Reports its own failure; the dialog closes when it settles either way. */
  run: () => Promise<void>;
};

/** One confirm for a whole view, asked for by whichever verb needs it. */
export function useConfirm(): { ask: (request: ConfirmRequest) => void; dialog: ReactNode } {
  const [pending, setPending] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await pending.run();
    } finally {
      setBusy(false);
      setPending(null);
    }
  }, [pending]);

  return {
    ask: setPending,
    dialog: (
      <ConfirmDialog
        open={pending != null}
        title={pending?.title ?? ""}
        message={pending?.message}
        confirmLabel={pending?.confirmLabel}
        confirmColor={pending?.tone ?? "error"}
        busy={busy}
        onConfirm={() => void confirm()}
        onClose={() => setPending(null)}
      />
    ),
  };
}
