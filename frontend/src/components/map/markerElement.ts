/**
 * An element for a marker that only shows something: a press on it is a
 * press on the map under it, so it never swallows a "What is here?" or a pin.
 */
export function passThrough(): HTMLDivElement {
  const element = document.createElement("div");
  element.style.pointerEvents = "none";
  return element;
}
