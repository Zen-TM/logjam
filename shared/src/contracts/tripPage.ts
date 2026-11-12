// A trip's page: Logjam Web's `TripDetailPanel.tsx` and Logjam GPS's
// `logs/TripDetailScreen.tsx`. Its verbs are `TRIP_VERBS` (surface "page"),
// all behind the ⋯: the page has no verb it puts first.
import { TRIP_FORM } from "./tripForm.js";
import type { ScreenContract } from "./types.js";

export const TRIP_PAGE = {
  id: "logs.tripPage",
  question: "What did I do that day?",
  sections: [
    // The date, the title and the trip's types.
    { key: "hero" },
    { key: "places" },
    // The linked places' river gauges, as they read on this trip's date and
    // now. Absent when no linked place has a gauge or no date has a value.
    { key: "gauge" },
    // After the places, the order of a place's page: what was recorded, the
    // notes, then the files.
    { key: "attributes" },
    { key: "notes" },
    { key: "photos" },
    { key: "routes" },
  ],
  copy: {
    places: "Places",
    gauge: "River gauge",
    photos: TRIP_FORM.copy.photos,
    routes: TRIP_FORM.copy.routes,
    notes: TRIP_FORM.copy.notes,
    attributes: TRIP_FORM.copy.attributes,

    noType: "No type",
    // An empty slot gets a short label, not a lesson (UX §11).
    placesEmpty: "No places linked.",
    photosEmpty: "No photos yet.",
    routesEmpty: "No routes yet.",
    notesEmpty: "No notes yet.",
  },
} as const satisfies ScreenContract;
