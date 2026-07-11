import { useState } from "react";
import { Typography } from "@mui/material";
import type { TripLogCustomFieldDef } from "@logjam/shared";
import ConfirmDialog from "./ConfirmDialog";
import { ErrorBanner } from "../feedback/ErrorBanner";
import { deleteCustomField } from "../../canyonUtils";
import { messageFromError } from "../../errors/messageFromError";
import { useCustomFieldImpact } from "./useCustomFieldImpact";

/**
 * Confirm-and-delete dialog for a custom trip field, shared between the
 * Account panel's field manager and TripLogDialog's per-field delete. Shows an
 * impact warning ("N trip logs carry a value…") fetched from the server before
 * the user confirms. Deleting removes the field definition AND permanently
 * strips its stored values from those trips (one transaction, server-side).
 */
function DeleteCustomFieldDialog({
  def,
  onClose,
  onDeleted,
}: {
  // The field being deleted; null = closed.
  def: TripLogCustomFieldDef | null;
  onClose: () => void;
  // Fired with the surviving definitions after a successful delete.
  onDeleted: (remainingDefs: TripLogCustomFieldDef[]) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { count, error: impactError } = useCustomFieldImpact(def?.key ?? null);

  async function handleConfirm() {
    if (!def) return;
    setDeleting(true);
    setError(null);
    try {
      const result = await deleteCustomField(def.key);
      onDeleted(result.tripLogCustomFields);
      onClose();
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Couldn't delete the custom field. Please try again."));
    } finally {
      setDeleting(false);
    }
  }

  function handleClose() {
    if (deleting) return;
    setError(null);
    onClose();
  }

  return (
    <ConfirmDialog
      open={def !== null}
      title={`Delete "${def?.label ?? ""}"?`}
      message={
        <>
          <Typography component="span" variant="body2" sx={{ display: "block" }}>
            This removes the field from all your trip logs.{" "}
            {count === null && !impactError && "Checking how many trips use it…"}
            {count !== null &&
              (count === 0
                ? "No trip logs currently have a value for this field."
                : `${count} trip log${count === 1 ? " has" : "s have"} a value for this field — ${
                    count === 1 ? "that value" : "those values"
                  } will be permanently removed.`)}
          </Typography>
          <Typography
            component="span"
            variant="body2"
            sx={{ display: "block", mt: 1, color: "var(--theme-text-muted)" }}
          >
            This cannot be undone.
          </Typography>
          {impactError && <ErrorBanner message={impactError} />}
          {error && <ErrorBanner message={error} />}
        </>
      }
      confirmLabel="Delete field"
      busy={deleting}
      onConfirm={handleConfirm}
      onClose={handleClose}
    />
  );
}

export default DeleteCustomFieldDialog;
