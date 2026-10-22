import { useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import {
  ApiError,
  distinctTripTypes,
  mediaSkippedSentence,
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
import { BottomSheet, Button, ErrorBanner, Row, SelectionMark } from "../ui";
import { savePlanItem } from "./plansApi";
import { afterPlanWrite } from "./plansCache";

const copy = TRIP_PLAN_PAGE.copy;
const OFFLINE = unavailableReasonText("needs-connection");

/**
 * "Start a trip log from this plan": the same trip form as everywhere
 * (shared/DESIGN.md §10), opened on the plan's first day with its name, types
 * and write-up (`tripPlanTripLogPrefill`). A plan with places asks first
 * which were on the trip: each picked one is saved as the caller's own copy
 * (Save a copy, online), in the plan's order, with or without its photos as
 * the account's remembered `copyPlaceMedia` says, and the trip links the
 * copies, as frontend/src/components/plans/PlanTripLogPlacesDialog.tsx does.
 * Picking none goes straight to the form, which queues offline.
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
  onSaved: (message: string, tone: "info" | "error") => void;
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

  // "saved": the copies are made and the places sheet is closing; the form
  // opens once it has gone (`onClosed`), as one modal can't open while
  // another closes on Android.
  const [step, setStep] = useState<"places" | "saved" | "form">("places");
  const [picked, setPicked] = useState<string[]>([]);
  // Plan place id → its copy's id: a retry after a stop saves only the rest.
  const [copies, setCopies] = useState<Record<string, string>>({});
  // What didn't come with the copies, said once the flow ends: a toast now
  // would draw under the form that opens at once.
  // A ref: the form calls onSaved then onClose in one tick, and the note is
  // said once.
  const skipped = useRef<string | null>(null);
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
  // The remembered preference decides, as on Logjam Web: no switch here.
  const [withMedia] = useRememberedCopyMedia(asking);
  // Picks still in the plan, in its order (a refetch can take one away).
  const chosen = plan ? plan.places.filter((p) => picked.includes(p.id)) : [];
  const hasPhotos = chosen.some((place) => place.media.length > 0);

  async function next(target: TripPlanView) {
    setBusy(true);
    setError(null);
    const saved = { ...copies };
    let lost = 0;
    let outOfSpace = false;
    try {
      for (const place of chosen) {
        if (saved[place.id]) continue;
        const result = await savePlanItem(
          target.id,
          "place",
          place.id,
          withMedia,
        );
        saved[place.id] = result.id;
        lost += result.mediaSkipped ?? 0;
        outOfSpace ||= result.mediaOutOfSpace === true;
      }
      setStep("saved");
    } catch (err) {
      setError(
        tripPlanTripLogStopped(
          chosen.filter((place) => saved[place.id]).length,
          messageFromError(err, copy.saveCopyFailed),
        ),
      );
      // Gone from the plan meanwhile: fetched again, its row goes too.
      if (err instanceof ApiError) await afterPlanWrite(target.id);
    } finally {
      setCopies(saved);
      skipped.current =
        [skipped.current, mediaSkippedSentence(lost, outOfSpace)]
          .filter(Boolean)
          .join(" ") || null;
      // The copies reach the phone by the next pull: asked for now.
      if (Object.keys(saved).length > Object.keys(copies).length)
        void requestSync().catch(console.error);
      setBusy(false);
    }
  }

  // The skipped photos, said once: with the trip's own message, or alone if
  // the form closes unsaved.
  const finish = (message: string | null) => {
    const note = skipped.current;
    skipped.current = null;
    if (message)
      onSaved(
        [message, note].filter(Boolean).join(" "),
        note ? "error" : "info",
      );
    else if (note) onSaved(note, "error");
  };

  const initialPlaces = chosen.flatMap((place) =>
    copies[place.id] ? [{ id: copies[place.id], name: place.name }] : [],
  );
  const full = chosen.length >= MAX_PLACES_PER_TRIP;

  return (
    <>
      <BottomSheet
        visible={asking}
        // Not while saving: the loop would land on the next session.
        onClose={() => {
          if (busy) return;
          skipped.current = null;
          onClose();
        }}
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
                disabled={!online && chosen.length > 0}
                disabledReason={OFFLINE}
                onPress={() => void next(plan)}
              />
              {!online && chosen.length > 0 ? (
                <Text style={styles.muted}>{OFFLINE}</Text>
              ) : null}
            </View>
          ) : undefined
        }
      >
        {plan ? (
          <View style={styles.body}>
            <Text style={styles.muted}>
              {tripPlanTripLogPlacesLine(hasPhotos ? withMedia : null)}
            </Text>
            {plan.places.map((place) => {
              const on = picked.includes(place.id);
              return (
                <Row
                  key={place.id}
                  icon="place"
                  title={place.name}
                  selected={on}
                  right={<SelectionMark selected={on} />}
                  disabled={busy || (!on && full)}
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
        onClose={() => {
          finish(null);
          onClose();
        }}
        onSaved={(message) => finish(message)}
      />
    </>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  body: { gap: spacing(1) },
  muted: { ...muted(theme, textRole.detail) },
  footer: { gap: spacing(1) },
}));
