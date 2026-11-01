// A plan's "On the map" view: its places and ways in the rows and hues
// their own pages use, each saying who added it. Opening a place or a route
// fits the map to it; a file's row downloads it, which is also first in its ⋯
// (`planItemVerbs`).
import { useState } from "react";
import {
  formatBytes,
  mediaSkippedSentence,
  planAddVerbLabel,
  planItemDeleteConfirm,
  planItemVerbs,
  PLAN_ITEM_VERBS,
  TRIP_PLAN_ITEM_GROUP,
  TRIP_PLAN_ITEM_GROUPS,
  TRIP_PLAN_PAGE,
  tripPlanAddedByLine,
  tripPlanSavedMessage,
  type PlanItemVerbId,
  type TripPlanItem,
  type TripPlanPlace,
  type TripPlanView,
} from "@logjam/shared";
import {
  Button,
  Checkbox,
  EmptyState,
  IconButton,
  IconTile,
  ListEnd,
  Menu,
  Row,
  SectionHeader,
  type Glyph,
} from "../../ui";
import ConfirmDialog from "../dialogs/ConfirmDialog";
import { useToast } from "../feedback/ToastProvider";
import { messageFromError } from "../../errors/messageFromError";
import { deletePlanItem, savePlanItem } from "../../plansApi";
import { downloadFile } from "../sidebar/panels/mapsModel";
import { menuEntries } from "./planMenu";
import PlanItemEditDialog from "./PlanItemEditDialog";
import PlanPlaceDialog from "./PlanPlaceDialog";
import classes from "./plans.module.css";

const copy = TRIP_PLAN_PAGE.copy;
const saveLabel = PLAN_ITEM_VERBS.find((verb) => verb.id === "save")!.label;

function look(item: TripPlanItem): { icon: Glyph; hue: string; title: string } {
  switch (item.kind) {
    case "place":
      return { icon: "place", hue: "var(--color-accent)", title: item.name };
    case "route":
      return { icon: "route", hue: "var(--hue-route)", title: item.name };
    case "media":
      return {
        icon: item.item.origin === "track" ? "track" : "importedFile",
        hue:
          item.item.origin === "track"
            ? "var(--hue-track)"
            : "var(--hue-import)",
        title: item.item.displayName ?? item.item.filename,
      };
  }
}

/** A file's stored bytes, presigned in the full fetch: the row downloads it. */
function fileUrl(item: TripPlanItem): string | null {
  if (item.kind === "media") return item.item.displayUrl;
  return null;
}

const sameItem = (a: TripPlanItem, b: TripPlanItem) =>
  a.kind === b.kind && a.id === b.id;

