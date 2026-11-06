// Start a trip log from this plan, its one step: which of the plan's places
// the trip links. A trip links only its owner's places, so only a plan place
// the caller already has (same name and coordinates) is listed, and linked as
// the caller's own; the others are left out, never copied.
import { useId, useMemo, useState } from "react";
import {
  MAX_PLACES_PER_TRIP,
  TRIP_PLACES_CAP_SENTENCE,
  TRIP_PLAN_PAGE,
  tripPlanTripLogMatches,
  tripPlanTripLogPlacesLine,
  type TripPlanPlace,
} from "@logjam/shared";
import { Button, Checkbox, Dialog } from "../../ui";
import type { TPlace } from "../../placeUtils";
import classes from "./plans.module.css";

const copy = TRIP_PLAN_PAGE.copy;

export default function PlanTripLogPlacesDialog({
  places,
  own,
  onDone,
  onClose,
}: {
  places: TripPlanPlace[];
  /** The caller's own places, which the trip may link. */
  own: TPlace[];
  /** The caller's own places' ids, in the plan's order, and their types. */
  onDone: (placeIds: string[], placeTypeIds: string[]) => void;
  onClose: () => void;
}) {
  const formId = useId();
  const [picked, setPicked] = useState<string[]>([]);
  const matches = useMemo(
    () => tripPlanTripLogMatches(places, own),
    [places, own],
  );

  function submit() {
    const chosen = matches.filter((m) => picked.includes(m.place.id));
    onDone(
      chosen.map((m) => m.own.id),
      chosen.map((m) => m.own.placeTypeId),
    );
  }

  return (
    <Dialog
      open
      title={copy.tripLogPlaces}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="filled">
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
          submit();
        }}
      >
        <p className={classes.note}>
          {tripPlanTripLogPlacesLine(matches.length, places.length)}
        </p>
        <div className={classes.question}>
          {matches.map(({ place }) => (
            <Checkbox
              key={place.id}
              label={place.name}
              checked={picked.includes(place.id)}
              // At the cap the rest dim, and the line says why.
              disabled={
                !picked.includes(place.id) &&
                picked.length >= MAX_PLACES_PER_TRIP
              }
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
        {picked.length >= MAX_PLACES_PER_TRIP && (
          <p className={classes.note}>{TRIP_PLACES_CAP_SENTENCE}</p>
        )}
      </form>
    </Dialog>
  );
}
