import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { Plus, Star, type LucideIcon } from "lucide-react";
import { FieldError } from "../components/feedback/FieldError";
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
  starred = false,
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
  /** A trailing star: this one's place in a selection means something. */
  starred?: boolean;
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
      {starred && <Star size={12} aria-hidden fill="currentColor" className={classes.glyph} />}
      {count != null && (
        <span className={classes.count} aria-hidden>
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * Several choices from a vocabulary the user can extend — a trip's types
 * (Logjam GPS's `ChipPicker`). Each chip is a toggle button, and chips keep
 * VOCABULARY order whatever is picked: moving a picked chip to the front made
 * every press a re-read of the whole block. Where the order of the picks means
 * something, the chip it decides is `primaryValue`, starred rather than moved.
 *
 * `onAdd` puts an "Add" chip at the end that becomes a small field: Enter adds,
 * Escape backs out of the field alone (never the dialog around it), and leaving
 * it adds what was typed.
 */
export function ChipPicker({
  label,
  options,
  selected,
  onToggle,
  onAdd,
  addLabel = "Add",
  lockedValues,
  primaryValue,
  hint,
  error,
}: {
  label: string;
  options: readonly Omit<ChipOption<string>, "count">[];
  selected: readonly string[];
  onToggle: (value: string) => void;
  onAdd?: (label: string) => void;
  addLabel?: string;
  /** Picked and not changeable here. Say why in `hint`. */
  lockedValues?: ReadonlySet<string>;
  primaryValue?: string;
  hint?: string;
  error?: string | null;
}) {
  const legendId = useId();
  const hintId = useId();
  const errorId = useId();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const addChipRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const finish = (commit: boolean) => {
    const trimmed = draft.trim();
    if (commit && trimmed && onAdd) onAdd(trimmed);
    setDraft("");
    setAdding(false);
  };

  const picked = new Set(selected);
  return (
    <div
      role="group"
      aria-labelledby={legendId}
      aria-describedby={[hint && hintId, error && errorId].filter(Boolean).join(" ") || undefined}
      className={classes.picker}
    >
      <span id={legendId} className={classes.pickerLabel}>
        {label}
      </span>
      <div className={classes.pickerChips}>
        {options.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            icon={option.icon}
            hue={option.hue}
            active={picked.has(option.value)}
            aria-pressed={picked.has(option.value)}
            disabled={option.disabled || lockedValues?.has(option.value)}
            starred={option.value === primaryValue}
            aria-label={option.value === primaryValue ? `${option.label}, starred` : undefined}
            onClick={() => onToggle(option.value)}
          />
        ))}
        {onAdd &&
          (adding ? (
            <input
              ref={inputRef}
              className={classes.pickerInput}
              value={draft}
              aria-label={addLabel}
              placeholder={addLabel}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  // Inside a form, Enter would otherwise submit it.
                  event.preventDefault();
                  finish(true);
                  addChipRef.current?.focus();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  finish(false);
                }
              }}
              onBlur={() => finish(true)}
            />
          ) : (
            <Chip ref={addChipRef} label={addLabel} icon={Plus} dashed onClick={() => setAdding(true)} />
          ))}
      </div>
      {hint && (
        <p id={hintId} className={classes.pickerHint}>
          {hint}
        </p>
      )}
      <FieldError id={errorId} message={error ?? null} />
    </div>
  );
}

/** A wheel notch moves a rail this fraction of what it would scroll a page: a
 *  rail is a few hundred pixels wide, and a full notch skipped most of it. */
// ponytail: one fixed factor; tune here if a mouse or trackpad feels wrong.
const WHEEL_SPEED = 0.5;

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
      // Firefox can report whole lines rather than pixels.
      const pixels = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
      const next = Math.min(max, Math.max(0, scroller.scrollLeft + pixels * WHEEL_SPEED));
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
