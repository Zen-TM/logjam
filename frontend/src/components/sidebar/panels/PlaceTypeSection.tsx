import { useState } from "react";
import {
  PLACE_TYPE_COLORS,
  PLACE_TYPE_ICON_KEYS,
} from "@logjam/shared";

import {
  createPlaceType,
  deletePlaceType,
  reassignPlaceType,
  updatePlaceType,
  type TPlaceType,
} from "../../../placeUtils";
import ConfirmDialog from "../../dialogs/ConfirmDialog";
import { messageFromError } from "../../../errors/messageFromError";
import { ErrorBanner } from "../../feedback/ErrorBanner";
import classes from "./AccountPanel.module.css";
import { PlaceTypeIcon } from "./placeTypeIcon";

/**
 * The account panel's place-type manager: the screens a type picker needs
 * beside it, which is why they land together.
 *
 * THREE RULES THE UI HAS TO STATE, because the server enforces them and a
 * button that fails is worse than one that is absent:
 *
 *  - A SYSTEM type (Canyon, Campsite, Marker) belongs to no account. It is
 *    listed — the picker offers it, places live in it — but it cannot be
 *    renamed or deleted, so it gets no verbs. The server answers 404 rather
 *    than 403 for either, the same way every id-addressed surface does.
 *  - A type with places IN it cannot be deleted. Deleting a category must
 *    never delete what is in it, so the row offers "Move places" first and the
 *    delete only becomes available once the type is empty.
 *  - Icon and colour come from CURATED lists, not free text: the icon because
 *    a free key resolves in one client's icon set and not the other's, the
 *    colour because it is a map marker colour and the WCAG 3:1 guarantee can
 *    only be asserted over a closed set.
 */
