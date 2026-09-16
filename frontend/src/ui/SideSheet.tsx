import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useIsMobile } from "../useIsMobile";
import { IconButton } from "./Button";
import { useEscape } from "./useEscape";
import classes from "./SideSheet.module.css";

/**
 * A non-modal sheet that opens BESIDE the page it belongs to — Places' filters,
 * Logs' date range. The list it acts on stays visible and live next to it,
 * which a modal over the list could not do.
 *
 * It places ITSELF (docked beside the page, or taking its place on narrow web):
 * each page used to say where its own sheet went, in identical CSS, and one of
 * the two drifted (operator, 2026-09-16).
 *
 * Focus moves to its heading on open and back to whatever opened it on close;
 * Escape closes it.
 */
export function SideSheet({
  title,
  onClose,
  footer,
  className,
  children,
}: {
  title: string;
  onClose: () => void;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const isNarrow = useIsMobile();
  useEscape(sheetRef, onClose);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    headingRef.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <section
      ref={sheetRef}
      aria-labelledby={titleId}
      className={[classes.sheet, isNarrow ? classes.narrow : classes.docked, className].filter(Boolean).join(" ")}
    >
      <header className={classes.head}>
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className={classes.title}>
          {title}
        </h2>
        <IconButton icon={X} label="Close" onClick={onClose} />
      </header>
      <div className={classes.body}>{children}</div>
      {footer && <footer className={classes.foot}>{footer}</footer>}
    </section>
  );
}

/** A titled group inside a sheet, popover or dialog: section title, then its
 *  controls. */
export function SheetSection({ title, children }: { title: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={classes.section}>
      <SectionHeader id={titleId} title={title} />
      {children}
    </section>
  );
}

/** A section's title — small capitals, muted — with an optional count at the
 *  end of the line (a day in the Inbox). An `h3`: the page, sheet or dialog
 *  title is the `h2`. A count only: an action inside a heading would become
 *  part of its name. */
export function SectionHeader({
  title,
  count,
  id,
  className,
}: {
  title: string;
  count?: number;
  id?: string;
  className?: string;
}) {
  return (
    <h3 id={id} className={[classes.sectionTitle, className].filter(Boolean).join(" ")}>
      <span>{title}</span>
      {count != null && <span>{count}</span>}
    </h3>
  );
}
