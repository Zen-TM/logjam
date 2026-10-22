import { useMemo } from "react";
import {
  distinctTripTypes,
  tripPlanTripLogPrefill,
  type TripPlanView,
} from "@logjam/shared";

import { TripEditSheet } from "../logs/TripEditSheet";
import { useMirrorPlaces, useMirrorTrips } from "../sync/useSyncQueries";

/**
 * "Start a trip log from this plan": the same trip form as everywhere
 * (shared/DESIGN.md §10), opened on the plan's first day with its name, types
 * and write-up (`tripPlanTripLogPrefill`). A trip log is the caller's own and
 * queues offline like any trip. The plan's places are not linked: each would
 * first be saved as the caller's copy, which is Save a copy's flow.
 */
export function PlanTripLogSheet({
  plan,
  online,
  onClose,
  onSaved,
}: {
  /** Null while closed. */
  plan: TripPlanView | null;
  online: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const places = useMirrorPlaces();
  const trips = useMirrorTrips();
  const existingTypes = useMemo(
    () => distinctTripTypes(trips.data ?? []),
    [trips.data],
  );
  const prefill = useMemo(
    () => (plan ? tripPlanTripLogPrefill(plan) : null),
    [plan],
  );
  return (
    <TripEditSheet
      online={online}
      visible={plan !== null}
      places={places.data ?? []}
      prefill={prefill}
      existingTypes={existingTypes}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}
