import { useEffect, useRef, type RefObject } from "react";

/** Escape pressed while focus is inside `ref` — for a dialog or sheet, which is
 *  not itself an interactive element and so takes no key handler of its own. */
export function useEscape(ref: RefObject<HTMLElement | null> | null, onEscape: () => void) {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  useEffect(() => {
    const element = ref?.current;
    if (!element) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onEscapeRef.current();
    };
    element.addEventListener("keydown", onKeyDown);
    return () => element.removeEventListener("keydown", onKeyDown);
  }, [ref]);
}
