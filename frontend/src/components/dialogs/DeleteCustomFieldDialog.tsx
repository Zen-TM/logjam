import { useState } from "react";
import {
  attributeDeleteConfirm,
  SETTINGS_LIST,
  type ScopedCustomFieldDef,
  type TripLogCustomFieldDef,
} from "@logjam/shared";
import ConfirmDialog from "./ConfirmDialog";
import {
  deleteCustomField,
  type CustomFieldEntityKind,
} from "../../placeUtils";
import { messageFromError } from "../../errors/messageFromError";
import { useCustomFieldImpact } from "./useCustomFieldImpact";
import { ErrorBanner } from "../../ui";

// Entity-specific nouns. Both families store values keyed by the field's
// `key`; only the rows' name differs (trips vs places).
const ENTITY_ROWS: Record<
  CustomFieldEntityKind,
  { one: string; many: string }
> = {
  "trip-log": { one: "trip", many: "trips" },
  place: { one: "place", many: "places" },
};

/**
 * Confirm-and-delete for an attribute, shared across every surface that
 * deletes one: Settings' attribute lists (trip + place) and the
 * TripLogDialog/PlaceDialog per-field delete. Says how many trip logs or places
 * carry a value before the user confirms. Deleting removes the definition AND
 * permanently strips its stored values from those rows (one transaction,
 * server-side).
 */
function DeleteCustomFieldDialog({
  entity,
  def,
  onClose,
  onDeleted,
}: {
  // Which custom-field family this deletes (trip-log | place).
  entity: CustomFieldEntityKind;
  // The field being deleted; null = closed.
  def: TripLogCustomFieldDef | null;
  onClose: () => void;
  // Fired with the surviving definitions after a successful delete.
  onDeleted: (remainingDefs: ScopedCustomFieldDef[]) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { count, error: impactError } = useCustomFieldImpact(
    entity,
    def?.key ?? null,
  );
  const confirm = attributeDeleteConfirm(
    def?.label ?? "",
    count === null && impactError ? "unknown" : count,
    ENTITY_ROWS[entity],
  );

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
      setError(
        messageFromError(
          err,
          "Couldn't delete the attribute. Please try again.",
        ),
      );
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
      title={confirm.confirmTitle}
      message={
        <>
          <p>{confirm.confirmBody}</p>
          {impactError && <ErrorBanner message={impactError} />}
          {error && <ErrorBanner message={error} />}
        </>
      }
      confirmLabel={SETTINGS_LIST.copy.deleteAttribute}
      busy={deleting}
      onConfirm={handleConfirm}
      onClose={handleClose}
    />
  );
}

export default DeleteCustomFieldDialog;
