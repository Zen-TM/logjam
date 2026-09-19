import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useAnchoredPosition, type Placement } from "./floating";
import classes from "./Tooltip.module.css";

/** How long a tooltip survives the pointer leaving its trigger — long enough to
 *  move onto the tooltip itself (WCAG 1.4.13, hoverable). */
const CLOSE_DELAY_MS = 150;

/**
 * Supplementary text for a control, on hover AND on keyboard focus, dismissable
 * with Escape without moving focus (WCAG 1.4.13). For what a label cannot say —
 * units, scale, consequence. Never the only place an essential instruction is.
 *
 * `children` receives the id to put in the control's `aria-describedby`.
 */
export function Tooltip({
  content,
  placement = "bottom-start",
  children,
}: {
  content: string;
  placement?: Placement;
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
    closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };

  return (
    <span
      ref={anchorRef}
      className={classes.anchor}
      onPointerEnter={show}
      onPointerLeave={hideSoon}
      onFocus={show}
      onBlur={() => setOpen(false)}
    >
      {children(id)}
      <span ref={tipRef} id={id} role="tooltip" popover="manual" className={classes.tip}>
        {content}
      </span>
    </span>
  );
}
