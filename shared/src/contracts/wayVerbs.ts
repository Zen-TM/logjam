// A WAY'S VERBS: a route, a file, a recording: the lines on the map. Logjam
// Web's `wayActions.ts` (its Ways list and page) and Logjam GPS's route,
// track and import sheets. A way is a thing the user keeps, so the words for
// keeping a copy are the places' (`PLACE_VERBS`), not "Save to my Ways".
//
// Only the labels both clients draw are declared here: which verbs a given
// way has is decided by what it is and whose it is, where the rows are built.
import type { IconIdea } from "../icons.js";
import type { ContractPlatform } from "./types.js";

type WayVerbDeclaration = {
  id: string;
  /** One word for both, or each client's. A "…" is Logjam Web's: its menu
   *  items mark the ones that open a dialog. */
  label: string | Record<ContractPlatform, string>;
  /** The idea its glyph stands for, where the verb has one of its own to say
   *  (a client otherwise glyphs the verbs it already had). */
  icon?: IconIdea;
};

export const WAY_VERBS = [
  { id: "open", label: "Open" },
  { id: "openPlace", label: "Open its place" },
  // A recorded track only: it opens the real trip form with the track's day, its
  // place and the track itself already in it (`tripPrefillFromTrack`). The
  // same verb as a place's "Log a trip here", at the same glyph.
  { id: "logTrip", label: "Log a trip", icon: "trip" },
  { id: "edit", label: "Edit points" },
  // Not "Copy": the promise is that it becomes YOURS, unaffected by the owner
  // later unsharing it.
  { id: "copy", label: "Save a copy" },
  { id: "copyAndRemove", label: "Save a copy and remove" },
  { id: "share", label: { web: "Share…", gps: "Share" } },
  { id: "sendCopy", label: "Send a copy" },
  { id: "exportGpx", label: "Export as GPX" },
  { id: "exportKml", label: "Export as KML" },
  // Not "Export": this hands back the FILE the user brought or recorded, byte
  // for byte, where Export writes a new one out of geometry.
  { id: "download", label: "Download" },
  {
    id: "rename",
    label: { web: "Rename…", gps: "Rename" },
  },
  { id: "removeShare", label: "Remove from my account" },
] as const satisfies readonly WayVerbDeclaration[];

export type WayVerbId = (typeof WAY_VERBS)[number]["id"];

/** One verb's words on one client. */
export function wayVerbLabel(
  id: WayVerbId,
  platform: ContractPlatform,
): string {
  const label = WAY_VERBS.find((verb) => verb.id === id)!.label;
  return typeof label === "string" ? label : label[platform];
}

/** One verb's glyph, where it declares one. */
export function wayVerbIcon(id: WayVerbId): IconIdea | undefined {
  const verb = WAY_VERBS.find((entry) => entry.id === id) as
    | WayVerbDeclaration
    | undefined;
  return verb?.icon;
}
