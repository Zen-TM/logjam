const OPEN = "maplibregl-compact-show";

/**
 * Closes MapLibre's compact credits the first time it opens them by itself (it
 * does when the first credit arrives, and closes them again on the first drag),
 * then stops watching, so a press on the (i) afterwards opens them and they stay
 * open. The class changes in one `classList.add`, so the observer's callback
 * runs before the open box is painted.
 */
export function collapseCreditsOnce(credits: Element): void {
  const collapse = () => {
    if (!credits.classList.contains(OPEN)) return;
    credits.classList.remove(OPEN);
    observer.disconnect();
  };
  const observer = new MutationObserver(collapse);
  observer.observe(credits, { attributes: true, attributeFilter: ["class"] });
  collapse();
}
