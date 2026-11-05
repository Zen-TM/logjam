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
    // Both clients take photos and a way while a trip is being logged. Logjam
    // GPS holds the picks until the trip is saved; Logjam Web uploads them
    // against a draft trip.
    {
      key: "photos",
      onlyWhenAdding: {
        on: "gps",
        gap: "Logjam GPS edits an existing trip's photos on its page, where the picker can run.",
      },
    },
    // A trip keeps a way as a copy of its file, so every ADD_WAY source but the
    // pen ends up as a track on the trip.
    {
      key: "routes",
      onlyWhenAdding: {
        on: "gps",
        gap: "Logjam GPS edits an existing trip's routes on its page, where the picker can run.",
      },
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
    // Under a photo or a way picked on a trip not yet saved, until Save queues it.
    stagedHint: "Added to the trip when you save.",
    // The way button once one is picked on a trip not yet saved.
    chooseAnotherWay: "Choose another way",
    // What every source says before it is picked: a trip gets a copy, never the
    // original, so the original is not touched.
    wayCopiedHint:
      "The trip gets a copy of the file. The original stays where it is.",
    pickFailed: "Couldn't add that photo or video. Try again.",
    loggedNotAll:
      "Trip logged. Some photos, videos or the route couldn't be added: add them from the trip.",
  },
} as const satisfies ScreenContract;

/** What an empty title falls back to: the places' names, else this. */
export function tripTitleHint(derivedTitle: string | null): string {
  return `Defaults to ${derivedTitle ?? "“Untitled trip”"}`;
}
