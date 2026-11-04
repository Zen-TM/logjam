import type { MouseEvent } from "react";

/** What a press on a card leaves to itself: the card's own controls. */
const CONTROLS = "button, a, input, select, textarea, [role=switch]";

/**
 * A card whose whole face is its switch's target (`Row`'s `onPress`,
 * `SwitchRow`): runs `press` for a click that landed on the card but not on a
 * control inside it. The switch stays the one control and the keyboard path.
 */
export function pressOutsideControls(
  event: MouseEvent<HTMLElement>,
  press: () => void,
) {
  if ((event.target as HTMLElement).closest(CONTROLS)) return;
  press();
}