function PlaceTypeSection({
  types,
  loading,
  onTypesChange,
}: {
  types: TPlaceType[];
  loading: boolean;
  onTypesChange: (types: TPlaceType[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [iconKey, setIconKey] = useState<string>(PLACE_TYPE_ICON_KEYS[0]);
  const [color, setColor] = useState<string>(PLACE_TYPE_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [deleting, setDeleting] = useState<TPlaceType | null>(null);
  const [movingFrom, setMovingFrom] = useState<TPlaceType | null>(null);
  const [moveTargetId, setMoveTargetId] = useState<string>("");

  /** Re-read rather than patch a local copy: `placeCount` moves when places
   *  are reassigned, and a stale count is what decides whether Delete appears. */
  async function refresh() {
    const { getPlaceTypes } = await import("../../../placeUtils");
    onTypesChange(await getPlaceTypes());
  }

  async function run(action: () => Promise<unknown>, fallback: string) {
    setSaving(true);
    setError(null);
    try {
      await action();
      await refresh();
      return true;
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, fallback));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleAdd() {
    if (!name.trim()) return;
    const ok = await run(
      () => createPlaceType({ name: name.trim(), iconKey, color }),
      "Couldn't create that type.",
    );
    if (ok) {
      setName("");
      setAdding(false);
    }
  }

  async function handleRename(type: TPlaceType) {
    const next = renameInput.trim();
    if (!next || next === type.name) {
      setRenamingId(null);
      return;
    }
    const ok = await run(
      () => updatePlaceType(type.id, { name: next }),
      "Couldn't rename that type.",
    );
    if (ok) setRenamingId(null);
  }

  return (
    <>
      <span className={classes.sectionLabel} title="Categories of place. Each one has its own fields, icon and map colour.">
        Place types
      </span>
      <div className={classes.divider} />
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {loading ? (
        <span className={classes.fieldType}>Loading…</span>
      ) : (
        <>
          {types.map((type) =>
            renamingId === type.id ? (
              <div key={type.id} className={classes.fieldRow}>
                <input
                  className={classes.usernameInput}
                  value={renameInput}
                  onChange={(e) => setRenameInput(e.target.value)}
                  autoFocus
                  maxLength={60}
                  disabled={saving}
                />
                <div className={classes.usernameActions}>
                  <button
                    className={classes.saveUsernameBtn}
                    onClick={() => handleRename(type)}
                    disabled={saving}
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    className={classes.cancelUsernameBtn}
                    onClick={() => setRenamingId(null)}
                    disabled={saving}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div key={type.id} className={classes.fieldRow}>
                <div className={classes.fieldInfo}>
                  <span className={classes.fieldName}>
                    <PlaceTypeIcon iconKey={type.iconKey} color={type.color} />{" "}
                    {type.name}
                  </span>
                  <span className={classes.fieldType}>
                    {type.isSystem ? "Built-in · " : ""}
                    {type.placeCount} place{type.placeCount === 1 ? "" : "s"}
                  </span>
                </div>
                {/* A built-in type gets no verbs at all rather than disabled
                    ones: it belongs to no account, and a greyed button invites
                    the question "why not". */}
                {!type.isSystem && (
                  <>
                    <button
                      className={classes.renameFieldBtn}
                      onClick={() => {
                        setRenamingId(type.id);
                        setRenameInput(type.name);
                      }}
                    >
                      Rename
                    </button>
                    {type.placeCount > 0 ? (
                      <button
                        className={classes.renameFieldBtn}
                        onClick={() => {
                          setMovingFrom(type);
                          setMoveTargetId(
                            types.find((t) => t.id !== type.id)?.id ?? "",
                          );
                        }}
                      >
                        Move places
                      </button>
                    ) : (
                      <button
                        className={classes.deleteFieldBtn}
                        onClick={() => setDeleting(type)}
                      >
                        Delete
                      </button>
                    )}
                  </>
                )}
              </div>
            ),
          )}

          {adding ? (
            <div className={classes.fieldRow}>
              <input
                className={classes.usernameInput}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Type name"
                autoFocus
                maxLength={60}
                disabled={saving}
              />
              <select
                aria-label="Icon"
                value={iconKey}
                onChange={(e) => setIconKey(e.target.value)}
                disabled={saving}
              >
                {PLACE_TYPE_ICON_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
              <select
                aria-label="Colour"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                disabled={saving}
                style={{ color }}
              >
                {PLACE_TYPE_COLORS.map((value) => (
                  <option key={value} value={value} style={{ color: value }}>
                    {value}
                  </option>
                ))}
              </select>
              <div className={classes.usernameActions}>
                <button
                  className={classes.saveUsernameBtn}
                  onClick={handleAdd}
                  disabled={saving || !name.trim()}
                >
                  {saving ? "Saving…" : "Add"}
                </button>
                <button
                  className={classes.cancelUsernameBtn}
                  onClick={() => setAdding(false)}
                  disabled={saving}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button className={classes.addFieldBtn} onClick={() => setAdding(true)}>
              Add type
            </button>
          )}
        </>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete "${deleting?.name ?? ""}"?`}
        message="Any fields that belong only to this type are deleted with it. Places are not affected — this type has none."
        confirmLabel="Delete"
        confirmColor="error"
        busy={saving}
        onConfirm={async () => {
          const type = deleting;
          if (!type) return;
          const ok = await run(
            () => deletePlaceType(type.id),
            "Couldn't delete that type.",
          );
          if (ok) setDeleting(null);
        }}
        onClose={() => {
          if (!saving) setDeleting(null);
        }}
      />

      <ConfirmDialog
        open={movingFrom !== null}
        title={`Move places out of "${movingFrom?.name ?? ""}"?`}
        message={
          <>
            {movingFrom?.placeCount ?? 0} place
            {(movingFrom?.placeCount ?? 0) === 1 ? "" : "s"} will move to:{" "}
            <select
              aria-label="Move to type"
              value={moveTargetId}
              onChange={(e) => setMoveTargetId(e.target.value)}
            >
              {types
                .filter((t) => t.id !== movingFrom?.id)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
            . Values the new type has no field for are kept on each place and can
            be added to it later.
          </>
        }
        confirmLabel="Move"
        confirmColor="secondary"
        busy={saving}
        onConfirm={async () => {
          const type = movingFrom;
          if (!type || !moveTargetId) return;
          const ok = await run(
            () => reassignPlaceType(type.id, moveTargetId),
            "Couldn't move those places.",
          );
          if (ok) setMovingFrom(null);
        }}
        onClose={() => {
          if (!saving) setMovingFrom(null);
        }}
      />
    </>
  );
}

export default PlaceTypeSection;
