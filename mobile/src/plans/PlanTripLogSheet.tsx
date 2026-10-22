import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import {
  distinctTripTypes,
  messageFromError,
  MAX_PLACES_PER_TRIP,
  tripPlanTripLogPlacesLine,
  tripPlanTripLogPrefill,
  tripPlanTripLogStopped,
  TRIP_PLACES_CAP_SENTENCE,
  TRIP_PLAN_PAGE,
  type TripPlanView,
} from "@logjam/shared";

import { unavailableReasonText } from "../auth/capabilities";
import { TripEditSheet } from "../logs/TripEditSheet";
import { useRememberedCopyMedia } from "../sharing/rememberedCopyMedia";
import { requestSync } from "../sync/syncEngine";
import { useMirrorPlaces, useMirrorTrips } from "../sync/useSyncQueries";
import { makeStyles, muted, spacing } from "../theme";
import { BottomSheet, Button, ErrorBanner, Row, SwitchRow } from "../ui";
import { savePlanItem } from "./plansApi";

const copy = TRIP_PLAN_PAGE.copy;
const OFFLINE = unavailableReasonText("needs-connection");

/**
 * "Start a trip log from this plan": the same trip form as everywhere
 * (shared/DESIGN.md §10), opened on the plan's first day with its name, types
 * and write-up (`tripPlanTripLogPrefill`). A plan with places asks first
 * which were on the trip: each picked one is saved as the caller's own copy
 * (Save a copy, online) and the trip links the copies, as Logjam Web's #573
 * does. Picking none goes straight to the form, which queues offline.
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

  // Each open starts on the places step, or the form when there are none.
  // "saved": the copies are made and the places sheet is closing; the form
  // opens once it has gone (`onClosed`), as one modal can't open while
  // another closes on Android.
  const [step, setStep] = useState<"places" | "saved" | "form">("places");
  const [picked, setPicked] = useState<string[]>([]);
  // Plan place id → its copy's id: a retry after a stop saves only the rest.
  const [copies, setCopies] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openKey = plan?.id ?? null;
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (openKey !== openedFor) {
    setOpenedFor(openKey);
    setStep(plan && plan.places.length > 0 ? "places" : "form");
    setPicked([]);
    setCopies({});
    setError(null);
  }
  const asking = plan !== null && step === "places";
  const [withMedia, toggleMedia] = useRememberedCopyMedia(asking);

  async function next(target: TripPlanView) {
    setBusy(true);
    setError(null);
    const saved = { ...copies };
    try {
      for (const id of picked) {
        if (saved[id]) continue;
        saved[id] = (await savePlanItem(target.id, "place", id, withMedia)).id;
      }
      // The copies reach the phone by the next pull: asked for now.
      void requestSync().catch(console.error);
      setCopies(saved);
      setStep("saved");
    } catch (err) {
      setCopies(saved);
      setError(
        tripPlanTripLogStopped(
          Object.keys(saved).length,
          messageFromError(err, copy.saveCopyFailed),
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  const initialPlaces = plan
    ? picked.flatMap((id) => {
        const place = plan.places.find((each) => each.id === id);
        return place && copies[id]
          ? [{ id: copies[id], name: place.name }]
          : [];
      })
    : [];
  const full = picked.length >= MAX_PLACES_PER_TRIP;

  return (
    <>
      <BottomSheet
        visible={asking}
        onClose={onClose}
        onClosed={() => setStep((was) => (was === "saved" ? "form" : was))}
        title={copy.tripLogPlaces}
        footer={
          plan ? (
            <View style={styles.footer}>
              {error ? <ErrorBanner message={error} /> : null}
              <Button
                label={copy.tripLogNext}
                loading={busy}
                // Picking none needs no connection: nothing is saved.
                disabled={!online && picked.length > 0}
                disabledReason={OFFLINE}
                onPress={() => void next(plan)}
              />
              {!online && picked.length > 0 ? (
                <Text style={styles.muted}>{OFFLINE}</Text>
              ) : null}
            </View>
          ) : undefined
        }
      >
        {plan ? (
          <View style={styles.body}>
            <Text style={styles.muted}>
              {tripPlanTripLogPlacesLine(withMedia)}
            </Text>
            {plan.places.some((place) => place.media.length > 0) ? (
              <SwitchRow
                title={copy.bringPhotos}
                checked={withMedia}
                onChange={toggleMedia}
              />
            ) : null}
            {plan.places.map((place) => {
              const on = picked.includes(place.id);
              return (
                <Row
                  key={place.id}
                  icon="place"
                  title={place.name}
                  selected={on}
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
        onSaved={onSaved}
      />
    </>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  body: { gap: spacing(1) },
  muted: { ...muted(theme, textRole.detail) },
  footer: { gap: spacing(1) },
}));
