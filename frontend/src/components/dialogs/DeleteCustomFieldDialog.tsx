import { useState } from "react";
import type { ScopedCustomFieldDef, TripLogCustomFieldDef } from "@logjam/shared";
import ConfirmDialog from "./ConfirmDialog";
import { ErrorBanner } from "../feedback/ErrorBanner";
import { deleteCustomField, type CustomFieldEntityKind } from "../../placeUtils";
import { messageFromError } from "../../errors/messageFromError";
import { useCustomFieldImpact } from "./useCustomFieldImpact";

// Entity-specific copy nouns. Both families store values keyed by the field's
// `key`; only the surface wording differs (trip logs vs places).
const ENTITY_COPY: Record<
  CustomFieldEntityKind,
  { removesFrom: string; singular: string; plural: string }
> = {
  "trip-log": {
    removesFrom: "all your trip logs",
    singular: "trip log",
    plural: "trip logs",
  },
  place: {
    removesFrom: "all your places",
    singular: "place",
    plural: "places",
  },
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
      setError(messageFromError(err, "Couldn't delete the attribute. Please try again."));
    } finally {
      setDeleting(false);
    }
  }

  function handleClose() {
    if (deleting) return;
    setError(null);
    onClose();
  }

  const impact =
    count === null
      ? impactError
        ? ""
        : `Checking how many ${copy.plural} use it…`
      : count === 0
        ? `No ${copy.plural} have a value for it.`
        : `${count} ${count === 1 ? copy.singular : copy.plural} ${count === 1 ? "has" : "have"} a value for it, and ${
            count === 1 ? "that value goes" : "those values go"
          } too.`;

  return (
    <ConfirmDialog
      open={def !== null}
      title={`Delete "${def?.label ?? ""}"?`}
      message={
        <>
          <p>
            This removes the attribute from {copy.removesFrom}. {impact} This can&rsquo;t be undone.
          </p>
          {impactError && <ErrorBanner message={impactError} />}
          {error && <ErrorBanner message={error} />}
        </>
      }
      confirmLabel="Delete attribute"
      busy={deleting}
      onConfirm={handleConfirm}
      onClose={handleClose}
    />
  );
}

export default DeleteCustomFieldDialog;
