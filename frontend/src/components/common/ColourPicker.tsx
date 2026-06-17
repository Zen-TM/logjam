import { useCallback, useEffect, useRef, useState } from "react";
import { Popover, Box } from "@mui/material";
import styles from "./ColourPicker.module.css";

interface ColourPickerProps {
  value: string; // #RRGGBBAA
  onChange: (next: string) => void;
  ariaLabel?: string;
}

interface Hsva {
  h: number; // 0–360
  s: number; // 0–100
  v: number; // 0–100
  a: number; // 0–1
}

function hexToHsva(hex: string): Hsva {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const a = parseInt(hex.slice(7, 9), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const v = max, s = max ? d / max : 0;
  let h = 0;
  if (d) {
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = ((h * 60) + 360) % 360;
  }
  return { h, s: s * 100, v: v * 100, a };
}

function hsvaToHex({ h, s, v, a }: Hsva): string {
  s /= 100; v /= 100;
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const toB = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${toB(f(5))}${toB(f(3))}${toB(f(1))}${toB(a)}`;
}

// Uses setPointerCapture so events route to the element regardless of where the
// pointer moves — eliminates the buttons-check race in react-colorful.
function usePanelDrag(onMove: (x: number, y: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const onMoveCb = useRef(onMove);
  onMoveCb.current = onMove;

  const compute = useCallback((e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    onMoveCb.current(x, y);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    ref.current!.setPointerCapture(e.pointerId);
    compute(e);
  }, [compute]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!ref.current!.hasPointerCapture(e.pointerId)) return;
    compute(e);
  }, [compute]);

  return { ref, onPointerDown, onPointerMove };
}

function useSliderDrag(onMove: (pct: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const onMoveCb = useRef(onMove);
  onMoveCb.current = onMove;

  const compute = useCallback((e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    onMoveCb.current(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    ref.current!.setPointerCapture(e.pointerId);
    compute(e);
  }, [compute]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!ref.current!.hasPointerCapture(e.pointerId)) return;
    compute(e);
  }, [compute]);

  return { ref, onPointerDown, onPointerMove };
}

function SatBrightPanel({ hsva, onChange }: { hsva: Hsva; onChange: (s: number, v: number) => void }) {
  const { ref, onPointerDown, onPointerMove } = usePanelDrag(
    (x, y) => onChange(x * 100, (1 - y) * 100),
  );
  function onKeyDown(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 10 : 1;
    let { s, v } = hsva;
    switch (e.key) {
      case "ArrowLeft": s = Math.max(0, s - step); break;
      case "ArrowRight": s = Math.min(100, s + step); break;
      case "ArrowUp": v = Math.min(100, v + step); break;
      case "ArrowDown": v = Math.max(0, v - step); break;
      default: return;
    }
    e.preventDefault();
    onChange(s, v);
  }
  return (
    <div
      ref={ref}
      className={styles.satPanel}
      style={{ backgroundColor: `hsl(${hsva.h}, 100%, 50%)` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="slider"
      aria-label="Saturation and brightness"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(hsva.s)}
      aria-valuetext={`Saturation ${Math.round(hsva.s)}%, brightness ${Math.round(hsva.v)}%`}
    >
      <div className={styles.satPanelGradients} />
      <div
        className={styles.pickerThumb}
        style={{ left: `${hsva.s}%`, top: `${100 - hsva.v}%` }}
      />
    </div>
  );
}

function HueSlider({ h, onChange }: { h: number; onChange: (h: number) => void }) {
  const { ref, onPointerDown, onPointerMove } = useSliderDrag((pct) => onChange(pct * 360));
  function onKeyDown(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 15 : 1;
    let next = h;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowDown": next = (h - step + 360) % 360; break;
      case "ArrowRight":
      case "ArrowUp": next = (h + step) % 360; break;
      case "Home": next = 0; break;
      case "End": next = 360; break;
      default: return;
    }
    e.preventDefault();
    onChange(next);
  }
  return (
    <div
      ref={ref}
      className={styles.hueSlider}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="slider"
      aria-label="Hue"
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={Math.round(h)}
      aria-valuetext={`${Math.round(h)} degrees`}
    >
      <div className={styles.pickerThumb} style={{ left: `${(h / 360) * 100}%`, top: "50%" }} />
    </div>
  );
}

function AlphaSlider({ hsva, onChange }: { hsva: Hsva; onChange: (a: number) => void }) {
  const { ref, onPointerDown, onPointerMove } = useSliderDrag((pct) => onChange(pct));
  const solidColor = hsvaToHex({ ...hsva, a: 1 }).slice(0, 7); // #RRGGBB, no alpha
  function onKeyDown(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 0.1 : 0.01;
    let next = hsva.a;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowDown": next = Math.max(0, hsva.a - step); break;
      case "ArrowRight":
      case "ArrowUp": next = Math.min(1, hsva.a + step); break;
      case "Home": next = 0; break;
      case "End": next = 1; break;
      default: return;
    }
    e.preventDefault();
    onChange(next);
  }
  return (
    <div
      ref={ref}
      className={styles.alphaSlider}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="slider"
      aria-label="Opacity"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(hsva.a * 100)}
      aria-valuetext={`${Math.round(hsva.a * 100)}%`}
    >
      <div
        className={styles.alphaGradient}
        style={{ background: `linear-gradient(to right, transparent, ${solidColor})` }}
      />
      <div className={styles.pickerThumb} style={{ left: `${hsva.a * 100}%`, top: "50%" }} />
    </div>
  );
}

export default function ColourPicker({ value, onChange, ariaLabel }: ColourPickerProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [hsva, setHsva] = useState<Hsva>(() => hexToHsva(value));
  const [hexDraft, setHexDraft] = useState(value);
  // Tracks the last hex we emitted or received, so the prop-sync effect
  // does not overwrite in-flight drag state with a round-tripped value.
  const committed = useRef(value);

  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value;
      setHsva(hexToHsva(value));
      setHexDraft(value);
    }
  }, [value]);

  function handlePickerChange(next: Hsva) {
    const hex = hsvaToHex(next);
    committed.current = hex;
    setHsva(next);
    setHexDraft(hex);
    onChange(hex);
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={styles.swatchButton}
        onClick={() => setOpen(true)}
        aria-label={ariaLabel ?? "Edit colour"}
      >
        <span className={styles.checkerboard} />
        <span className={styles.swatch} style={{ background: value }} />
      </button>
      <Popover
        open={open}
        anchorEl={buttonRef.current}
        onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{ paper: { className: styles.popover } }}
      >
        <Box className={styles.pickerWrap}>
          <SatBrightPanel
            hsva={hsva}
            onChange={(s, v) => handlePickerChange({ ...hsva, s, v })}
          />
          <HueSlider h={hsva.h} onChange={(h) => handlePickerChange({ ...hsva, h })} />
          <AlphaSlider hsva={hsva} onChange={(a) => handlePickerChange({ ...hsva, a })} />
          <input
            type="text"
            aria-label="Hex colour value (#RRGGBBAA)"
            className={styles.hexInput}
            value={hexDraft}
            onChange={(e) => setHexDraft(e.target.value)}
            onBlur={() => {
              if (/^#[0-9a-fA-F]{8}$/.test(hexDraft)) {
                committed.current = hexDraft;
                setHsva(hexToHsva(hexDraft));
                onChange(hexDraft);
              } else {
                setHexDraft(value);
              }
            }}
            spellCheck={false}
            maxLength={9}
          />
        </Box>
      </Popover>
    </>
  );
}
