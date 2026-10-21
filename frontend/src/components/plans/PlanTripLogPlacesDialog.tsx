// Start a trip log from this plan, its one step: which of the plan's places
// the trip links. A trip links only its owner's places, so each one picked is
// saved as the caller's copy first, in order. A failure stops before the trip
// form opens and says how many copies landed; Next again saves only the rest.
import { useId, useState } from "react";
import {
  TRIP_PLAN_PAGE,
  tripPlanTripLogStopped,
  type TripPlanPlace,
} from "@logjam/shared";
import { Button, Checkbox, Dialog, ErrorBanner } from "../../ui";
import { messageFromError } from "../../errors/messageFromError";
import { savePlanItem } from "../../plansApi";
import classes from "./plans.module.css";

const copy = TRIP_PLAN_PAGE.copy;

export default function PlanTripLogPlacesDialog({
  planId,
  places,
  onCopied,
  onDone,
  onClose,
}: {
  planId: string;
  places: TripPlanPlace[];
  /** A copy landed in the caller's places. */
  onCopied: () => void;
  /** The caller's new copies' ids, in the plan's order. */
  onDone: (placeIds: string[]) => void;
  onClose: () => void;
}) {
  const formId = useId();
  const [picked, setPicked] = useState<string[]>([]);
  // The plan's place id → the caller's copy, kept across a failed Next.
  const [copies, setCopies] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    const saved = { ...copies };
    const chosen = places.filter((place) => picked.includes(place.id));
    const before = Object.keys(saved).length;
    try {
      for (const place of chosen)
        saved[place.id] ??= (await savePlanItem(planId, "place", place.id)).id;
      onDone(chosen.map((place) => saved[place.id]));
    } catch (err) {
      console.error(err);
      setError(
        tripPlanTripLogStopped(
          chosen.filter((place) => saved[place.id]).length,
          messageFromError(err, copy.saveCopyFailed),
        ),
      );
    } finally {
      setCopies(saved);
      if (Object.keys(saved).length > before) onCopied();
      setBusy(false);
    }
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
        <p className={classes.note}>{copy.tripLogPlacesLine}</p>
        <div className={classes.question}>
          {places.map((place) => (
            <Checkbox
              key={place.id}
              label={place.name}
              checked={picked.includes(place.id)}
              onChange={(next) =>
                setPicked((was) =>
                  next
                    ? [...was, place.id]
                    : was.filter((id) => id !== place.id),
                )
              }
            />
          ))}
        </div>
        {error && <ErrorBanner message={error} />}
      </form>
    </Dialog>
  );
}
