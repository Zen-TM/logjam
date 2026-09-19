// Colour-space arithmetic for `ColourField`, out of the component so it is
// checked (DESIGN.md §9, "Pure decisions leave the component").
//
// The stored form is `#RRGGBBAA`: a topo's styles carry an opacity, so a colour
// here is four channels, not the three a native `<input type="color">` offers.

/** Hue 0–360, saturation and value 0–100, alpha 0–1. */
export type Hsva = { h: number; s: number; v: number; a: number };

const HEX_RGBA = /^#[0-9a-f]{8}$/i;

export function isHexRgba(value: string): boolean {
  return HEX_RGBA.test(value);
}

export function hexToHsva(hex: string): Hsva {
  if (!isHexRgba(hex)) throw new Error(`Not a #RRGGBBAA colour: ${hex}`);
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const a = parseInt(hex.slice(7, 9), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta) {
    h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max ? (delta / max) * 100 : 0, v: max * 100, a };
}

export function hsvaToHex({ h, s, v, a }: Hsva): string {
  const saturation = s / 100;
  const value = v / 100;
  const channel = (n: number) => {
    const k = (n + h / 60) % 6;
    return value - value * saturation * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const byte = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${byte(channel(5))}${byte(channel(3))}${byte(channel(1))}${byte(a)}`;
}
