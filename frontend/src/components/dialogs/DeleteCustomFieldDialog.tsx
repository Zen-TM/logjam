import { useState } from "react";
import { Typography } from "@mui/material";
import type { TripLogCustomFieldDef } from "@logjam/shared";
import ConfirmDialog from "./ConfirmDialog";
import { ErrorBanner } from "../feedback/ErrorBanner";
import { deleteCustomField, type CustomFieldEntityKind } from "../../canyonUtils";
import { messageFromError } from "../../errors/messageFromError";
import { useCustomFieldImpact } from "./useCustomFieldImpact";

// Entity-specific copy nouns. Both families store values keyed by the field's
// `key`; only the surface wording differs (trip logs vs canyons).
const ENTITY_COPY: Record<
  CustomFieldEntityKind,
  { removesFrom: string; singular: string; plural: string }
> = {
  "trip-log": {
    removesFrom: "all your trip logs",
    singular: "trip log",
    plural: "trip logs",
  },
  canyon: {
    removesFrom: "all your canyons",
    singular: "canyon",
    plural: "canyons",
  },
};

/**
 * Confirm-and-delete dialog for a custom field, shared across every surface that
 * deletes one: the Account panel's field managers (trip + canyon) and the
 * TripLogDialog/CanyonDialog per-field delete. Shows an impact warning ("N trip
 * logs / canyons carry a value…") fetched from the server before the user
 * confirms. Deleting removes the field definition AND permanently strips its
 * stored values from those rows (one transaction, server-side).
 */
function DeleteCustomFieldDialog({
  entity,
  def,
  onClose,
  onDeleted,
}: {
  // Which custom-field family this deletes (trip-log | canyon).
  entity: CustomFieldEntityKind;
  // The field being deleted; null = closed.
  def: TripLogCustomFieldDef | null;
  onClose: () => void;
  // Fired with the surviving definitions after a successful delete.
  onDeleted: (remainingDefs: TripLogCustomFieldDef[]) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { count, error: impactError } = useCustomFieldImpact(entity, def?.key ?? null);
  const copy = ENTITY_COPY[entity];

  async function handleConfirm() {
    if (!def) return;
    setDeleting(true);
    setError(null);
    try {
      const result = await deleteCustomField(entity, def.key);
      onDeleted(result.remainingDefs);
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
            This removes the field from {copy.removesFrom}.{" "}
            {count === null && !impactError && `Checking how many ${copy.plural} use it…`}
            {count !== null &&
              (count === 0
                ? `No ${copy.plural} currently have a value for this field.`
                : `${count} ${count === 1 ? copy.singular : copy.plural} ${
                    count === 1 ? "has" : "have"
                  } a value for this field — ${
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
