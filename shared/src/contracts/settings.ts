// Settings and the lists the user keeps in it: Logjam Web's `SettingsPanel.tsx`,
// `PlaceTypeSection.tsx` and `CustomFieldSection.tsx`, Logjam GPS's
// `screens/SettingsScreen.tsx`, `places/PlaceTypesEditor.tsx` and
// `customFields/CustomFieldsEditor.tsx`. A screen with no question to answer
// has no hero (shared/DESIGN.md §2).
import type { NotificationPreferences } from "../themeSchemes.js";
import { ATTRIBUTE_NOUN } from "../tripLogFields.js";
import type { ConfirmCopy } from "./confirm.js";
import type { ClientOnly, ScreenContract } from "./types.js";

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
    categories: "Your own place types",
    attributes: `Your own ${ATTRIBUTE_NOUN.many}`,
    placeTypes: "Place types",
    tripAttributes: "Trip attributes",
    placeAttributes: "Place attributes",
    about: "About",
  },
} as const satisfies ScreenContract;

/**
 * The Logjam GPS settings pages and rows with no Logjam Web twin. Not
 * sections: `preferences` is one section on both clients, and Logjam GPS
 * splits it into pages.
 */
export const SETTINGS_PHONE_ONLY = [
  {
    id: "map",
    on: "gps",
    reason:
      "These set how the phone's location marker, compass, battery use and screen behave on the map. Logjam Web's map runs on the browser's own settings.",
  },
  {
    id: "offline",
    on: "gps",
    reason:
      "Offline maps and copied photos are stored on the phone. A browser keeps neither.",
  },
  {
    id: "privacy",
    on: "gps",
    reason:
      "App lock, crash reports and Save to gallery configure the phone's own lock, error reporting and photo library. Logjam Web leaves each to the browser.",
  },
  {
    id: "pushNotifications",
    on: "gps",
    reason:
      "A push is allowed per phone, by the phone's own permission, so its switch sits under This phone. Logjam Web's switches follow the account.",
  },
  {
    id: "textSize",
    on: "gps",
    reason:
      "Logjam Web follows the browser's own zoom and text size, so there is nothing to set. The phone's size is chosen in Logjam GPS.",
  },
] as const satisfies readonly ClientOnly[];

/** A navigation row's subtitle is live state: how many the user has made. */
export function ownTypeCountLabel(own: number): string {
  return own === 0 ? "Built-ins only" : `${own} of your own`;
}

export function ownAttributeCountLabel(own: number): string {
  if (own === 0) return "None yet";
  return `${own} ${own === 1 ? ATTRIBUTE_NOUN.one : ATTRIBUTE_NOUN.many}`;
}

/**
 * Where saving a place type leads. ADDING one leads into the attributes a
 * place of it will ask for: a new type nearly always wants its own, and the
 * moment it is made is when the user knows what they are. One press skips it.
 * A change to an existing type goes back to the list it was opened from.
 */
export function stepAfterPlaceTypeSave(
  wasAdding: boolean,
): "attributes" | "list" {
  return wasAdding ? "attributes" : "list";
}

/** That step: the attributes a place of the new type shows (`defsForType`)
 *  under the title its place page gives them (`placeAttributesTitle`), a way
 *  to add one already scoped to it, and the way past. */
export const NEW_TYPE_ATTRIBUTES = {
  /** Shown while none of the user's own attributes is on the type yet. */
  hint: "Add what you record at a place of this type, like a depth or a grade. You can add more later from any place.",
  done: "Done",
} as const;

export type NotificationPreferenceGroup = "email" | "inApp";

/**
 * The notification switches, as data: a new preference is one entry. Each is
 * a switch under its group's heading ("Email me about" › "LiDAR maps"), short
 * enough for a switch label (`SWITCH_COPY_MAX`) on both clients.
 */
export const NOTIFICATION_PREFERENCES = [
  // A LiDAR map or an export mails whether it finishes or fails
  // (topo/worker.py, topo/export_worker.py, api/src/lib/topoJobReaper.ts).
  { key: "topoEmail", group: "email", label: "LiDAR maps" },
  { key: "exportEmail", group: "email", label: "Area exports" },
  { key: "friendRequestInApp", group: "inApp", label: "Friend requests" },
  { key: "shareInApp", group: "inApp", label: "Shares with me" },
] as const satisfies readonly {
  key: keyof NotificationPreferences;
  group: NotificationPreferenceGroup;
  label: string;
}[];

/** The group's heading, naming the surface: "Notify me in Logjam GPS about". */
export function notificationGroupLead(
  group: NotificationPreferenceGroup,
  surface: "Logjam Web" | "Logjam GPS",
): string {
  return group === "email" ? "Email me about" : `Notify me in ${surface} about`;
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
    // Under a "Built in" attributes heading, beside the lock on each row.
    builtInAttributesWhy: `Built-in ${ATTRIBUTE_NOUN.many} come with Logjam, so they can't be changed or deleted.`,
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

/** "3 places" under a place type's name. */
export function placeCountLabel(count: number): string {
  return `${count} place${count === 1 ? "" : "s"}`;
}

/**
 * Why Logjam GPS withholds Delete from a type with places. Logjam Web merges
 * the type into another; Logjam GPS cannot yet (reassigning every place is a
 * server call, not an offline write), so it names Logjam Web for that half.
 */
export function placeTypeInUseNote(count: number): string {
  return `${placeCountLabel(count)} use${count === 1 ? "s" : ""} this type. Change ${count === 1 ? "it" : "them"} to another type, or merge it on Logjam Web, to delete it.`;
}

/** What deleting a place type costs. A type with places cannot be deleted. */
export function placeTypeDeleteConfirm(name: string): ConfirmCopy {
  return {
    confirmTitle: `Delete ${name}?`,
    confirmBody:
      "Any attributes that belong only to this type are deleted with it. Places are not affected — this type has none. This can't be undone.",
    confirmLabel: SETTINGS_LIST.copy.deleteType,
    tone: "destructive",
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
): ConfirmCopy {
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
    confirmLabel: SETTINGS_LIST.copy.deleteAttribute,
    tone: "destructive",
  };
}

/** The line an attributes list always carries: what they are for. */
export function attributesHint(row: string): string {
  return `Add your own ${ATTRIBUTE_NOUN.one} to record on a ${row}, e.g. water level or party size.`;
}
