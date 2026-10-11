// A trip's page: Logjam Web's `TripDetailPanel.tsx` and Logjam GPS's
// `logs/TripDetailScreen.tsx`. Its verbs are `TRIP_VERBS` (surface "page"),
// all behind the ⋯: the page has no verb it puts first.
import { ATTRIBUTE_NOUN } from "../tripLogFields.js";
import type { ScreenContract } from "./types.js";

export const TRIP_PAGE = {
  id: "logs.tripPage",
  question: "What did I do that day?",
  sections: [
    // The date, the title and the trip's types.
    { key: "hero" },
    { key: "places" },
    { key: "photos" },
    { key: "routes" },
    { key: "notes" },
    { key: "attributes" },
  ],
  copy: {
    places: "Places",
    photos: "Photos & videos",
    routes: "Routes",
    notes: "Notes",
    attributes: `Trip ${ATTRIBUTE_NOUN.many}`,

    noType: "No type set",
    // An empty slot gets a short label, not a lesson (UX §11).
    placesEmpty: "No places linked.",
    photosEmpty: "No photos yet.",
    routesEmpty: "No routes yet.",
    notesEmpty: "No notes yet.",
  },
} as const satisfies ScreenContract;
