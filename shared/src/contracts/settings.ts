// Settings and the lists the user keeps in it: Logjam Web's `SettingsPanel.tsx`,
// `PlaceTypeSection.tsx` and `CustomFieldSection.tsx`, Logjam GPS's
// `screens/SettingsScreen.tsx`, `places/PlaceTypesEditor.tsx` and
// `customFields/CustomFieldsEditor.tsx`. A screen with no question to answer
// has no hero (shared/DESIGN.md §2).
import type { NotificationPreferences } from "../themeSchemes.js";
import { plural, t, type Language } from "../i18n.js";
import { REGIONS, regionsOf, type Region } from "../regions.js";
import { ATTRIBUTE_NOUN } from "../tripLogFields.js";
import type { ConfirmCopy } from "./confirm.js";
import type { ClientOnly, ScreenContract } from "./types.js";

export const SETTINGS = {
  id: "settings.menu",
  title: t`Settings`,
  sections: [
    // What is set, in the order a user goes looking: Logjam GPS draws one row
    // per section here that opens a page of its own (split by where the
    // settings are stored, so each page says once what it needs), Logjam Web
    // draws each one inline. A section only one client has is below.
    { key: "display" },
    // Drawn only while `offersRegionChoice()`: with one region there is
    // nothing to choose.
    { key: "regions" },
    {
      key: "map",
      on: "gps",
      reason: t`These set how the phone's location marker, compass, battery use and screen behave on the map. Logjam Web's map runs on the browser's own settings.`,
    },
    { key: "notifications" },
    {
      key: "offline",
      on: "gps",
      reason: t`Offline maps and the downloads that fetch them are stored on the phone. A browser keeps neither.`,
    },
    { key: "privacy" },
    { key: "categories" },
    { key: "attributes" },
    {
      key: "about",
      on: "gps",
      reason: t`The build a user quotes in a bug report is the one installed on the phone. Logjam Web is always the current site.`,
    },
  ],
  copy: {
    display: t`Display`,
    regions: t`Regions`,
    map: t`Map`,
    notifications: t`Notifications`,
    offline: t`Offline and storage`,
    privacy: t`Privacy and security`,
    friends: t`Friends`,
    copying: t`Copying a place`,
    categories: t`Your own place types`,
    attributes: t`Your own ${ATTRIBUTE_NOUN.many}`,
    placeTypes: t`Place types`,
    tripAttributes: t`Trip attributes`,
    placeAttributes: t`Place attributes`,
    about: t`About`,
  },
} as const satisfies ScreenContract;

/**
 * The Logjam GPS rows with no Logjam Web twin, inside a section both clients
 * draw. A whole page only Logjam GPS has is a section above.
 */
export const SETTINGS_PHONE_ONLY = [
  {
    id: "deviceGuards",
    on: "gps",
    reason: t`App lock, crash reports and Save to gallery configure the phone's own lock, error reporting and photo library. Logjam Web leaves each to the browser.`,
  },
  {
    id: "pushNotifications",
    on: "gps",
    reason: t`A push is allowed per phone, by the phone's own permission, so its switch sits under This phone. Logjam Web's switches follow the account.`,
  },
  {
    id: "textSize",
    on: "gps",
    reason: t`Logjam Web follows the browser's own zoom and text size, so there is nothing to set. The phone's size is chosen in Logjam GPS.`,
  },
] as const satisfies readonly ClientOnly[];

/**
 * The switch under "Copying a place" in Privacy and security, on both
 * clients: whether a copied place's photos and files come too (they count
 * against the account's quota). It is the account's `copyPlaceMedia`, which the
 * server reads whenever a copy request does not say, so a choice made on either
 * client applies to the other's copies. On by default: not copying silently
 * loses what the sharee could see (`themeSchemes.ts`).
 */
export const COPY_MEDIA_SETTING = {
  // Plain literals: a switch's words are measured through their literal types
  // in each client's `switchCopy.test.ts`, and `t` widens them to `string`. No
  // switch-copy test names these two, so a wrap passes there; it turns
  // `i18nCoverage.test.ts` ("writes no new text outside the catalogue, and
  // every ceiling is the count") red until the contracts ceiling is lowered.
  label: "Copy photos too",
  hint: "Shared place photos and files.",
  saveFailed: t`Couldn't save that setting.`,
} as const;

