import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { Popover } from "./Menu";
import { hexToHsva, hsvaToHex, isHexRgba, type Hsva } from "./colour";
import choice from "./Choice.module.css";
import classes from "./ColourField.module.css";

/**
 * Any colour, opacity included (`#RRGGBBAA`) — how a topo draws its contours,
 * slope bands and map features.
 *
 * NOT the picker for anything with an identity hue. A route's colour and a
 * place type's colour come from closed palettes (`SwatchPicker`), because a
 * closed set is what the contrast guard can measure; a free picker would delete
 * that check rather than fail it (root CLAUDE.md). A topo's styles are map
 * cartography, drawn over terrain rather than read as UI, and their users tune
 * them to the shade — so here the colour is free.
 *
 * The same LINE as `SwatchPicker`: the label at the left, the colour as a square
 * at the right, and only the square presses. The square sits on a checkerboard,
 * which is the only way a translucent colour can show that it is translucent.
 * `hideLabel` keeps the label as the name and draws only the square, for a row
 * that already says what the colour is for.
 *
 * Inside: a saturation/brightness plane, a hue strip and an opacity strip, each a
 * `role="slider"` the arrow keys move (Shift for bigger steps), and the value as
 * text for pasting one in. Changes apply as they are made — this is for styling
 * something live on the map — and a press outside closes it (DESIGN.md §6).
 */
export function ColourField({
  label,
  hideLabel = false,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  hideLabel?: boolean;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [hsva, setHsva] = useState<Hsva>(() => hexToHsva(value));
  const [draft, setDraft] = useState(value);
  // The last value emitted or received. Without it, the parent echoing a drag
  // back as `value` would reset the plane mid-drag, and a hue of 0 and 360 (or
  // any hue at zero saturation) would snap to whatever the round trip reads.
  const committed = useRef(value);

  useEffect(() => {
    if (value === committed.current) return;
    committed.current = value;
    setHsva(hexToHsva(value));
    setDraft(value);
  }, [value]);

  const change = (next: Hsva) => {
    const hex = hsvaToHex(next);
    committed.current = hex;
    setHsva(next);
    setDraft(hex);
    onChange(hex);
  };

  const opaque = hsvaToHex({ ...hsva, a: 1 }).slice(0, 7);

  return (
    <div className={hideLabel ? classes.bare : choice.swatchField}>
      {!hideLabel && <span className={choice.swatchLabel}>{label}</span>}
      <button
        ref={triggerRef}
        type="button"
        className={classes.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${value}`}
        title={value}
        disabled={disabled}
        style={{ "--swatch": value } as CSSProperties}
        onClick={() => setOpen((current) => !current)}
      />

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        label={label}
        placement="bottom-end"
        className={classes.popover}
        dismissOnOutsidePress
      >
        <div
          className={classes.picker}
          style={{ "--hue": hsva.h, "--s": `${hsva.s}%`, "--v": `${100 - hsva.v}%`, "--a": `${hsva.a * 100}%`, "--opaque": opaque } as CSSProperties}
        >
          <Plane hsva={hsva} onChange={(s, v) => change({ ...hsva, s, v })} />
          <Strip
            label="Hue"
            className={classes.hue}
            ratio={hsva.h / 360}
            valueNow={Math.round(hsva.h)}
            valueMax={360}
            valueText={`${Math.round(hsva.h)} degrees`}
            step={(big) => (big ? 15 : 1) / 360}
            onChange={(ratio) => change({ ...hsva, h: ratio * 360 })}
          />
          <Strip
            label="Opacity"
            className={classes.alpha}
            ratio={hsva.a}
            valueNow={Math.round(hsva.a * 100)}
            valueMax={100}
            valueText={`${Math.round(hsva.a * 100)}%`}
            step={(big) => (big ? 0.1 : 0.01)}
            onChange={(ratio) => change({ ...hsva, a: ratio })}
          />
          <input
            type="text"
            aria-label={`${label}, as #RRGGBBAA`}
            className={classes.hex}
            value={draft}
            maxLength={9}
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              if (!isHexRgba(draft)) {
                setDraft(value);
                return;
              }
              change(hexToHsva(draft.toLowerCase()));
            }}
          />
        </div>
      </Popover>
    </div>
  );
}

/** Follows the pointer from a press, wherever it goes, until it lifts. */
function usePointerTrack(onMove: (x: number, y: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (event: PointerEvent) => {
    const box = ref.current!.getBoundingClientRect();
    onMove(
      Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
      Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)),
    );
  };
  return {
    ref,
    onPointerDown: (event: PointerEvent) => {
      ref.current!.setPointerCapture(event.pointerId);
      move(event);
    },
    onPointerMove: (event: PointerEvent) => {
      if (ref.current!.hasPointerCapture(event.pointerId)) move(event);
    },
  };
}

function Plane({ hsva, onChange }: { hsva: Hsva; onChange: (s: number, v: number) => void }) {
  const track = usePointerTrack((x, y) => onChange(x * 100, (1 - y) * 100));
  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 10 : 1;
    let { s, v } = hsva;
    if (event.key === "ArrowLeft") s = Math.max(0, s - step);
    else if (event.key === "ArrowRight") s = Math.min(100, s + step);
    else if (event.key === "ArrowUp") v = Math.min(100, v + step);
    else if (event.key === "ArrowDown") v = Math.max(0, v - step);
    else return;
    event.preventDefault();
    onChange(s, v);
  };
  return (
    <div
      {...track}
      className={classes.plane}
      tabIndex={0}
      role="slider"
      aria-label="Saturation and brightness"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(hsva.s)}
      aria-valuetext={`Saturation ${Math.round(hsva.s)}%, brightness ${Math.round(hsva.v)}%`}
      onKeyDown={onKeyDown}
    >
      <span className={`${classes.thumb} ${classes.planeThumb}`} />
    </div>
  );
}

function Strip({
  label,
  className,
  ratio,
  valueNow,
  valueMax,
  valueText,
  step,
  onChange,
}: {
  label: string;
  className: string;
  ratio: number;
  valueNow: number;
  valueMax: number;
  valueText: string;
  step: (big: boolean) => number;
  onChange: (ratio: number) => void;
}) {
  const track = usePointerTrack((x) => onChange(x));
  const onKeyDown = (event: KeyboardEvent) => {
    const delta = step(event.shiftKey);
    let next = ratio;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = Math.max(0, ratio - delta);
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") next = Math.min(1, ratio + delta);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 1;
    else return;
    event.preventDefault();
    onChange(next);
  };
  return (
    <div
      {...track}
      className={`${classes.strip} ${className}`}
      style={{ "--at": `${ratio * 100}%` } as CSSProperties}
      tabIndex={0}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={valueMax}
      aria-valuenow={valueNow}
      aria-valuetext={valueText}
      onKeyDown={onKeyDown}
    >
      <span className={classes.thumb} />
    </div>
  );
}
