// A TRIP'S VERBS, declared once for every surface that acts on one: its row in
// the logbook and its page. The lists differ by exactly one verb: Open, absent
// on the page you are already on (shared/DESIGN.md §9).
import type { IconIdea } from "../icons.js";

export type TripVerbSurface = "row" | "page";

type TripVerbDeclaration = {
  id: string;
  icon: IconIdea;
  label: string;
  /** The one surface that leaves it out. */
  omitOn?: TripVerbSurface;
  danger?: boolean;
  /** Below a rule, with the verbs that end things. */
  separated?: boolean;
};

/** In menu order. */
export const TRIP_VERBS = [
  { id: "open", icon: "trip", label: "Open trip", omitOn: "page" },
  { id: "edit", icon: "edit", label: "Edit trip" },
  {
    id: "delete",
    icon: "delete",
    label: "Delete trip",
    danger: true,
    separated: true,
  },
] as const satisfies readonly TripVerbDeclaration[];

export type TripVerbId = (typeof TRIP_VERBS)[number]["id"];

export type TripVerb = {
  id: TripVerbId;
  icon: IconIdea;
  label: string;
  danger: boolean;
  separated: boolean;
};

/** The verbs of one trip on one surface, in order. */
export function tripVerbs(surface: TripVerbSurface): TripVerb[] {
  return (TRIP_VERBS as readonly TripVerbDeclaration[])
    .filter((verb) => verb.omitOn !== surface)
    .map((verb) => ({
      id: verb.id as TripVerbId,
      icon: verb.icon,
      label: verb.label,
      danger: verb.danger ?? false,
      separated: verb.separated ?? false,
    }));
}

/**
 * What deleting trips costs, said once for every surface that offers Delete:
 * what goes, and what stays.
 */
export function tripDeleteConfirm(count: number): {
  confirmTitle: string;
  confirmBody: string;
} {
  const one = count === 1;
  return {
    confirmTitle: one ? "Delete this trip?" : `Delete ${count} trips?`,
    confirmBody: `${one ? "Its" : "Their"} photos, videos and tracks go too. The ${one ? "places it links" : "places they link"} to stay. This can't be undone.`,
  };
}
