import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import type { LucideIcon } from "lucide-react";
import { nextEnabledIndex } from "./rovingFocus";
import classes from "./Chip.module.css";

/**
 * The pill behind every chip surface: filter rails, sort choices, sub-mode
 * switches. Active fills with `hue` (default accent) and writes its label in
 * the fixed ink; a `count` rides as a trailing badge; an `icon` leads, tinted
 * with the hue. `dashed` is the "add one" chip at the end of a vocabulary.
 */
export function Chip({
  label,
  count,
  icon: Icon,
  hue,
  active = false,
  dashed = false,
  className,
  style,
  ref,
  type = "button",
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
  count?: number;
  icon?: LucideIcon;
  hue?: string;
  active?: boolean;
  dashed?: boolean;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type={type}
      className={[classes.chip, active && classes.active, dashed && classes.dashed, className]
        .filter(Boolean)
        .join(" ")}
      style={hue ? ({ ...style, "--chip-hue": hue } as CSSProperties) : style}
      // The badge is aria-hidden, so the count joins the name with a pause
      // rather than running into the label ("Canyon241").
      aria-label={count != null ? `${label}, ${count}` : undefined}
      {...rest}
    >
      {Icon && <Icon size={14} aria-hidden className={classes.glyph} />}
      <span>{label}</span>
      {count != null && (
        <span className={classes.count} aria-hidden>
          {count}
        </span>
      )}
    </button>
  );
}

export type ChipOption<T extends string> = {
  value: T;
  label: string;
  count?: number;
  icon?: LucideIcon;
  hue?: string;
  disabled?: boolean;
};

/**
 * A single-select filter over the list below it: ONE line that scrolls
 * sideways, never a wrapped block (wrapping two rails spent ~210px of a 900px
 * panel before the first row).
 *
 * - A radio group: one tab stop, arrow keys move AND select, disabled chips
 *   are skipped.
 * - A vertical wheel scrolls it sideways, but only when it can move, so a wheel
 *   over a rail that fits still reaches whatever scrolls behind it.
 * - Each edge fades only when there is more rail beyond it.
 * - The selected chip is NUDGED into view when the value changes — as far as it
 *   must, never recentred — and `scroll-padding` makes the browser's own focus
 *   scrolling stop clear of the fade, so a focused chip is never hidden under
 *   it (WCAG 2.4.11).
 */
export function ChipRail<T extends string>({
  label,
  options,
  value,
  onChange,
  trailing,
  className,
}: {
  /** The group's accessible name — "Place type", "Status". */
  label: string;
  options: readonly ChipOption<T>[];
  value: T;
  onChange: (next: T) => void;
  /** Rendered after the group, inside the scroller (an "add" chip). */
  trailing?: ReactNode;
  className?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [edges, setEdges] = useState({ start: false, end: false });

  const updateEdges = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const start = scroller.scrollLeft > 1;
    const end = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1;
    setEdges((current) => (current.start === start && current.end === end ? current : { start, end }));
  }, []);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    updateEdges();
    const observer = new ResizeObserver(updateEdges);
    observer.observe(scroller);
    for (const child of Array.from(scroller.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [updateEdges, options]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    // Non-passive, or preventDefault is ignored and the page scrolls too.
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const max = scroller.scrollWidth - scroller.clientWidth;
      const next = Math.min(max, Math.max(0, scroller.scrollLeft + event.deltaY));
      if (max <= 0 || next === scroller.scrollLeft) return;
      event.preventDefault();
      scroller.scrollLeft = next;
    };
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, []);

  const selectedIndex = options.findIndex((option) => option.value === value);
  useEffect(() => {
    chipRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedIndex]);

  const tabStop =
    selectedIndex >= 0 && !options[selectedIndex].disabled
      ? selectedIndex
      : options.findIndex((option) => !option.disabled);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const from = chipRefs.current.findIndex((chip) => chip === document.activeElement);
    if (from < 0) return;
    const to = nextEnabledIndex(
      options.map((option) => Boolean(option.disabled)),
      from,
      event.key,
    );
    if (to == null) return;
    event.preventDefault();
    chipRefs.current[to]?.focus();
    onChange(options[to].value);
  }

  return (
    <div
      className={[classes.rail, className].filter(Boolean).join(" ")}
      data-fade-start={edges.start}
      data-fade-end={edges.end}
    >
      <div ref={scrollerRef} className={classes.scroller} onScroll={updateEdges}>
        {/* tabIndex -1: the chips are the tab stop; the group only hears their keys. */}
        <div
          role="radiogroup"
          aria-label={label}
          tabIndex={-1}
          className={classes.group}
          onKeyDown={onKeyDown}
        >
          {options.map((option, index) => (
            <Chip
              key={option.value}
              ref={(chip) => {
                chipRefs.current[index] = chip;
              }}
              role="radio"
              aria-checked={option.value === value}
              tabIndex={index === tabStop ? 0 : -1}
              disabled={option.disabled}
              label={option.label}
              count={option.count}
              icon={option.icon}
              hue={option.hue}
              active={option.value === value}
              onClick={() => onChange(option.value)}
            />
          ))}
        </div>
        {trailing}
      </div>
    </div>
  );
}
