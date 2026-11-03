// Adding and editing a place: Logjam Web's `PlaceDialog.tsx` and Logjam GPS's
// `places/PlaceEditSheet.tsx`. One form for both modes; only the title, the
// submit label and the done toast differ.
import { LATITUDE_RANGE, LONGITUDE_RANGE } from "../placeValidation.js";
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
    {
      key: "photos",
      on: "web",
      gap: "Logjam GPS doesn't take photos in this form yet.",
    },
    {
      key: "route",
      on: "web",
      gap: "Logjam GPS doesn't take a route in this form yet.",
    },
  ],
  copy: {
    addTitle: "Add a place",
    editTitle: "Edit place",
    addSubmit: "Add place",
    saveSubmit: "Save changes",
    added: "Place added.",
    saved: "Place saved.",
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
    notesHint:
      "Visible to anyone you share the place with. Per-trip notes stay private.",
    sources: "Sources",
    photos: "Photos & videos",
    route: ROUTE_NOUN.one,
  },
} as const satisfies ScreenContract;