/**
 * The language row in Display, drawn by both clients only while
 * `showsLanguageChoice(offeredHere())` (`languageChoice.ts`), so prod shows
 * none. Guards: `languageChoice.test.ts` ("offers the source alone where the
 * simulated regions are off"), `SettingsPanel.render.test.tsx` ("is not drawn
 * in prod: one region declaring no language, nothing for development") and
 * `mobile/src/languageSetting.test.ts` ("is not drawn with one language
 * offered, recording or not"). Choosing one stores it on the device and
 * restarts the client: the text is read when the client starts, since contract
 * text is evaluated at import (ADR 0050).
 */
export const LANGUAGE_SETTING = {
  title: t`Language`,
  names: {
    "en-AU": t`English (Australia)`,
    "en-US": t`English (United States)`,
    "en-XA": t`Pseudo-language (development)`,
  } satisfies Record<Language, string>,
  hint: {
    web: t`Logjam Web reloads to apply this.`,
    gps: t`Logjam GPS restarts to apply this.`,
  },
  /** Logjam GPS holds the row while a track records, and until the track list is read: the restart would interrupt a recording (`mobile/src/languageSetting.test.ts`, "is held while a track records, with the reason" and "is held until the track list has been read"). */
  held: t`Not while a track is recording: Logjam GPS restarts to change language.`,
  saveFailed: {
    web: t`This browser wouldn't store that language.`,
    gps: t`This phone wouldn't store that language.`,
  },
  restartFailed: t`Saved. Close Logjam GPS and open it again to apply it.`,
} as const;

/**
 * "Where do you canyon?": the step after the username and terms in the
 * first-login gate, and the Regions section of Settings, on both clients.
 * Each draws one switch per region (`REGIONS`), several allowed, and neither
 * is shown while `offersRegionChoice()` is false.
 */
export const REGION_CHOICE = {
  title: t`Where do you canyon?`,
  hint: t`Logjam offers the maps and canyon list of each region you choose.`,
  continue: t`Continue`,
  saveFailed: t`Couldn't save your regions.`,
} as const;

/** Why a choice can't be saved, or null: at least one region stays chosen. */
export function regionChoiceProblem(ids: readonly string[]): string | null {
  return ids.length === 0 ? t`Choose at least one region.` : null;
}

/** The choice with `id` switched, in `REGIONS` order whatever order it was ticked in. */
export function toggleRegion(
  chosen: readonly string[],
  id: string,
  regions: readonly Region[] = REGIONS,
): string[] {
  const next = chosen.includes(id)
    ? chosen.filter((other) => other !== id)
    : [...chosen, id];
  return regionsOf(next, regions).map((region) => region.id);
}

/**
 * Why Settings refuses to switch `id` off, or null: the last chosen region
 * stays on, since an account with none would be offered nothing.
 */
export function regionOffRefusal(
  chosen: readonly string[],
  id: string,
): string | null {
  return chosen.includes(id)
    ? regionChoiceProblem(chosen.filter((other) => other !== id))
    : null;
}

/** The Regions row's subtitle: what is chosen. */
export function chosenRegionsLabel(
  ids: readonly string[],
  regions: readonly Region[] = REGIONS,
): string {
  return regionsOf(ids, regions)
    .map((region) => region.name)
    .join(", ");
}

/** A navigation row's subtitle is live state: how many the user has made. */
export function ownTypeCountLabel(own: number): string {
  return own === 0 ? t`Built-ins only` : t`${own} of your own`;
}

export function ownAttributeCountLabel(own: number): string {
  if (own === 0) return t`None yet`;
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
  hint: t`Add what you record at a place of this type, like a depth or a grade. You can add more later from any place.`,
  done: t`Done`,
} as const;

export type NotificationPreferenceGroup = "email" | "inApp";

/**
 * The notification switches, as data: a new preference is one entry. Each is
 * a switch under its group's lead ("Email me about" › "LiDAR maps"), short
 * enough for a switch label (`SWITCH_COPY_MAX`) on both clients.
 */
