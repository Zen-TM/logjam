// A place's ⋯ menu on Logjam Web, built from the one declaration of a place's
// verbs (`PLACE_VERBS` in `@logjam/shared`): which verbs, in what order, under
// what words is decided there for both clients. This file adds only what the
// drawing needs, a glyph per verb.
import {
  ArrowRight,
  CloudDownload,
  CopyPlus,
  FileText,
  Link2Off,
  LocateFixed,
  MapPinPlus,
  Mountain,
  NotebookPen,
  Pencil,
  Share2,
  Trash2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import {
  placeVerbs,
  type PLACES_ADD,
  type PlaceVerbIdOn,
  type PlaceVerbSurface,
  type SectionKeysOn,
} from "@logjam/shared";
import type { MenuEntry } from "../../../ui";

export type WebPlaceVerbId = PlaceVerbIdOn<"web">;

/** Exhaustive by type: a verb the contract gives Logjam Web cannot go
 *  undrawn. `placesContracts.test.ts` checks it names no other. */
export const PLACE_VERB_ICON: Record<WebPlaceVerbId, LucideIcon> = {
  open: ArrowRight,
  show: LocateFixed,
  logTrip: NotebookPen,
  edit: Pencil,
  makeTopo: Mountain,
  makeGeoPdf: FileText,
  share: Share2,
  copy: CopyPlus,
  copyAndRemove: CopyPlus,
  remove: Link2Off,
  delete: Trash2,
};

/**
 * The menu for one place on one surface. A rule sits above the verbs that end
 * the user's relationship with the place, so parting with something is never
 * adjacent to an ordinary verb.
 */
export function placeVerbEntries(
  surface: Exclude<PlaceVerbSurface, "pin">,
  owned: boolean,
  run: (id: WebPlaceVerbId) => void,
  disabled = false,
): MenuEntry[] {
  return placeVerbs("web", surface, owned).flatMap((verb, index, all) => {
    const item: MenuEntry = {
      id: verb.id,
      label: verb.label,
      icon: PLACE_VERB_ICON[verb.id],
      ...(verb.danger ? { danger: true } : {}),
      disabled,
      onSelect: () => run(verb.id),
    };
    return verb.separated && index > 0 && !all[index - 1].separated
      ? [{ id: `${verb.id}-sep`, separator: true }, item]
      : [item];
  });
}

/** The glyph each way of adding places is drawn with. Exhaustive by type;
 *  `placesContracts.test.ts` checks it names no entry the contract lacks. */
export const ADD_ENTRY_ICON: Record<
  SectionKeysOn<typeof PLACES_ADD, "web">,
  LucideIcon
> = {
  add: MapPinPlus,
  importFile: Upload,
  importRopewiki: CloudDownload,
};
