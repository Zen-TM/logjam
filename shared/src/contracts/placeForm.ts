// Adding and editing a place: Logjam Web's `PlaceDialog.tsx` and Logjam GPS's
// `places/PlaceEditSheet.tsx`. One form for both modes; only the title, the
// submit label and the done toast differ.
import { LATITUDE_RANGE, LONGITUDE_RANGE } from "../placeValidation.js";
import { SHARE_SENTENCES } from "./share.js";
import { ROUTE_NOUN } from "../tripLogFields.js";
import type { ScreenContract } from "./types.js";

export const PLACE_FORM = {
  id: "places.form",
  question: "Where is it, and what is it?",
  sections: [
    // First: it decides the fields below it, the pin's colour and the tab the
    // place lands under.
    { key: "type" },
    { key: "name" },
    { key: "alsoKnownAs" },
    // Latitude, longitude and the way to pick them on the map.
    { key: "position" },
    { key: "notes" },
    // The chosen type's own attributes; `placeAttributesTitle` (the place page's) names them.
    { key: "attributes" },
    {
      key: "sources",
      on: "web",
      gap: "Logjam GPS doesn't take sources in this form yet.",
    },
    // Both clients take photos and a route while a place is being made. Logjam
    // GPS holds the picks until the place is saved; Logjam Web uploads them
    // against a draft place.
    {
      key: "photos",
      onlyWhenAdding: {
        on: "gps",
        gap: "Logjam GPS edits an existing place's photos on its page, where the picker can run.",
      },
    },
    {
      key: "route",
      onlyWhenAdding: {
        on: "gps",
        gap: "Logjam GPS edits an existing place's route on its page, where the picker can run.",
      },
    },
  ],
  copy: {
    addTitle: "Add a place",
    editTitle: "Edit place",
    addSubmit: "Add place",
    saveSubmit: "Save changes",
    added: "Place added.",
    saved: "Place saved.",
    // Under a photo or a way picked on a new place, until Save queues it.
    stagedHint: "Added to the place when you save.",
    // The way button once one is picked on a place not yet saved.
    chooseAnotherWay: "Choose another way",
    pickFailed: "Couldn't add that photo or video. Try again.",
    addedNotAll:
      "Place added. Some photos, videos or the route couldn't be added: add them from the place.",
    saveFailed: "Couldn't save this place.",
    fixFields: "Fix the highlighted fields.",

    type: "Type",
    name: "Name",
    nameMissing: "A place needs a name.",
    alsoKnownAs: "Also known as",
    alsoKnownAsHint:
      "Separate alternative names with commas. They're searchable too.",
    position: "Position",
    latitude: "Latitude",
    longitude: "Longitude",
    latitudeMissing: "Enter a latitude.",
    longitudeMissing: "Enter a longitude.",
    latitudeInvalid: `Latitude must be a number between ${LATITUDE_RANGE.min} and ${LATITUDE_RANGE.max}`,
    longitudeInvalid: `Longitude must be a number between ${LONGITUDE_RANGE.min} and ${LONGITUDE_RANGE.max}`,
    coordinatesHint: "Decimal degrees (WGS84).",
    selectOnMap: "Select on map",
    notes: "Notes",
    notesHint: SHARE_SENTENCES.notesHint,
    sources: "Sources",
    photos: "Photos & videos",
    route: ROUTE_NOUN.one,
  },
} as const satisfies ScreenContract;
