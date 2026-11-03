// Logging and editing a trip: Logjam Web's `TripLogDialog.tsx` and Logjam GPS's
// `logs/TripEditSheet.tsx`. One form for both modes.
import { ATTRIBUTE_NOUN, ROUTE_NOUN } from "../tripLogFields.js";
import type { ScreenContract } from "./types.js";

export const TRIP_FORM = {
  id: "logs.tripForm",
  question: "What did I do that day?",
  sections: [
    { key: "date" },
    // The places picker, and a track being logged as a trip.
    { key: "places" },
    { key: "title" },
    { key: "type" },
    { key: "notes" },
    { key: "attributes" },
    // Values kept from when the trip was another type; only keep or remove.
    { key: "leftover" },
    {
      key: "photos",
      on: "web",
      gap: "Logjam GPS doesn't take photos in this form yet.",
    },
    {
      key: "routes",
      on: "web",
      gap: "Logjam GPS doesn't take routes in this form yet.",
    },
  ],
  copy: {
    addTitle: "Log a trip",
    editTitle: "Edit trip",
    addSubmit: "Log trip",
    saveSubmit: "Save changes",
    logged: "Trip logged.",
    saved: "Trip saved.",
    saveFailed: "Couldn't save this trip.",
    fixFields: "Fix the highlighted fields.",

    date: "Date",
    dateMissing: "A trip needs a date.",
    futureDate: "This date is in the future.",
    places: "Places",
    noPlaces: "No places linked",
    title: "Title",
    type: "Type",
    typeStarHint: "The starred type sets the trip's icon.",
    typeCanyoningHint:
      "Trips with a linked canyon are always tagged canyoning.",
    notes: "Notes",
    notesPlaceholder: "Conditions, observations…",
    attributes: `Trip ${ATTRIBUTE_NOUN.many}`,
    leftover: `Leftover ${ATTRIBUTE_NOUN.many}`,
    leftoverNote: `These ${ATTRIBUTE_NOUN.many} are left over from when this trip was saved as a different type.`,
    photos: "Photos & videos",
    routes: ROUTE_NOUN.many,
  },
} as const satisfies ScreenContract;

/** What an empty title falls back to: the places' names, else this. */
export function tripTitleHint(derivedTitle: string | null): string {
  return `Defaults to ${derivedTitle ?? "“Untitled trip”"}`;
}
