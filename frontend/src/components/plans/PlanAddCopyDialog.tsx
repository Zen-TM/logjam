// Add a copy: the caller's own places, ways and maps, ticked, priced before
// they commit, then added one request each, in order, as POST /plans/:id/items
// takes one thing. A stop halfway says what landed and why it stopped, in the
// API's words.
import { useId, useState } from "react";
import {
  tripPlanAddCopyPriceLine,
  tripPlanAddOutcome,
  formatBytes,
  planAddVerbLabel,
  TRIP_PLAN_PAGE,
  tripPlanAddCopiesLabel,
  tripPlanAddable,
  TRIP_PLAN_ITEM_GROUP,
  TRIP_PLAN_ITEM_GROUPS,
  type TripPlanItemGroup,
  untitledJobTitle,
  type GeoPdfJobView,
  type StandaloneFile,
  type TripPlanItemKind,
} from "@logjam/shared";
import {
  Button,
  Checkbox,
  ChipRail,
  Dialog,
  ErrorBanner,
  SwitchRow,
} from "../../ui";
import { useToast } from "../feedback/ToastProvider";
import { messageFromError } from "../../errors/messageFromError";
import type { TPlace, TRoute, TUser } from "../../placeUtils";
import { addPlanItem } from "../../plansApi";
import classes from "./plans.module.css";

const copy = TRIP_PLAN_PAGE.copy;

type Pick = { kind: TripPlanItemKind; id: string };
type Row = Pick & { title: string; bytes: number };
const key = (pick: Pick) => `${pick.kind}:${pick.id}`;

export default function PlanAddCopyDialog({
  planId,
  places,
  routes,
  files,
  geoPdfs,
  user,
  initial,
  onAdded,
  onClose,
}: {
  planId: string;
  /** The caller's own lists; `tripPlanAddable` decides what is offered. */
  places: TPlace[];
  routes: TRoute[];
  files: StandaloneFile[];
  geoPdfs: GeoPdfJobView[];
  user: TUser | null;
  /** Ticked on arrival: the thing pressed on the map. */
  initial: Pick | null;
  onAdded: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const formId = useId();
  const [tab, setTab] = useState<TripPlanItemGroup>(
    initial ? TRIP_PLAN_ITEM_GROUP[initial.kind] : "places",
  );
  const [picked, setPicked] = useState<Pick[]>(initial ? [initial] : []);
  const [bringPhotos, setBringPhotos] = useState(
    user?.uiPreferences?.copyPlaceMedia ?? true,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const offered = tripPlanAddable(
    { places, routes, files, geoPdfs },
    {
      me: user?.id ?? null,
      tickedPlaceIds: picked
        .filter((pick) => pick.kind === "place")
        .map((pick) => pick.id),
      copyMedia: bringPhotos,
    },
  );
  const ways = [
    ...offered.routes.map((route) => ({
      kind: "route" as const,
      id: route.id,
      title: route.name,
      bytes: 0,
    })),
    ...offered.files.map((file) => ({
      kind: "media" as const,
      id: file.id,
      title: file.displayName ?? file.filename,
      bytes: file.fileSizeBytes,
    })),
  ];
  const lists: Record<TripPlanItemGroup, Row[]> = {
    places: offered.places.map((place) => ({
      kind: "place" as const,
      id: place.id,
      title: place.name,
      bytes: 0,
    })),
    ways,
    maps: offered.geoPdfs.map((pdf) => ({
      kind: "geoPdf" as const,
      id: pdf.id,
      title: pdf.title ?? untitledJobTitle("geoPdfJob"),
      bytes: pdf.resultBytes ?? 0,
    })),
  };
  // A pick no longer offered (it now comes with a ticked place) is not sent.
  const all = [...lists.places, ...lists.ways, ...lists.maps];
  const chosen = all.filter((row) => picked.some((p) => key(p) === key(row)));
  const bytes = chosen.reduce((sum, row) => sum + row.bytes, 0);
  const placesChosen = chosen.some((row) => row.kind === "place");
  const left = user
    ? Math.max(0, user.storageQuotaBytes - user.storageUsedBytes)
    : null;
  const priceLine = tripPlanAddCopyPriceLine({
    bytes,
    photosToo: placesChosen && bringPhotos,
    leftBytes: left,
  });

  const toggle = (pick: Pick) =>
    setPicked((was) =>
      was.some((p) => key(p) === key(pick))
        ? was.filter((p) => key(p) !== key(pick))
        : [...was, pick],
    );

  async function submit() {
    if (chosen.length === 0) return setError(copy.nothingTicked);
    setBusy(true);
    let added = 0;
    let skipped = 0;
    let outOfSpace = false;
    let why: string | null = null;
    try {
      for (const row of chosen) {
        const reply = await addPlanItem(planId, {
          kind: row.kind,
          id: row.id,
          ...(row.kind === "place" && { copyMedia: bringPhotos }),
        });
        added += 1;
        skipped += reply.mediaSkipped ?? 0;
        outOfSpace ||= reply.mediaOutOfSpace === true;
      }
    } catch (err) {
      console.error(err);
      why = messageFromError(err, copy.addCopyFailed);
    }
    try {
      const outcome = tripPlanAddOutcome({
        added,
        asked: chosen.length,
        skipped,
        outOfSpace,
        why,
      });
      if (!outcome) return setError(why);
      if (outcome.tone === "error") toast.error(outcome.message);
      else toast.success(outcome.message);
      onAdded();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      size="large"
      title={planAddVerbLabel("copy")}
      onClose={onClose}
      dismissible={!busy}
      toolbar={
        <ChipRail
          label={planAddVerbLabel("copy")}
          value={tab}
          onChange={setTab}
          options={TRIP_PLAN_ITEM_GROUPS.map(({ group, title }) => ({
            value: group,
            label: title,
            count: lists[group].length || undefined,
          }))}
        />
      }
      footer={
        <>
          <Button onClick={onClose} disabled={busy} disabledReason="Adding…">
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="filled" busy={busy}>
            {tripPlanAddCopiesLabel(chosen.length)}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className={classes.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void submit();
        }}
      >
        <p className={classes.note}>{copy.addCopyLine}</p>
        {lists[tab].length === 0 ? (
          <p className={classes.note}>{copy.nothingToAdd}</p>
        ) : (
          <div className={classes.question}>
            {lists[tab].map((row) => (
              <Checkbox
                key={key(row)}
                label={row.title}
                description={row.bytes > 0 ? formatBytes(row.bytes) : undefined}
                checked={picked.some((p) => key(p) === key(row))}
                onChange={() => toggle(row)}
              />
            ))}
          </div>
        )}
        {placesChosen && (
          <SwitchRow
            title={copy.bringPhotos}
            checked={bringPhotos}
            onChange={setBringPhotos}
          />
        )}
        {priceLine && <p className={classes.body}>{priceLine}</p>}
        {error && <ErrorBanner message={error} />}
      </form>
    </Dialog>
  );
}
