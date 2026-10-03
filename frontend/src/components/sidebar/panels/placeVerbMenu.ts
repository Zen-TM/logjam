// A place's ⋯ menu on Logjam Web, built from the one declaration of a place's
// verbs (`PLACE_VERBS` in `@logjam/shared`): which verbs, in what order, under
// what words and with what glyph is decided there for both clients.
import {
  placeVerbs,
  type PlaceVerbIdOn,
  type PlaceVerbSurface,
} from "@logjam/shared";
import type { MenuEntry } from "../../../ui";

export type WebPlaceVerbId = PlaceVerbIdOn<"web">;

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
      icon: verb.icon,
      ...(verb.danger ? { danger: true } : {}),
      disabled,
      onSelect: () => run(verb.id),
    };
    return verb.separated && index > 0 && !all[index - 1].separated
      ? [{ id: `${verb.id}-sep`, separator: true }, item]
      : [item];
  });
}
