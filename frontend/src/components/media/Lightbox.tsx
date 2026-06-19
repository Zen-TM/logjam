import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { mediaCategory, type MediaItem } from "@logjam/shared";
import classes from "./Lightbox.module.css";

// Full-res image/video overlay with a focus trap (WCAG 2.1.2 / 4.1.2). Shared
// by MediaGallery (grid thumbnails) and CanyonSlideshow so the close/Esc/focus
// behaviour lives in one place. Mounts only while an item is selected.
export default function Lightbox({
  item,
  onClose,
}: {
  item: MediaItem;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerBeforeRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    triggerBeforeRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const container = containerRef.current;
      if (!container) return;
      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, video[controls], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      triggerBeforeRef.current?.focus();
    };
  }, [onClose]);

  return (
    // Backdrop click-to-dismiss. Keyboard users close via Escape (handler above)
    // or the labelled button; focus is trapped, so the pointer-only backdrop is
    // an enhancement, not the sole control.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      ref={containerRef}
      className={classes.lightbox}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Media preview"
    >
      <button
        ref={closeRef}
        className={classes.lightboxClose}
        onClick={onClose}
        aria-label="Close"
      >
        <X size={22} />
      </button>
      <div className={classes.lightboxContent}>
        {mediaCategory(item.mediaType) === "video" ? (
          <video className={classes.lightboxMedia} src={item.displayUrl} controls autoPlay />
        ) : (
          <img className={classes.lightboxMedia} src={item.displayUrl} alt={item.filename} />
        )}
      </div>
    </div>
  );
}
