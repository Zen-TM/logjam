// Adding and editing a place: Logjam Web's `PlaceDialog.tsx` and Logjam GPS's
// `places/PlaceEditSheet.tsx`. One form for both modes; only the title, the
// submit label and the done toast differ.
import { LATITUDE_RANGE, LONGITUDE_RANGE } from "../placeValidation.js";
import { SHARE_SENTENCES } from "./share.js";
import { ROUTE_NOUN } from "../tripLogFields.js";
import type { ScreenContract } from "./types.js";
import { t } from "../i18n.js";

export const PLACE_FORM = {
  id: "places.form",
  question: t`Where is it, and what is it?`,
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
      gap: t`Logjam GPS doesn't take sources in this form yet.`,
    },
    // Both clients take photos and a route while a place is being made. Logjam
    // GPS holds the picks until the place is saved; Logjam Web uploads them
    // against a draft place.
    {
      key: "photos",
      onlyWhenAdding: {
        on: "gps",
        gap: t`Logjam GPS edits an existing place's photos on its page, where the picker can run.`,
      },
    },
    {
      key: "route",
      onlyWhenAdding: {
        on: "gps",
        gap: t`Logjam GPS edits an existing place's route on its page, where the picker can run.`,
      },
    },
  ],
  copy: {
    addTitle: t`Add a place`,
    editTitle: t`Edit place`,
    addSubmit: t`Add place`,
    saveSubmit: t`Save changes`,
    added: t`Place added.`,
    saved: t`Place saved.`,
    // Under a photo or a way picked on a new place, until Save queues it.
    stagedHint: t`Added to the place when you save.`,
    // The way button once one is picked on a place not yet saved.
    chooseAnotherWay: t`Choose another way`,
    pickFailed: t`Couldn't add that photo or video. Try again.`,
    addedNotAll: t`Place added. Some photos, videos or the route couldn't be added: add them from the place.`,
    saveFailed: t`Couldn't save this place.`,
    fixFields: t`Fix the highlighted fields.`,

    type: t`Type`,
    name: t`Name`,
    nameMissing: t`A place needs a name.`,
    alsoKnownAs: t`Also known as`,
    alsoKnownAsHint: t`Separate alternative names with commas. They're searchable too.`,
    position: t`Position`,
    latitude: t`Latitude`,
    longitude: t`Longitude`,
    latitudeMissing: t`Enter a latitude.`,
    longitudeMissing: t`Enter a longitude.`,
    latitudeInvalid: t`Latitude must be a number between ${LATITUDE_RANGE.min} and ${LATITUDE_RANGE.max}`,
    longitudeInvalid: t`Longitude must be a number between ${LONGITUDE_RANGE.min} and ${LONGITUDE_RANGE.max}`,
    coordinatesHint: t`Decimal degrees (WGS84).`,
    selectOnMap: t`Select on map`,
    notes: t`Notes`,
    notesHint: SHARE_SENTENCES.notesHint,
    sources: t`Sources`,
    photos: t`Photos & videos`,
    route: ROUTE_NOUN.one,
  },
} as const satisfies ScreenContract;
