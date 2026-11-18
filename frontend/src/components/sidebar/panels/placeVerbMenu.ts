// A place's ⋯ menu on Logjam Web, built from the one declaration of a place's
// verbs (`PLACE_VERBS` in `@logjam/shared`): which verbs, in what order, under
// what words and with what glyph is decided there for both clients.
import {
  placeVerbs,
  t,
  type PlaceVerbIdOn,
  type PlaceVerbSurface,
  type SharpenUnavailable,
} from "@logjam/shared";
import type { MenuEntry, MenuItem } from "../../../ui";

export type WebPlaceVerbId = PlaceVerbIdOn<"web">;

/**
 * What a menu item gains where its action cannot run: `state` beside its
 * label, and a name for a screen reader that carries `reason` too. The item
 * stays in the arrow keys' path and selecting it does nothing (`Menu`).
 */
export function unavailableItem(
  label: string,
  { state, reason }: SharpenUnavailable,
): Pick<MenuItem, "disabledReason" | "accessibleLabel"> {
  return {
    disabledReason: state,
    accessibleLabel: t`${label}, ${state}. ${reason}`,
  };
}

/**
 * The menu for one place on one surface. A rule sits above the verbs that end
 * the user's relationship with the place, so parting with something is never
 * adjacent to an ordinary verb. An `unavailable` verb stays in the menu and
 * says `state` beside its label; a screen reader also hears `reason`.
 */
export function placeVerbEntries(
  surface: Exclude<PlaceVerbSurface, "pin">,
  owned: boolean,
  run: (id: WebPlaceVerbId) => void,
  disabled = false,
  unavailable: Partial<Record<WebPlaceVerbId, SharpenUnavailable>> = {},
): MenuEntry[] {
  return placeVerbs("web", surface, owned).flatMap((verb, index, all) => {
    const item: MenuEntry = {
      id: verb.id,
      label: verb.label,
      icon: verb.icon,
      ...(verb.danger ? { danger: true } : {}),
      disabled,
      onSelect: () => run(verb.id),
      ...(unavailable[verb.id]
        ? unavailableItem(verb.label, unavailable[verb.id]!)
        : {}),
    };
    return verb.separated && index > 0 && !all[index - 1].separated
      ? [{ id: `${verb.id}-sep`, separator: true }, item]
      : [item];
  });
}
