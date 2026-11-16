// A place's page: Logjam Web's `PlaceDetailPanel.tsx` and Logjam GPS's
// `places/PlaceDetailScreen.tsx`.
//
// Its verbs are `PLACE_VERBS` (surface "page"): the two a user reaches for
// first sit on the page as buttons, every other one is behind the ⋯. A page
// draws no verb of its own, so Delete and Remove are never a section.
import { fieldValue } from "../fieldValues.js";
import { isLengthField, SOURCES_FIELD_KEY } from "../placeTypes.js";
import { lengthInputText, lengthUnitLabel } from "../units.js";
import { ATTRIBUTE_NOUN } from "../tripLogFields.js";
import type { AttributeRow } from "../logbook.js";
import {
  incomingLabel,
  PLACE_STATUS_LABELS,
  type PlaceStatus,
} from "../placeStatus.js";
import { PLACE_FORM } from "./placeForm.js";
import type { PlaceVerbId } from "./placeVerbs.js";
import type { ContractSection, ScreenContract } from "./types.js";
import { plural, t } from "../i18n.js";

export const PLACE_PAGE = {
  id: "places.page",
  question: t`What do I need to know before I go?`,
  sections: [
    // Name, then what it is: type, status, grade, other names, who it is
    // shared with.
    { key: "hero" },
    { key: "verbs" },
    { key: "position" },
    {
      key: "navigate",
      on: "gps",
      gap: t`A browser has no app to hand a position to, so Logjam Web has Copy position. A link to a third-party map would send the point off the account: the maintainer's call.`,
    },
    // Only the attributes the place answered: a form asks every question, a
    // page reports the answers. They come before the forecast and the gauge:
    // the place's own facts are what a trip day needs first.
    { key: "attributes", shareeSees: true },
    { key: "doesntFit", ownerOnly: true },
    { key: "notes", shareeSees: true },
    // Where the place came from (a RopeWiki import): links out.
    { key: "sources", shareeSees: true },
    { key: "photos", shareeSees: true },
    { key: "route", shareeSees: true },
    // "Show the weather here": WEATHER's words and figures.
    { key: "weather" },
    // The owner's pick of a river gauge, read-only to a sharee, who sees the
    // section only when one is set. The owner with none gets a quiet way to
    // choose; Logjam never picks for them.
    { key: "gauge", shareeSees: true },
    { key: "linkedPlaces", ownerOnly: true },
    { key: "trips" },
    { key: "sharedWith", ownerOnly: true },
  ],
  copy: {
    // A section's title is the copy under its own key, where it is constant.
    position: PLACE_FORM.copy.position,
    gauge: t`River gauge`,
    doesntFit: t`Doesn't fit this type`,
    notes: PLACE_FORM.copy.notes,
    sources: PLACE_FORM.copy.sources,
    alsoKnownAs: PLACE_FORM.copy.alsoKnownAs,
    photos: PLACE_FORM.copy.photos,
    route: PLACE_FORM.copy.route,
    linkedPlaces: t`Linked places`,
    trips: t`Your trips`,
    sharedWith: t`Shared with`,

    copyPosition: t`Coordinates copied.`,
    openInMaps: t`Open in a maps app`,
    sharedMarker: t`visible to friends you share with`,

    chooseGauge: t`Choose a river gauge`,
    changeGauge: t`Change gauge`,
    removeGauge: t`Remove gauge`,
    cancelPick: t`Cancel`,
    gaugePickerHint: t`The nearest gauge can be on a different river, so check the name.`,
    gaugeLoading: t`Loading river gauges…`,
    gaugeMissing: t`This gauge isn't in the latest readings.`,
    gaugeSaveFailed: t`Couldn't save the river gauge.`,

    // An empty slot gets a short label, not a lesson (UX §11).
    notesEmpty: t`No notes yet.`,
    photosEmpty: t`No photos yet.`,
    routeEmpty: t`No route yet.`,
    linkedPlacesEmpty: t`No linked places.`,
    tripsEmpty: t`No trips logged here yet.`,
    // Trips are private to their owner, so a sharee sees only their own.
    tripsShared: t`None of your trips are linked to this place.`,
    sharedWithEmpty: t`Not shared with anyone yet.`,
    shareWithFriend: t`Share with a friend`,
    linkAPlace: t`Link a place`,
    linkAPlaceHint: t`A carpark, a campsite, the exit.`,
    unlinkFromPlace: t`Unlink from this place`,
    unlinkHint: t`Both places are kept.`,
    unlinked: t`Unlinked.`,
    linkFailed: t`Couldn't link that place.`,
    unlinkFailed: t`Couldn't unlink that place.`,

    // Both clients open a parked value to decide what to do with it.
    doesntFitCopied: t`These came across when you copied this place. Open one to decide what to do with it.`,
    doesntFitTypeChange: t`These are left over from when you changed this place's type. Open one to decide what to do with it.`,
  },
} as const satisfies ScreenContract;

