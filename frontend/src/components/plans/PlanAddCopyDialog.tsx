// Add a copy: the caller's own places, ways and maps, ticked, priced before
// they commit, then added one request each, in order, as POST /plans/:id/items
// takes one thing. A stop halfway says what landed and why it stopped, in the
// API's words.
import { useId, useState } from "react";
import {
  formatBytes,
  planAddVerbLabel,
  TRIP_PLAN_PAGE,
  tripPlanAddCopiesLabel,
  tripPlanAddCopyPrice,
  tripPlanAddedMessage,
  mediaSkippedSentence,
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
  /** The caller's own, as their pages list them: nothing shared with them. */
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
  const [tab, setTab] = useState<"places" | "ways" | "maps">(
    initial?.kind === "place" || !initial
      ? "places"
      : initial.kind === "geoPdf"
        ? "maps"
        : "ways",
  );
  const [picked, setPicked] = useState<Pick[]>(initial ? [initial] : []);
  const [bringPhotos, setBringPhotos] = useState(
    user?.uiPreferences?.copyPlaceMedia ?? true,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ways = [
    ...routes.map((route) => ({
      kind: "route" as const,
      id: route.id,
      title: route.name,
      bytes: 0,
    })),
    // A file that is a place's way travels with that place.
    ...files
      .filter((file) => file.linkedPlaceId == null)
      .map((file) => ({
        kind: "media" as const,
        id: file.id,
        title: file.displayName ?? file.filename,
        bytes: file.fileSizeBytes,
      })),
  ];
  const lists = {
    places: places.map((place) => ({
      kind: "place" as const,
      id: place.id,
      title: place.name,
      bytes: 0,
    })),
    ways,
    maps: geoPdfs.map((pdf) => ({
      kind: "geoPdf" as const,
      id: pdf.id,
      title: pdf.title ?? untitledJobTitle("geoPdfJob"),
      bytes: pdf.resultBytes ?? 0,
    })),
  };
  const all = [...lists.places, ...lists.ways, ...lists.maps];
  const chosen = all.filter((row) => picked.some((p) => key(p) === key(row)));
  const bytes = chosen.reduce((sum, row) => sum + row.bytes, 0);
  const placesChosen = chosen.some((row) => row.kind === "place");
  const left = user
    ? Math.max(0, user.storageQuotaBytes - user.storageUsedBytes)
    : null;

  const toggle = (pick: Pick) =>
    setPicked((was) =>
      was.some((p) => key(p) === key(pick))
        ? was.filter((p) => key(p) !== key(pick))
        : [...was, pick],
    );

  async function submit() {
    if (chosen.length === 0) return setError(copy.nothingToAdd);
    setBusy(true);
    let added = 0;
    let skipped = 0;
    let outOfSpace = false;
    const photos = () => mediaSkippedSentence(skipped, outOfSpace);
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
      const done = tripPlanAddedMessage(added, chosen.length);
      if (photos()) toast.error(`${done} ${photos()}`);
      else toast.success(done);
      onAdded();
      onClose();
    } catch (err) {
      console.error(err);
      const why = messageFromError(err, copy.addCopyFailed);
      if (added > 0) {
        const done = tripPlanAddedMessage(added, chosen.length);
        toast.error([done, photos(), why].filter(Boolean).join(" "));
        onAdded();
        onClose();
      } else setError(why);
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
          options={[
            {
              value: "places",
              label: copy.itemsPlaces,
              count: lists.places.length,
            },
            { value: "ways", label: copy.itemsWays, count: lists.ways.length },
            { value: "maps", label: copy.itemsMaps, count: lists.maps.length },
          ]}
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
        {(bytes > 0 || (placesChosen && bringPhotos)) && left != null && (
          <p className={classes.body}>
            {tripPlanAddCopyPrice(formatBytes(bytes), formatBytes(left))}
            {placesChosen && bringPhotos ? ` ${copy.photosCountToo}` : ""}
          </p>
        )}
        {error && <ErrorBanner message={error} />}
      </form>
    </Dialog>
  );
}
