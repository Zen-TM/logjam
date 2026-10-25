import type { ThemeTokens } from "./themeSchemes.js";

const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const rgb = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map(channel);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

/** WCAG 2.1 contrast ratio of two `#RRGGBB` colours. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** `hex` moved `t` of the way to `end` (0 or 255) in linear light, which
 *  keeps its hue and only shifts its luminance. */
function shifted(hex: string, end: 0 | 255, t: number): string {
  const to8 = (lin: number) =>
    Math.round(
      255 * (lin <= 0.0031308 ? lin * 12.92 : 1.055 * lin ** (1 / 2.4) - 0.055),
    );
  const e = channel(end);
  return `#${rgb(hex)
    .map((v) => to8(channel(v) * (1 - t) + e * t))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}

/**
 * What a selected chip is filled with: the hue, moved just far enough that it
 * stands 3:1 off the unselected chip (the scheme's `card`) beside it, WCAG
 * 1.4.11, since a chip shows it is selected by its fill alone. Away from the
 * card first (darker on a pale card, lighter on a dark one), the other way only
 * when that can't reach it; the hue itself when it already does. The label on
 * it stays `onFill` at 4.5:1: the luminance this stops at is above the ink's
 * floor, which the guard walks for every scheme and hue.
 *
 * A fill for a CHIP only: a tile, an avatar and a map mark keep the hue as it
 * is, since nothing is beside them to be told apart from. Guard:
 * `chipFill.test.ts`.
 */
export function chipFill(
  hue: string,
  tokens: Pick<ThemeTokens, "card" | "onFill">,
): string {
  const ok = (fill: string) =>
    contrastRatio(fill, tokens.card) >= 3 &&
    contrastRatio(tokens.onFill, fill) >= 4.5;
  // Only a plain hex can be measured; anything else is drawn as given.
  if (!/^#[0-9a-f]{6}$/i.test(hue) || ok(hue)) return hue;
  const ends: (0 | 255)[] =
    luminance(hue) >= luminance(tokens.card) ? [255, 0] : [0, 255];
  for (const end of ends) {
    for (let t = 0.01; t <= 1; t += 0.01) {
      const fill = shifted(hue, end, t);
      if (ok(fill)) return fill;
    }
  }
  return hue;
}