/** The done-toast for a new link, on both clients. */
export function placeLinkedToast(name: string): string {
  return t`Linked to ${name}.`;
}

/** The two verbs the page draws as buttons, in order; the ⋯ holds the rest. */
export const PLACE_PAGE_PRIMARY_VERBS = [
  "show",
  "logTrip",
] as const satisfies readonly PlaceVerbId[];

/**
 * A section's title on the page. On the owner's page, a section with something
 * in it that a friend sees says so, so the owner never has to remember which
 * parts a share hands over (ADR 0002: the place record and its place-level
 * media, never the trips). `shared` is whether anyone has the place: a marker
 * on a place nobody was given says what no one can see.
 */
export function placeSectionTitle(
  key: (typeof PLACE_PAGE.sections)[number]["key"],
  title: string,
  view: { owned: boolean; filled: boolean; shared: boolean },
): string {
  const section: ContractSection | undefined = PLACE_PAGE.sections.find(
    (each) => each.key === key,
  );
  return view.owned && view.filled && view.shared && section?.shareeSees
    ? `${title} · ${PLACE_PAGE.copy.sharedMarker}`
    : title;
}

/** Decimals a position is written to: about a metre, on both clients. */
const POSITION_DECIMALS = 5;

export function formatPlacePosition(latitude: number, longitude: number) {
  return `${latitude.toFixed(POSITION_DECIMALS)}, ${longitude.toFixed(POSITION_DECIMALS)}`;
}

/** A value as it is READ: the unit its definition declares ("15 m", or "49.2
 *  ft" where the account reads feet). Only a built-in carries one, and only
 *  where the label does not already say it. Guard: `units.test.ts` ("a length
 *  field"). */
export function withFieldUnit(key: string, text: string): string {
  // Text that already ends in the unit is left as it is, so applying this
  // twice is the same as once. Guard: `contracts.test.ts` ("withRowUnit applied
  // twice is applied once").
  if (!isLengthField(key) || text.endsWith(` ${lengthUnitLabel()}`))
    return text;
  const metres = Number(text);
  const shown =
    text.trim() === "" || !Number.isFinite(metres)
      ? text
      : lengthInputText(metres);
  return `${shown} ${lengthUnitLabel()}`;
}

/** An attribute row with its built-in unit on the value ("15" becomes "15
 *  m"). The value is otherwise left raw: the table formats it by type, and
 *  formatting it here as well would format a date twice. `attributeRows` and
 *  `tripPlanSetAsideRows` apply it; a row that has the unit already keeps it,
 *  so applying it again changes nothing. Guard: `contracts.test.ts`
 *  ("withRowUnit applied twice is applied once"). */
export function withRowUnit(row: AttributeRow): AttributeRow {
  const [key, label, value, type] = row;
  if (value == null || value === "" || !isLengthField(key)) return row;
  return [key, label, withFieldUnit(key, String(value)), type];
}

/** "Canyon attributes": the heading of what this KIND of place records. */
export function placeAttributesTitle(typeName: string | null): string {
  return typeName === null
    ? t`Place ${ATTRIBUTE_NOUN.many}`
    : t`${typeName} ${ATTRIBUTE_NOUN.many}`;
}

/** The status pill: the bucket's label, and for a visited place its tally. A
 *  shared place says whose it is (`owner`: the sharer's name, when known). */
export function placeStatusLabel(
  status: PlaceStatus,
  tripCount: number,
  owner?: string | null,
): string {
  if (status === "shared") return incomingLabel(owner);
  if (status !== "done") return PLACE_STATUS_LABELS[status];
  return `${PLACE_STATUS_LABELS.done} · ${plural(tripCount, "# trip", "# trips")}`;
}

export type PlaceSource = {
  label: string;
  url: string;
  /** The site it points at, for the row's second line. */
  host: string | undefined;
  /** Only http(s) becomes a link: any other scheme is a row that says what it
   *  says and goes nowhere. */
  linkable: boolean;
};

/** The place's source links, or none. A reserved `_`-prefixed key in
 *  `fieldValues`, which no user-authored key can collide with. */
export function placeSources(fieldValues: unknown): PlaceSource[] {
  const stored = fieldValue(fieldValues, SOURCES_FIELD_KEY);
  if (!Array.isArray(stored)) return [];
  return (stored as [string, string][]).map(([label, url]) => {
    let host: string | undefined;
    let linkable = false;
    try {
      const parsed = new URL(url);
      host = parsed.host;
      linkable = parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      // Not a URL: shown as a label, goes nowhere.
    }
    return { label, url, host, linkable };
  });
}
