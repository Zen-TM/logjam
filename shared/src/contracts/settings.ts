// Settings and the lists the user keeps in it: Logjam Web's `SettingsPanel.tsx`,
// `PlaceTypeSection.tsx` and `CustomFieldSection.tsx`, Logjam GPS's
// `screens/SettingsScreen.tsx`, `places/PlaceTypesEditor.tsx` and
// `customFields/CustomFieldsEditor.tsx`. A screen with no question to answer
// has no hero (shared/DESIGN.md §2).
import type { NotificationPreferences } from "../themeSchemes.js";
import { ATTRIBUTE_NOUN } from "../tripLogFields.js";
import type { ScreenContract } from "./types.js";

export const SETTINGS = {
  id: "settings.menu",
  title: "Settings",
  sections: [
    // What is set, not kept. Logjam Web draws the switches inline; Logjam GPS
    // splits them by where they are stored (this phone, the account) into
    // pages, so each page can say once what it needs.
    { key: "preferences" },
    { key: "categories" },
    { key: "attributes" },
    {
      key: "about",
      on: "gps",
      reason:
        "The build a user quotes in a bug report is the one installed on the phone. Logjam Web is always the current site.",
    },
  ],
  copy: {
    categories: "Your own categories",
    attributes: `Your own ${ATTRIBUTE_NOUN.many}`,
    placeTypes: "Place types",
    tripAttributes: "Trip attributes",
    placeAttributes: "Place attributes",
    about: "About",
  },
} as const satisfies ScreenContract;

/** A navigation row's subtitle is live state: how many the user has made. */
export function ownTypeCountLabel(own: number): string {
  return own === 0 ? "Built-ins only" : `${own} of your own`;
}

export function ownAttributeCountLabel(own: number): string {
  if (own === 0) return "None yet";
  return `${own} ${own === 1 ? ATTRIBUTE_NOUN.one : ATTRIBUTE_NOUN.many}`;
}

export type NotificationPreferenceGroup = "email" | "inApp";

/**
 * The notification switches, as data: a new preference is one entry. `what`
 * finishes the group's sentence ("Email me when …"), so a client that draws a
 * switch per sentence and one that draws a group per heading read the same.
 */
export const NOTIFICATION_PREFERENCES = [
  { key: "topoEmail", group: "email", what: "a LiDAR map finishes or fails" },
  {
    key: "exportEmail",
    group: "email",
    what: "a LiDAR map export finishes or fails",
  },
  { key: "geoPdfEmail", group: "email", what: "a GeoPDF finishes or fails" },
  {
    key: "friendRequestInApp",
    group: "inApp",
    what: "someone sends me a friend request",
  },
  {
    key: "shareInApp",
    group: "inApp",
    what: "something is shared with me",
  },
] as const satisfies readonly {
  key: keyof NotificationPreferences;
  group: NotificationPreferenceGroup;
  what: string;
}[];

/** "Email me when" / "Notify me in Logjam GPS when": naming the surface. */
export function notificationGroupLead(
  group: NotificationPreferenceGroup,
  surface: "Logjam Web" | "Logjam GPS",
): string {
  return group === "email" ? "Email me when" : `Notify me in ${surface} when`;
}

/**
 * The words of a list the user keeps (place types, attributes): their own
 * entries under "Yours", then what ships under "Built in". Not a screen
 * contract: the two lists are drawn by their own screens, and nothing could
 * check an order here.
 */
export const SETTINGS_LIST = {
  copy: {
    yours: "Yours",
    builtIn: "Built in",
    addPlaceType: "Add a place type",
    addAttribute: ATTRIBUTE_NOUN.add,
    editType: "Edit type",
    mergeType: "Merge into another type",
    deleteType: "Delete type",
    editAttribute: `Edit ${ATTRIBUTE_NOUN.one}`,
    deleteAttribute: `Delete ${ATTRIBUTE_NOUN.one}`,
  },
} as const;

/** Whether the list draws a "Yours" heading: only against a "Built in". */
export function drawsYoursHeading(own: number, builtIn: number): boolean {
  return own > 0 && builtIn > 0;
}

/** What deleting a place type costs. A type with places cannot be deleted. */
export function placeTypeDeleteConfirm(name: string): {
  confirmTitle: string;
  confirmBody: string;
} {
  return {
    confirmTitle: `Delete ${name}?`,
    confirmBody:
      "Any attributes that belong only to this type are deleted with it. Places are not affected — this type has none.",
  };
}

/**
 * What deleting an attribute costs: the values it holds go with it. `count` is
 * how many rows carry a value, null while that is being counted and "unknown"
 * when counting failed (the sentence is then left out, not guessed).
 */
export function attributeDeleteConfirm(
  label: string,
  count: number | null | "unknown",
  rows: { one: string; many: string },
): { confirmTitle: string; confirmBody: string } {
  const impact =
    count === "unknown"
      ? ""
      : count === null
        ? `Checking how many ${rows.many} use it…`
        : count === 0
          ? `No ${rows.many} have a value for it.`
          : `${count} ${count === 1 ? `${rows.one} has` : `${rows.many} have`} a value for it, and ${count === 1 ? "that value goes" : "those values go"} too.`;
  return {
    confirmTitle: `Delete ${label}?`,
    confirmBody: [
      `This removes the ${ATTRIBUTE_NOUN.one} from every ${rows.one}.`,
      impact,
      "This can't be undone.",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

/** An attributes list with none of the user's own says what they are for. */
export function attributesEmptyHint(row: string): string {
  return `Add your own ${ATTRIBUTE_NOUN.one} to record on every ${row} — e.g. water level or party size.`;
}
