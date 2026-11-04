// Putting a way into a place's one route slot: Logjam GPS's `AddWaySheet` and
// Logjam Web's `AddWayDialog`, opened from the place page's Route section.
// "Way" is the umbrella word for a route, a recording or an import in labels
// and prose; the three stay distinct in code and in the lists.
//
// A place holds one route, so every source can displace an incumbent. The
// words for that, and for each source, are written here once.
import type { ConfirmCopy } from "./confirm.js";
import { SHARE_SENTENCES } from "./share.js";
import type { ContractPlatform, ScreenContract } from "./types.js";

/** Where a new way comes from; the order is the order a client lists them in. */
export type WaySource = "route" | "track" | "import" | "file" | "draw";

export const ADD_WAY = {
  id: "places.addWay",
  question: "Where does this place's route come from?",
  title: "Add a way",
  sections: [
    // What you already have, most likely first; then a file; then the pen.
    { key: "route" },
    {
      key: "draw",
      on: "gps",
      reason:
        "Logjam Web draws with the Route tool on the map, which a dialog over the place page would cover.",
    },
    { key: "track" },
    { key: "import" },
    { key: "file" },
  ],
  copy: {
    title: "Add a way",
    // The Route section's button once the slot is full: the same panel.
    replaceTitle: "Replace this place's route",

    routeTitle: "Choose a route you drew",
    routeSubtitle: "One of your saved routes",
    drawTitle: "Draw a route on the map",
    drawSubtitle: "Opens the map to draw a route",
    trackTitle: "Use a recorded track",
    trackSubtitle: "A track you recorded in Logjam GPS",
    importTitle: "Use an imported file",

    findRoute: "Find a route",
    noRoutes: "You haven't drawn any routes yet.",
    noRouteMatch: "No route of yours matches that.",
    // A row already filling the slot is shown, not hidden, so it reads as done.
    alreadyHere: "Already this place's route",

    // What each source says once it has landed.
    routeDone: "Route linked to this place.",
    linkedDone: "Linked as this place's route.",
    fileDone: "Route file linked to this place.",
    failed: "Couldn't set that as this place's route.",
    notRouteFile: "Pick a .gpx or .kml file.",
  },
} as const satisfies ScreenContract;

/** Where a client keeps the user's imports: Logjam GPS's tab, Logjam Web's list. */
function home(platform: ContractPlatform): string {
  return platform === "gps" ? "Saved" : "Ways";
}

/** What an import or recording says BEFORE it is linked: the share sentence. */
export const IMPORT_TO_PLACE_PROMISE = SHARE_SENTENCES.linkedFile;

export function addWayImportSubtitle(platform: ContractPlatform): string {
  return `A GPX or KML already in ${home(platform)}`;
}

/** The file source differs in what it does, so its words differ: Logjam GPS
 *  makes the picked file an import and links it; Logjam Web uploads it onto the
 *  place and nothing else (it has no importer for GPX or KML). */
export function addWayFileRow(platform: ContractPlatform): {
  title: string;
  subtitle: string;
} {
  return platform === "gps"
    ? {
        title: "Import a new file",
        subtitle: "A .gpx or .kml from this phone",
      }
    : {
        title: "Upload a file",
        subtitle: "A .gpx or .kml from this computer",
      };
}

export function addWayNoImports(platform: ContractPlatform): string {
  return platform === "gps"
    ? "No imported GPX or KML on this phone. Import one from Saved and it shows up here."
    : "No imported GPX or KML is free to use. Import one in Logjam GPS and it shows up here.";
}

export function addWayNoTracks(platform: ContractPlatform): string {
  return platform === "gps"
    ? "No finished recording here is long enough to make a route from. Start one from the map and it shows up here once you stop it."
    : "No recorded track is free to use. Record one in Logjam GPS and it shows up here.";
}

/** What fills the slot now, as far as the confirm needs to know. */
export type RouteSlotIncumbent = {
  /** A drawn route; a standalone file (import or recording) linked to the
   *  place; or a file uploaded onto the place, which has no life apart from it. */
  kind: "route" | "file" | "upload";
  name: string;
};

/**
 * What the user agrees to when a new way displaces the incumbent. Null when the
 * slot is free. The incoming way is deliberately not named: some sources have
 * not chosen yet when this is asked, and a sentence that only sometimes names
 * its subject reads differently depending on how you got here.
 */
export function routeSlotDisplaceConfirm(
  platform: ContractPlatform,
  placeName: string,
  incumbent: RouteSlotIncumbent | null,
): ConfirmCopy | null {
  if (!incumbent) return null;
  const confirmTitle = `${placeName} already has a route`;
  if (incumbent.kind === "upload") {
    return {
      confirmTitle,
      confirmBody: `“${incumbent.name}” was uploaded to this place and will be deleted.`,
      confirmLabel: "Replace",
      tone: "destructive",
    };
  }
  return {
    confirmTitle,
    confirmBody:
      incumbent.kind === "route"
        ? `“${incumbent.name}” will be unlinked, but the route is kept.`
        : `“${incumbent.name}” will be unlinked, but the file is kept in ${home(platform)}.`,
    confirmLabel: "Replace",
    // Unlinked, not deleted: nothing is lost.
    tone: "filled",
  };
}
