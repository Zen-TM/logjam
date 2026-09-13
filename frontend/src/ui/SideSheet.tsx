import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "./Button";
import { useEscape } from "./useEscape";
import classes from "./SideSheet.module.css";

/**
 * A non-modal sheet that opens BESIDE the panel it belongs to — the Places
 * filters. The list it acts on stays visible and live next to it, which a modal
 * over the list could not do.
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
      className={[classes.sheet, className].filter(Boolean).join(" ")}
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

/** A titled group inside a sheet or popover: eyebrow, then its controls. */
export function SheetSection({ title, children }: { title: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={classes.section}>
      <h3 id={titleId} className={classes.sectionTitle}>
        {title}
      </h3>
      {children}
    </section>
  );
}
