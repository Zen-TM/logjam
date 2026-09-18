import { useState } from "react";
import { ArrowRightLeft, EllipsisVertical, Plus, Trash2 } from "lucide-react";
import {
  PLACE_TYPE_COLORS,
  PLACE_TYPE_ICON_KEYS,
  placeTypeColorName,
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
import {
  Button,
  Hero,
  IconButton,
  IconTile,
  Menu,
  Row,
  SectionHeader,
  Select,
  SwatchPicker,
  TextField,
} from "../../../ui";
import classes from "./ListPage.module.css";
import { placeTypeLucideIcon } from "./placeTypeIcon";

/**
 * The place types a user keeps — Settings' first list page.
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
 *    only be asserted over a closed set. A free picker would not fail that
 *    check, it would DELETE it — which is why `ColourField` is not used here.
 *
 * BUILT-INS LAST, like the phone's editor and like the attribute list beside
 * it: the user's own types are the half with verbs on them. This is the
 * EDITOR's order only — `GET /place-types` still puts the system types first,
 * because there the leftmost rail chip and the default type for a new place are
 * decided by that order.
 */
function PlaceTypeSection({
  types,
  loading,
  onTypesChange,
  onBack,
}: {
  types: TPlaceType[];
  loading: boolean;
  onTypesChange: (types: TPlaceType[]) => void;
  onBack: () => void;
}) {
  const [editing, setEditing] = useState<TPlaceType | "new" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  if (editing) {
    return (
      <PlaceTypeForm
        editing={editing === "new" ? null : editing}
        saving={saving}
        error={error}
        onDismissError={() => setError(null)}
        onBack={() => {
          setEditing(null);
          setError(null);
        }}
        onSave={async (draft) => {
          const ok =
            editing === "new"
              ? await run(() => createPlaceType(draft), "Couldn't create that type.")
              : await run(
                  () => updatePlaceType(editing.id, draft),
                  "Couldn't save that type.",
                );
          if (ok) setEditing(null);
        }}
      />
    );
  }

  const own = types.filter((type) => !type.isSystem);
  const system = types.filter((type) => type.isSystem);

  return (
    <div className={classes.root}>
      <Hero
        title="Place types"
        onBack={onBack}
        backLabel="Back to Settings"
        actions={
          <Button compact variant="outline" icon={Plus} onClick={() => setEditing("new")}>
            Add
          </Button>
        }
      />

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div className={classes.list}>
        {loading ? (
          <p className={classes.state}>Loading…</p>
        ) : (
          <>
            {own.length > 0 && <SectionHeader title="Yours" count={own.length} />}
            {own.map((type) => (
              <Row
                key={type.id}
                leading={<IconTile icon={placeTypeLucideIcon(type.iconKey)} hue={type.color} />}
                title={type.name}
                subtitle={placeCountLabel(type.placeCount)}
                onOpen={() => setEditing(type)}
                trailing={
                  /* The destructive verb lives in the ⋯, like every other
                     row in the app: warning as TEXT on a card measures 3.8:1
                     (Basalt) — the menu's surface is where it clears 4.5
                     (`scripts/wcag-contrast.mjs`). */
                  <Menu
                    label={`Actions for ${type.name}`}
                    title={type.name}
                    placement="bottom-end"
                    entries={
                      type.placeCount > 0
                        ? [
                            {
                              id: "move",
                              label: "Move places",
                              icon: ArrowRightLeft,
                              onSelect: () => {
                                setMovingFrom(type);
                                setMoveTargetId(
                                  types.find((other) => other.id !== type.id)?.id ?? "",
                                );
                              },
                            },
                          ]
                        : [
                            {
                              id: "delete",
                              label: "Delete type",
                              icon: Trash2,
                              danger: true,
                              onSelect: () => setDeleting(type),
                            },
                          ]
                    }
                    trigger={(props) => (
                      <IconButton
                        {...props}
                        icon={EllipsisVertical}
                        label={`Actions for ${type.name}`}
                      />
                    )}
                  />
                }
              />
            ))}

            {/* A built-in gets no verbs at all rather than disabled ones: it
                belongs to no account, and a greyed button invites the question
                "why not". */}
            <SectionHeader title="Built in" count={system.length} />
            {system.map((type) => (
              <Row
                key={type.id}
                leading={<IconTile icon={placeTypeLucideIcon(type.iconKey)} hue={type.color} />}
                title={type.name}
                subtitle={placeCountLabel(type.placeCount)}
              />
            ))}
          </>
        )}
      </div>

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete "${deleting?.name ?? ""}"?`}
        message="Any attributes that belong only to this type are deleted with it. Places are not affected — this type has none."
        confirmLabel="Delete"
        confirmColor="error"
        busy={saving}
        onConfirm={async () => {
          const type = deleting;
          if (!type) return;
          const ok = await run(() => deletePlaceType(type.id), "Couldn't delete that type.");
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
            <Select
              label={`${placeCountLabel(movingFrom?.placeCount ?? 0)} will move to`}
              value={moveTargetId}
              onChange={(event) => setMoveTargetId(event.target.value)}
            >
              {types
                .filter((type) => type.id !== movingFrom?.id)
                .map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
            </Select>
            <p className={classes.note}>
              Values the new type has no attribute for are kept on each place, and can be
              added to it later.
            </p>
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
    </div>
  );
}

/** Add or change one type. A page of its own, like the phone's form: the icon
 *  grid is tall enough that a row-sized inline editor could not hold it. */
function PlaceTypeForm({
  editing,
  saving,
  error,
  onDismissError,
  onBack,
  onSave,
}: {
  /** null = adding. */
  editing: TPlaceType | null;
  saving: boolean;
  error: string | null;
  onDismissError: () => void;
  onBack: () => void;
  onSave: (draft: { name: string; iconKey: string; color: string }) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [iconKey, setIconKey] = useState(editing?.iconKey ?? PLACE_TYPE_ICON_KEYS[0]);
  const [color, setColor] = useState(editing?.color ?? PLACE_TYPE_COLORS[0]);

  return (
    <div className={classes.root}>
      <Hero
        title={editing ? editing.name : "New place type"}
        onBack={onBack}
        backLabel="Back to place types"
        actions={
          <Button
            compact
            variant="filled"
            busy={saving}
            disabled={!name.trim()}
            onClick={() => onSave({ name: name.trim(), iconKey, color })}
          >
            Save
          </Button>
        }
      />

      {error && <ErrorBanner message={error} onDismiss={onDismissError} />}

      <div className={classes.list}>
        <TextField
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          disabled={saving}
          data-autofocus
        />

        <SectionHeader title="Icon" />
        <div className={classes.iconGrid} role="radiogroup" aria-label="Icon">
          {PLACE_TYPE_ICON_KEYS.map((key) => {
            const Icon = placeTypeLucideIcon(key);
            const selected = key === iconKey;
            return (
              <label
                key={key}
                className={classes.iconCell}
                data-selected={selected || undefined}
                title={key}
              >
                <input
                  type="radio"
                  name="place-type-icon"
                  className="visually-hidden"
                  value={key}
                  checked={selected}
                  disabled={saving}
                  onChange={() => setIconKey(key)}
                />
                <Icon size={18} aria-hidden />
                <span className="visually-hidden">{key}</span>
              </label>
            );
          })}
        </div>

        <SwatchPicker
          label="Colour"
          colors={PLACE_TYPE_COLORS}
          value={color}
          onChange={setColor}
          nameOf={placeTypeColorName}
          disabled={saving}
        />

        <p className={classes.note}>
          On the map this colour is the pin's fill. A ring around a pin means the place was
          shared with you by a friend.
        </p>
      </div>
    </div>
  );
}

function placeCountLabel(count: number): string {
  return `${count} place${count === 1 ? "" : "s"}`;
}

export default PlaceTypeSection;
