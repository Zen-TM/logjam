import { useEffect, useRef, useState } from "react";
import { HexAlphaColorPicker } from "react-colorful";
import { Popover, Box } from "@mui/material";
import styles from "./ColourPicker.module.css";

interface ColourPickerProps {
  value: string;            // #RRGGBBAA
  onChange: (next: string) => void;
  ariaLabel?: string;
}

/**
 * RGBA hex colour picker. The button shows a swatch of the current colour
 * (checkerboard background under the swatch reveals translucency); clicking
 * opens a popover with a HexAlphaColorPicker from react-colorful. The
 * underlying value is always `#RRGGBBAA`.
 */
export default function ColourPicker({ value, onChange, ariaLabel }: ColourPickerProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => { setDraft(value); }, [value]);

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
          <HexAlphaColorPicker
            color={draft}
            onChange={(next) => {
              setDraft(next);
              onChange(next);
            }}
          />
          <input
            type="text"
            className={styles.hexInput}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              // Commit only when valid #RRGGBBAA — otherwise revert to current.
              if (/^#[0-9a-fA-F]{8}$/.test(draft)) {
                onChange(draft);
              } else {
                setDraft(value);
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
