import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import {
  distinctTripTypes,
  MAX_PLACES_PER_TRIP,
  tripPlanTripLogMatches,
  tripPlanTripLogPlacesLine,
  tripPlanTripLogPrefill,
  TRIP_PLACES_CAP_SENTENCE,
  TRIP_PLAN_PAGE,
  type TripPlanView,
} from "@logjam/shared";

import { TripEditSheet } from "../logs/TripEditSheet";
import { useMirrorPlaces, useMirrorTrips } from "../sync/useSyncQueries";
import { makeStyles, muted, spacing } from "../theme";
import { BottomSheet, Button, Row, SelectionMark } from "../ui";

const copy = TRIP_PLAN_PAGE.copy;

/**
 * "Start a trip log from this plan": the same trip form as everywhere
 * (shared/DESIGN.md §10), opened on the plan's first day with its name, types
 * and write-up (`tripPlanTripLogPrefill`). A plan with places asks first
 * which were on the trip: only a plan place the caller already has (same name
 * and coordinates) is listed, and the trip links that one of theirs; the rest
 * are left out, never copied, as
 * frontend/src/components/plans/PlanTripLogPlacesDialog.tsx does. Nothing is
 * saved, so it works offline. Picking none goes straight to the form.
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
  onSaved: (message: string, tone: "done") => void;
}) {
  const styles = useStyles();
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

  // "saved": the places sheet is closing; the form opens once it has gone
  // (`onClosed`), as one modal can't open while another closes on Android.
  const [step, setStep] = useState<"places" | "saved" | "form">("places");
  const [picked, setPicked] = useState<string[]>([]);
  const openKey = plan?.id ?? null;
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (openKey !== openedFor) {
    setOpenedFor(openKey);
    setStep(plan && plan.places.length > 0 ? "places" : "form");
    setPicked([]);
  }
  const asking = plan !== null && step === "places";
  // The trip API takes only the caller's own places, not a shared one.
  const matches = useMemo(
    () =>
      plan
        ? tripPlanTripLogMatches(
            plan.places,
            (places.data ?? []).filter((p) => p.syncRole === "owner"),
          )
        : [],
    [plan, places.data],
  );
  // Picks still in the plan, in its order (a refetch can take one away).
  const chosen = matches.filter((m) => picked.includes(m.place.id));
  const initialPlaces = chosen.map((m) => ({ id: m.own.id, name: m.own.name }));
  const full = chosen.length >= MAX_PLACES_PER_TRIP;

  return (
    <>
      <BottomSheet
        visible={asking}
        onClose={onClose}
        onClosed={() => setStep((was) => (was === "saved" ? "form" : was))}
        title={copy.tripLogPlaces}
        footer={
          <Button label={copy.tripLogNext} onPress={() => setStep("saved")} />
        }
      >
        {plan ? (
          <View style={styles.body}>
            <Text style={styles.muted}>
              {tripPlanTripLogPlacesLine(matches.length, plan.places.length)}
            </Text>
            {matches.map(({ place }) => {
              const on = picked.includes(place.id);
              return (
                <Row
                  key={place.id}
                  icon="place"
                  title={place.name}
                  selected={on}
                  right={<SelectionMark selected={on} />}
                  disabled={!on && full}
                  subtitle={!on && full ? TRIP_PLACES_CAP_SENTENCE : undefined}
                  onPress={() =>
                    setPicked((was) =>
                      on
                        ? was.filter((id) => id !== place.id)
                        : [...was, place.id],
                    )
                  }
                />
              );
            })}
          </View>
        ) : null}
      </BottomSheet>
      <TripEditSheet
        online={online}
        visible={plan !== null && step === "form"}
        places={places.data ?? []}
        initialPlaces={initialPlaces}
        prefill={prefill}
        existingTypes={existingTypes}
        onClose={onClose}
        onSaved={(message) => onSaved(message, "done")}
      />
    </>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  body: { gap: spacing(1) },
  muted: { ...muted(theme, textRole.detail) },
}));