export const NOTIFICATION_PREFERENCES = [
  // A LiDAR map or a print or GIS map mails whether it finishes or fails
  // (topo/worker.py, topo/export_worker.py, api/src/lib/topoJobReaper.ts).
  // Plain literals: a switch's words are measured through their literal types,
  // which `t` widens to `string`. Each client's `switchCopy.test.ts` ("keeps to
  // the limit") asserts every label here by name, so wrapping one turns it red
  // on both clients.
  { key: "topoEmail", group: "email", label: "LiDAR maps" },
  { key: "exportEmail", group: "email", label: "Print and GIS maps" },
  { key: "friendRequestInApp", group: "inApp", label: "Friend requests" },
  { key: "shareInApp", group: "inApp", label: "Shares with me" },
] as const satisfies readonly {
  key: keyof NotificationPreferences;
  group: NotificationPreferenceGroup;
  label: string;
}[];

/** The group's lead, naming the surface: "Notify me in Logjam GPS about".
 *  Logjam GPS draws it as a section header, Logjam Web as a group label. */
export function notificationGroupLead(
  group: NotificationPreferenceGroup,
  surface: "Logjam Web" | "Logjam GPS",
): string {
  return group === "email"
    ? t`Email me about`
    : t`Notify me in ${surface} about`;
}

/**
 * The words of a list the user keeps (place types, attributes): their own
 * entries under "Yours", then what ships under "Built in". Not a screen
 * contract: the two lists are drawn by their own screens, and nothing could
 * check an order here.
 */
export const SETTINGS_LIST = {
  copy: {
    yours: t`Yours`,
    builtIn: t`Built in`,
    // Under a "Built in" attributes heading, beside the lock on each row.
    builtInAttributesWhy: t`Built-in ${ATTRIBUTE_NOUN.many} come with Logjam, so they can't be changed or deleted.`,
    addPlaceType: t`Add a place type`,
    addAttribute: ATTRIBUTE_NOUN.add,
    editType: t`Edit type`,
    mergeType: t`Merge into another type`,
    deleteType: t`Delete type`,
    editAttribute: t`Edit ${ATTRIBUTE_NOUN.one}`,
    deleteAttribute: t`Delete ${ATTRIBUTE_NOUN.one}`,
  },
} as const;

/** Whether the list draws a "Yours" heading: only against a "Built in". */
export function drawsYoursHeading(own: number, builtIn: number): boolean {
  return own > 0 && builtIn > 0;
}

/** "3 places" under a place type's name. */
export function placeCountLabel(count: number): string {
  return plural(count, "# place", "# places");
}

/**
 * Why Logjam GPS withholds Delete from a type with places. Logjam Web merges
 * the type into another; Logjam GPS cannot yet (reassigning every place is a
 * server call, not an offline write), so it names Logjam Web for that half.
 */
export function placeTypeInUseNote(count: number): string {
  return plural(
    count,
    "# place uses this type. Change it to another type, or merge it on Logjam Web, to delete it.",
    "# places use this type. Change them to another type, or merge it on Logjam Web, to delete it.",
  );
}

/** What deleting a place type costs. A type with places cannot be deleted. */
export function placeTypeDeleteConfirm(name: string): ConfirmCopy {
  return {
    confirmTitle: t`Delete ${name}?`,
    confirmBody: t`Any attributes that belong only to this type are deleted with it. Places are not affected — this type has none. This can't be undone.`,
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
        ? t`Checking how many ${rows.many} use it…`
        : count === 0
          ? t`No ${rows.many} have a value for it.`
          : plural(
              count,
              "# {0} has a value for it, and that value goes too.",
              "# {0} have a value for it, and those values go too.",
              count === 1 ? rows.one : rows.many,
            );
  return {
    confirmTitle: t`Delete ${label}?`,
    confirmBody: [
      t`This removes the ${ATTRIBUTE_NOUN.one} from every ${rows.one}.`,
      impact,
      t`This can't be undone.`,
    ]
      .filter(Boolean)
      .join(" "),
    confirmLabel: SETTINGS_LIST.copy.deleteAttribute,
    tone: "destructive",
  };
}

/** The line an attributes list always carries: what they are for. */
export function attributesHint(row: string): string {
  return t`Add your own ${ATTRIBUTE_NOUN.one} to record on a ${row}, e.g. water level or party size.`;
}
