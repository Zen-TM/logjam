// Start a trip log from this plan, its one step: which of the plan's places
// the trip links. A trip links only its owner's places, so each one picked is
// saved as the caller's copy first, in order. A failure stops before the trip
// form opens and says how many copies landed; Next again saves only the rest.
import { useId, useRef, useState } from "react";
import {
  mediaSkippedSentence,
  MAX_PLACES_PER_TRIP,
  saveTripPlanPlaces,
  TRIP_PLACES_CAP_SENTENCE,
  TRIP_PLAN_PAGE,
  tripPlanTripLogPlacesLine,
  type TripPlanPlace,
} from "@logjam/shared";
import { useToast } from "../feedback/ToastProvider";
import { Button, Checkbox, Dialog, ErrorBanner } from "../../ui";
import { messageFromError } from "../../errors/messageFromError";
import { savePlanItem } from "../../plansApi";
import classes from "./plans.module.css";

const copy = TRIP_PLAN_PAGE.copy;

export default function PlanTripLogPlacesDialog({
  planId,
  places,
  onCopied,
  onStale,
  onDone,
  onClose,
}: {
  planId: string;
  places: TripPlanPlace[];
  /** A copy landed in the caller's places. */
  onCopied: () => void;
  /** The API refused a save (the place may have left the plan): fetch the
   *  plan again, so its row goes. */
  onStale: () => void;
  /** The caller's new copies' ids, in the plan's order, and their types
   *  (the form needs them before the user's places refetch). */
  onDone: (placeIds: string[], placeTypeIds: string[]) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const formId = useId();
  const [picked, setPicked] = useState<string[]>([]);
  // The plan's place id → the caller's copy, kept across a failed Next.
  const [copies, setCopies] = useState<Record<string, string>>({});
  // The photos that didn't come, summed across a stopped run and its retry.
  const lost = useRef({ count: 0, outOfSpace: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    const chosen = places.filter((place) => picked.includes(place.id));
    const run = await saveTripPlanPlaces({
      picked: chosen,
      copies,
      // The account's stored preference decides (the line reads it too).
      save: (placeId) => savePlanItem(planId, "place", placeId),
      why: (err) => messageFromError(err, copy.saveCopyFailed),
    });
    setCopies(run.copies);
    lost.current.count += run.skipped;
    lost.current.outOfSpace ||= run.outOfSpace;
    if (run.added > 0) onCopied();
    setBusy(false);
    if (run.stopped) {
      console.error(run.stopped.error);
      setError(run.stopped.message);
      if (run.stopped.refetch) onStale();
      return;
    }
    const photos = mediaSkippedSentence(
      lost.current.count,
      lost.current.outOfSpace,
    );
    if (photos) toast.error(photos);
    onDone(
      chosen.map((place) => run.copies[place.id]),
      chosen.map((place) => place.placeTypeId),
    );
  }

  return (
    <Dialog
      open
      title={copy.tripLogPlaces}
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy} disabledReason="Saving…">
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="filled" busy={busy}>
            {copy.tripLogNext}
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
        <p className={classes.note}>
          {tripPlanTripLogPlacesLine(
            places.filter((place) => picked.includes(place.id)),
            true,
          )}
        </p>
        <div className={classes.question}>
          {places.map((place) => (
            <Checkbox
              key={place.id}
              label={place.name}
              checked={picked.includes(place.id)}
              onChange={(next) => {
                setError(null);
                // As the trip form's own place list refuses it.
                if (next && picked.length >= MAX_PLACES_PER_TRIP)
                  return setError(TRIP_PLACES_CAP_SENTENCE);
                setPicked((was) =>
                  next
                    ? [...was, place.id]
                    : was.filter((id) => id !== place.id),
                );
              }}
            />
          ))}
        </div>
        {error && <ErrorBanner message={error} />}
      </form>
    </Dialog>
  );
}
