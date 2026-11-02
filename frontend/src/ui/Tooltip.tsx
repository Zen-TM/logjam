import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAnchoredPosition, type Placement } from "./floating";
import classes from "./Tooltip.module.css";

/** How long a tooltip survives the pointer leaving its trigger — long enough to
 *  move onto the tooltip itself (WCAG 1.4.13, hoverable). */
const CLOSE_DELAY_MS = 150;

/** How long a tooltip opened by a press stays: a touch screen has no hover to
 *  keep it, and no pointer leaving to close it. */
const PRESS_HOLD_MS = 4000;

/**
 * Supplementary text for a control, on hover AND on keyboard focus, dismissable
 * with Escape without moving focus (WCAG 1.4.13). For what a label cannot say —
 * units, scale, consequence. Never the only place an essential instruction is.
 *
 * `openOnPress` also opens it on a press of the trigger, for a control that is
 * disabled and stays pressable: a touch screen never hovers, so the press is
 * where it asks why.
 *
 * `children` receives the id to put in the control's `aria-describedby`.
 */
export function Tooltip({
  content,
  placement = "bottom-start",
  openOnPress = false,
  children,
}: {
  content: string;
  placement?: Placement;
  openOnPress?: boolean;
  children: (describedById: string) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<number | null>(null);

  useAnchoredPosition(open, anchorRef, tipRef, placement);
  useLayoutEffect(() => {
    const tip = tipRef.current;
    if (!tip) return;
    const shown = tip.matches(":popover-open");
    if (open && !shown) tip.showPopover();
    if (!open && shown) tip.hidePopover();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const show = () => {
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hideSoon = () => {
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(
      () => setOpen(false),
      CLOSE_DELAY_MS,
    );
  };

  // A touch screen has no pointer leaving to close it, so a press holds it for
  // a while. A mouse still on the control keeps it open (WCAG 1.4.13).
  const press = () => {
    show();
    if (!window.matchMedia?.("(hover: none)").matches) return;
    closeTimer.current = window.setTimeout(() => setOpen(false), PRESS_HOLD_MS);
  };

  return (
    // A press is a convenience over the trigger, which is itself the control.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <span
      ref={anchorRef}
      className={classes.anchor}
      onPointerEnter={show}
      onPointerLeave={hideSoon}
      onFocus={show}
      onBlur={() => setOpen(false)}
      onClick={openOnPress ? press : undefined}
    >
      {children(id)}
      <span
        ref={tipRef}
        id={id}
        role="tooltip"
        popover="manual"
        className={classes.tip}
      >
        {content}
      </span>
    </span>
  );
}