export default function PlanItems({
  plan,
  myUserId,
  onChanged,
  onSaved,
  onAddCopy,
  onOpen,
  copyPlaceMedia,
}: {
  plan: TripPlanView;
  myUserId: string | null;
  /** Fetch the plan again; `quiet` after a write whose failure was just said. */
  onChanged: (options?: { quiet: boolean }) => void;
  /** The caller's own lists or storage changed: a copy landed, or a thing
   *  they were charged for went. */
  onSaved: () => void;
  onAddCopy: () => void;
  /** Fit the map to it. */
  onOpen: (item: TripPlanItem) => void;
  /** The caller's remembered Bring its photos (`uiPreferences`). */
  copyPlaceMedia: boolean;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState<TripPlanItem | null>(null);
  const [bringPhotos, setBringPhotos] = useState(copyPlaceMedia);
  const [deleting, setDeleting] = useState<TripPlanItem | null>(null);
  const [viewing, setViewing] = useState<TripPlanPlace | null>(null);
  const [editing, setEditing] = useState<TripPlanItem | null>(null);
  const [busy, setBusy] = useState(false);
  const archived = plan.archivedAt != null;

  const all: TripPlanItem[] = [...plan.places, ...plan.routes, ...plan.files];
  const groups = TRIP_PLAN_ITEM_GROUPS.map(
    ({ group, title }) =>
      [
        title,
        all.filter((item) => TRIP_PLAN_ITEM_GROUP[item.kind] === group),
      ] as const,
  );
  const shown = groups.filter(([, items]) => items.length > 0);

  /** The reply, or null once a failure was said. */
  async function run<T>(
    action: () => Promise<T>,
    failure: string,
  ): Promise<{ reply: T } | null> {
    setBusy(true);
    try {
      return { reply: await action() };
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, failure));
      return null;
    } finally {
      setBusy(false);
    }
  }

  const runners = (item: TripPlanItem): Record<PlanItemVerbId, () => void> => ({
    download: () => downloadFile(fileUrl(item)!),
    save: () => {
      setBringPhotos(copyPlaceMedia);
      setSaving(item);
    },
    edit: () => setEditing(item),
    delete: () => setDeleting(item),
  });

  const addCopy = !archived && (
    <Button variant="filled" icon="copy" onClick={onAddCopy}>
      {planAddVerbLabel("copy")}
    </Button>
  );

  const photoBytes =
    saving?.kind === "place"
      ? saving.media.reduce((sum, photo) => sum + Number(photo.sizeBytes), 0)
      : 0;
  const deleteCopy = deleting
    ? planItemDeleteConfirm(
        look(deleting).title,
        deleting.kind === "place" ? deleting.media.length : 0,
      )
    : null;
  return (
    <div className={classes.list}>
      {/* The dialogs stay mounted when a refetch empties the plan. */}
      {shown.length === 0 && (
        <EmptyState icon="place" title={copy.itemsEmpty} actions={addCopy} />
      )}
      {shown.map(([heading, items]) => (
        <div key={heading} className={classes.block}>
          {/* A heading needs a second group to divide from (shared/DESIGN.md §2). */}
          {shown.length > 1 && (
            <SectionHeader title={heading} count={items.length} />
          )}
          {items.map((item) => {
            const { icon, hue, title } = look(item);
            const url = fileUrl(item);
            const verbs = planItemVerbs(
              plan.myRole,
              { kind: item.kind, mine: item.addedBy?.id === myUserId },
              { archived },
            );
            const run = runners(item);
            return (
              <Row
                key={`${item.kind}:${item.id}`}
                title={title}
                subtitle={[
                  tripPlanAddedByLine(item.addedBy),
                  url && copy.itemDownloadHint,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                leading={<IconTile icon={icon} hue={hue} />}
                // A presigned link is another origin, so the row's own
                // `download` would be ignored: it goes through downloadFile.
                onOpen={() => {
                  if (url) return downloadFile(url);
                  onOpen(item);
                  if (item.kind === "place") setViewing(item);
                }}
                trailing={
                  <Menu
                    label={`Actions for ${title}`}
                    title={title}
                    placement="right-start"
                    entries={menuEntries(verbs, (id) => run[id]())}
                    trigger={(props) => (
                      <IconButton
                        {...props}
                        icon="overflow"
                        label={`Actions for ${title}`}
                      />
                    )}
                  />
                }
              />
            );
          })}
        </div>
      ))}
      {addCopy && shown.length > 0 && <ListEnd>{addCopy}</ListEnd>}

      <ConfirmDialog
        open={saving != null}
        title={saveLabel}
        message={
          <>
            <p>{copy.saveCopyLine}</p>
            {photoBytes > 0 && (
              <Checkbox
                label={copy.bringPhotos}
                description={formatBytes(photoBytes)}
                checked={bringPhotos}
                onChange={setBringPhotos}
              />
            )}
          </>
        }
        confirmLabel={saveLabel}
        confirmColor="primary"
        busy={busy}
        onClose={() => setSaving(null)}
        onConfirm={() => {
          if (!saving) return;
          const item = saving;
          void run(
            () =>
              savePlanItem(
                plan.id,
                item.kind,
                item.id,
                item.kind === "place" ? bringPhotos : undefined,
              ),
            copy.saveCopyFailed,
          ).then((done) => {
            setSaving(null);
            // Gone or no longer theirs: the plan as it now is says why.
            if (!done) return onChanged({ quiet: true });
            const { mediaSkipped = 0, mediaOutOfSpace } = done.reply;
            const skipped = mediaSkippedSentence(
              mediaSkipped,
              mediaOutOfSpace === true,
            );
            const saved = tripPlanSavedMessage(item.kind);
            if (skipped) toast.error(`${saved} ${skipped}`);
            else toast.success(saved);
            onSaved();
          });
        }}
      />
      <ConfirmDialog
        open={deleteCopy != null}
        title={deleteCopy?.confirmTitle}
        message={deleteCopy?.confirmBody}
        confirmLabel={deleteCopy?.confirmLabel}
        busy={busy}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          const item = deleting;
          void run(
            () => deletePlanItem(plan.id, item.kind, item.id),
            copy.itemDeleteFailed,
          ).then((done) => {
            setDeleting(null);
            if (done) {
              toast.success(copy.itemDeleted);
              onSaved();
            }
            onChanged(done ? undefined : { quiet: true });
          });
        }}
      />
      {viewing && (
        <PlanPlaceDialog
          // Follows the refetched plan, so edits show at once.
          place={plan.places.find((each) => each.id === viewing.id) ?? viewing}
          onClose={() => setViewing(null)}
        />
      )}
      {editing && (
        <PlanItemEditDialog
          planId={plan.id}
          opened={editing}
          // Follows the refetched plan, so a 409's re-read reaches the form.
          item={all.find((each) => sameItem(each, editing))}
          onStale={() => onChanged({ quiet: true })}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}
