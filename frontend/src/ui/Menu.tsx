import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { LucideIcon } from "lucide-react";
import { useAnchoredPosition, type Placement } from "./floating";
import { nextEnabledIndex } from "./rovingFocus";
import { useEscape } from "./useEscape";
import classes from "./Menu.module.css";

export type MenuItem = {
  id: string;
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  /** A keyboard shortcut, shown right-aligned. */
  hint?: string;
  /** A count, shown right-aligned as a badge. The badge is hidden from
   *  assistive tech, so put the count in `accessibleLabel`. */
  badge?: number;
  /** The item's accessible name when it must say more than `label`. */
  accessibleLabel?: string;
  disabled?: boolean;
};

export type MenuEntry = MenuItem | { id: string; separator: true };

const isItem = (entry: MenuEntry): entry is MenuItem => !("separator" in entry);

export type MenuTriggerProps = {
  ref: RefObject<HTMLButtonElement | null>;
  onClick: () => void;
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  "aria-controls": string;
};

/** Show or hide a manual popover to match React state. */
function useTopLayer(open: boolean, ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const shown = element.matches(":popover-open");
    if (open && !shown) element.showPopover();
    if (!open && shown) element.hidePopover();
  }, [open, ref]);
}

/** Close on a pointer press outside both the floating element and its anchor.
 *  The anchor is excluded so pressing the trigger toggles rather than closing
 *  and reopening in one click. */
function useOutsidePress(
  open: boolean,
  refs: RefObject<HTMLElement | null>[],
  onOutside: () => void,
) {
  const onOutsideRef = useRef(onOutside);
  onOutsideRef.current = onOutside;
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (refs.some((ref) => ref.current?.contains(target))) return;
      onOutsideRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable objects
  }, [open]);
}

/**
 * A menu of verbs behind a trigger — the row's ⋯, the hero's Add. WAI-ARIA menu
 * button: arrows move, Home/End jump, Escape closes and returns focus to the
 * trigger, Tab leaves. It floats in the top layer, so a list's overflow never
 * clips it.
 */
export function Menu({
  label,
  title,
  entries,
  placement = "bottom-start",
  trigger,
}: {
  /** The menu's accessible name. */
  label: string;
  /** An optional visible heading — the thing the verbs act on. */
  title?: string;
  entries: readonly MenuEntry[];
  placement?: Placement;
  trigger: (props: MenuTriggerProps) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const items = entries.filter(isItem);

  useTopLayer(open, menuRef);
  useAnchoredPosition(open, triggerRef, menuRef, placement);
  useOutsidePress(open, [menuRef, triggerRef], () => setOpen(false));

  useLayoutEffect(() => {
    if (!open) return;
    const first = items.findIndex((item) => !item.disabled);
    itemRefs.current[first]?.focus();
    // Focus once per opening, not on every entries change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    const from = itemRefs.current.findIndex((item) => item === document.activeElement);
    const to = nextEnabledIndex(
      items.map((item) => Boolean(item.disabled)),
      from,
      event.key,
    );
    if (to == null) return;
    event.preventDefault();
    itemRefs.current[to]?.focus();
  }

  let itemIndex = -1;
  return (
    <>
      {trigger({
        ref: triggerRef,
        onClick: () => setOpen((current) => !current),
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": menuId,
      })}
      <div
        ref={menuRef}
        id={menuId}
        popover="manual"
        role="menu"
        aria-label={label}
        tabIndex={-1}
        className={classes.menu}
        onKeyDown={onKeyDown}
      >
        {title && (
          <div className={classes.title} aria-hidden>
            {title}
          </div>
        )}
        {entries.map((entry) => {
          if (!isItem(entry)) return <div key={entry.id} role="separator" className={classes.separator} />;
          itemIndex += 1;
          const index = itemIndex;
          const Icon = entry.icon;
          return (
            <button
              key={entry.id}
              ref={(item) => {
                itemRefs.current[index] = item;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-label={entry.accessibleLabel}
              disabled={entry.disabled}
              className={[classes.item, entry.danger && classes.danger].filter(Boolean).join(" ")}
              onClick={() => {
                close();
                entry.onSelect();
              }}
            >
              {Icon && <Icon size={18} aria-hidden className={classes.glyph} />}
              <span className={classes.label}>{entry.label}</span>
              {entry.hint && <kbd className={classes.hint}>{entry.hint}</kbd>}
              {entry.badge != null && entry.badge > 0 && (
                <span className={classes.badge} aria-hidden>
                  {entry.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}

/**
 * A non-modal panel floating beside a control — the map's Layers. It stays open
 * while the user pans the map behind it (no outside-press dismissal); Escape or
 * its own close button dismisses it and focus returns to the control.
 */
export function Popover({
  open,
  onClose,
  anchorRef,
  label,
  placement = "bottom-end",
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  label: string;
  placement?: Placement;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useTopLayer(open, ref);
  useAnchoredPosition(open, anchorRef, ref, placement);
  useEscape(open ? ref : null, () => {
    onClose();
    anchorRef.current?.focus();
  });

  useLayoutEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  return (
    <section
      ref={ref}
      popover="manual"
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className={[classes.popover, className].filter(Boolean).join(" ")}
    >
      {open && children}
    </section>
  );
}
