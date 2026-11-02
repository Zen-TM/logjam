// Add a place or way: the caller's own places, and ways, ticked, priced before
// they commit, then added one request each, in order, as POST /plans/:id/items
// takes one thing. A stop halfway says what landed and why it stopped, in the
// API's words.
import { useEffect, useId, useRef, useState } from "react";
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
  tripPlanInPlanIds,
  TRIP_PLAN_ITEM_GROUP,
  TRIP_PLAN_ITEM_GROUPS,
  type TripPlanItemGroup,
  type StandaloneFile,
  type TripPlanItemKind,
  type TripPlanView,
} from "@logjam/shared";
import {
  Button,
  ChipRail,
  Dialog,
  ErrorBanner,
  IconTile,
  Row,
  SearchField,
  TileCheckbox,
} from "../../ui";
import { useToast } from "../feedback/ToastProvider";
import { messageFromError } from "../../errors/messageFromError";
import type { TPlace, TRoute, TUser } from "../../placeUtils";
import { addPlanItem } from "../../plansApi";
import classes from "./plans.module.css";

const copy = TRIP_PLAN_PAGE.copy;

type Ticked = { kind: TripPlanItemKind; id: string };
type PickRow = Ticked & {
  title: string;
  bytes: number;
  altNames?: string[];
  inPlan: boolean;
};
const key = tripPlanAddKey;

export default function PlanAddCopyDialog({
  planId,
  plan,
  places,
  routes,
  files,
  user,
  initial,
  onAdded,
  onClose,
}: {
  planId: string;
  /** What the plan holds now: a thing already in it is marked, not offered. */
  plan: Pick<TripPlanView, "places" | "routes" | "files">;
  /** The caller's own lists; `tripPlanAddable` decides what is offered. */
  places: TPlace[];
  routes: TRoute[];
  files: StandaloneFile[];
  user: TUser | null;
  /** Ticked on arrival: the thing pressed on the map. */
  initial: Ticked | null;
  onAdded: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [tab, setTab] = useState<TripPlanItemGroup>(
    initial ? TRIP_PLAN_ITEM_GROUP[initial.kind] : "places",
  );
  const [picked, setPicked] = useState<Ticked[]>(initial ? [initial] : []);
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
  const inPlan = tripPlanInPlanIds(plan, { places, routes, files });
  const ways = [
    ...offered.routes.map((route) => ({
      kind: "route" as const,
      id: route.id,
      title: route.name,
      bytes: 0,
      inPlan: inPlan.has(route.id),
    })),
    ...offered.files.map((file) => ({
      kind: "media" as const,
      id: file.id,
      title: file.displayName ?? file.filename,
      bytes: file.fileSizeBytes,
      inPlan: inPlan.has(file.id),
    })),
  ];
  const lists: Record<TripPlanItemGroup, PickRow[]> = {
    places: offered.places.map((place) => ({
      kind: "place" as const,
      id: place.id,
      title: place.name,
      altNames: place.altNames,
      bytes: 0,
      inPlan: inPlan.has(place.id),
    })),
    ways,
  };
  // What is sent: ticks still offered and not already in the plan, in list
  // order (`tripPlanAddPicks`).
  const all = [...lists.places, ...lists.ways].filter((row) => !row.inPlan);
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

  const toggle = (pick: Ticked) =>
    setPicked((was) =>
      was.some((p) => key(p) === key(pick))
        ? was.filter((p) => key(p) !== key(pick))
        : [...was, pick],
    );

  // The pressed place sits in a list of every place the user has: bring its
  // row into view on arrival. After the dialog is shown (this effect is the
  // parent's, so it runs after the dialog's own layout effect).
  useEffect(() => {
    if (!initial) return;
    formRef.current
      ?.querySelector(`[data-pick="${CSS.escape(key(initial))}"]`)
      ?.scrollIntoView({ block: "center" });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- on arrival only

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
        ref={formRef}
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
          <div className={classes.block}>
            {listed.map((row) => {
              const ticked = picked.some((p) => key(p) === key(row));
              const tile = (
                <IconTile
                  icon={
                    row.kind === "place"
                      ? "place"
                      : row.kind === "route"
                        ? "route"
                        : "importedFile"
                  }
                  hue={
                    row.kind === "place"
                      ? "var(--color-accent)"
                      : row.kind === "route"
                        ? "var(--hue-route)"
                        : "var(--hue-import)"
                  }
                />
              );
              return (
                <Row
                  key={key(row)}
                  data-pick={key(row)}
                  title={row.title}
                  subtitle={
                    row.inPlan
                      ? copy.inPlan
                      : row.bytes > 0
                        ? formatBytes(row.bytes)
                        : undefined
                  }
                  selected={ticked && !row.inPlan}
                  disabled={row.inPlan}
                  leading={
                    row.inPlan ? (
                      tile
                    ) : (
                      <TileCheckbox
                        tile={tile}
                        label={row.title}
                        checked={ticked}
                        selecting
                        onToggle={() => toggle(row)}
                      />
                    )
                  }
                  onOpen={row.inPlan ? undefined : () => toggle(row)}
                />
              );
            })}
          </div>
        )}
        {/* Always there, so ticking never moves the list. */}
        <p className={classes.body} aria-live="polite">
          {priceLine ?? "\u00a0"}
        </p>
        {error && <ErrorBanner message={error} />}
      </form>
    </Dialog>
  );
}
