// Add a copy: the caller's own places, and ways, ticked, priced before
// they commit, then added one request each, in order, as POST /plans/:id/items
// takes one thing. A stop halfway says what landed and why it stopped, in the
// API's words.
import { useId, useState } from "react";
import {
  tripPlanAddKey,
  tripPlanAddPicks,
  tripPlanAddCopyPriceLine,
  tripPlanAddOutcome,
  formatBytes,
  placeMatchesSearch,
  planAddVerbLabel,
  TRIP_PLAN_PAGE,
  tripPlanAddCopiesLabel,
  tripPlanAddable,
  TRIP_PLAN_ITEM_GROUP,
  TRIP_PLAN_ITEM_GROUPS,
  type TripPlanItemGroup,
  type StandaloneFile,
  type TripPlanItemKind,
} from "@logjam/shared";
import {
  Button,
  Checkbox,
  ChipRail,
  Dialog,
  ErrorBanner,
  SearchField,
} from "../../ui";
import { useToast } from "../feedback/ToastProvider";
import { messageFromError } from "../../errors/messageFromError";
import type { TPlace, TRoute, TUser } from "../../placeUtils";
import { addPlanItem } from "../../plansApi";
import classes from "./plans.module.css";

const copy = TRIP_PLAN_PAGE.copy;

type Pick = { kind: TripPlanItemKind; id: string };
type Row = Pick & { title: string; bytes: number; altNames?: string[] };
const key = tripPlanAddKey;

export default function PlanAddCopyDialog({
  planId,
  places,
  routes,
  files,
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
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const offered = tripPlanAddable(
    { places, routes, files },
    {
      me: user?.id ?? null,
      tickedPlaceIds: picked
        .filter((pick) => pick.kind === "place")
        .map((pick) => pick.id),
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
      altNames: place.altNames,
      bytes: 0,
    })),
    ways,
  };
  // What is sent: ticks still offered, in list order (`tripPlanAddPicks`).
  const all = [...lists.places, ...lists.ways];
  const chosen = tripPlanAddPicks(all, picked.map(key));
  const bytes = chosen.reduce((sum, row) => sum + row.bytes, 0);
  const placesChosen = chosen.some((row) => row.kind === "place");
  const priceLine = tripPlanAddCopyPriceLine({
    bytes,
    placesPicked: placesChosen,
    quotaBytes: user?.storageQuotaBytes ?? null,
    usedBytes: user?.storageUsedBytes ?? null,
  });

  // Only what is listed is filtered: ticks outside the search still count.
  const listed = lists[tab].filter((row) =>
    placeMatchesSearch({ name: row.title, altNames: row.altNames }, query),
  );

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
        {lists[tab].length > 0 && (
          <SearchField
            label={copy.searchByName}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        )}
        {lists[tab].length === 0 ? (
          <p className={classes.note}>{copy.nothingToAdd}</p>
        ) : listed.length === 0 ? (
          <p className={classes.note}>{copy.searchNoMatch}</p>
        ) : (
          <div className={classes.question}>
            {listed.map((row) => (
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
        {priceLine && <p className={classes.body}>{priceLine}</p>}
        {error && <ErrorBanner message={error} />}
      </form>
    </Dialog>
  );
}
