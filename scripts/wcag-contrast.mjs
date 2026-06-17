#!/usr/bin/env node
// WCAG 2.1 contrast checker for the Logjam theme schemes.
// Verifies every *rendered* foreground/background pair (mapped to real CSS usage in
// shared.module.css / index.css) meets AA: text >= 4.5:1, large-text/UI >= 3:1.
//
// Usage:
//   node scripts/wcag-contrast.mjs            # check committed shared/src/themeSchemes.ts
//   node scripts/wcag-contrast.mjs --failures # only print failing pairs
//
// Token hexes are parsed live from shared/src/themeSchemes.ts so this stays in sync
// with the source of truth as the palette is retuned.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const schemesPath = join(here, "..", "shared", "src", "themeSchemes.ts");

// ─── WCAG relative luminance + contrast ratio ───────────────────────────────
// https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html
function channel(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance(hex) {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
// Flatten an #RRGGBBAA foreground over an opaque background, then measure.
function parseHex(hex) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  };
}
function flatten(fgHex, bgHex) {
  const fg = parseHex(fgHex);
  if (fg.a >= 1) return fgHex;
  const bg = parseHex(bgHex);
  const mix = (f, b) => Math.round(f * fg.a + b * (1 - fg.a));
  const toHex = (n) => n.toString(16).padStart(2, "0");
  return `#${toHex(mix(fg.r, bg.r))}${toHex(mix(fg.g, bg.g))}${toHex(mix(fg.b, bg.b))}`;
}
function ratio(fgHex, bgHex) {
  const l1 = luminance(flatten(fgHex, bgHex));
  const l2 = luminance(bgHex);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// ─── Parse THEME_SCHEMES tokens from the TS source ──────────────────────────
function parseSchemes(src) {
  const schemes = {};
  // Match each `id: "...", name: "...", ... tokens: { ... }` block loosely by id + token body.
  const idRe = /(\w+):\s*\{\s*id:\s*"(\w+)",[\s\S]*?tokens:\s*\{([\s\S]*?)\}\s*,?\s*\}/g;
  let m;
  while ((m = idRe.exec(src))) {
    const key = m[2];
    const body = m[3];
    const tokens = {};
    const tokRe = /(\w+):\s*"(#[0-9A-Fa-f]+)"/g;
    let t;
    while ((t = tokRe.exec(body))) tokens[t[1]] = t[2];
    schemes[key] = tokens;
  }
  return schemes;
}

// Hardcoded markers (live in index.css / Map.tsx, not the schemes file).
const OWNED_MARKER = "#F97316";
const SHARED_MARKER = "#629BF8";

// ─── Rendered pairs → actual CSS usage. `min` is the WCAG threshold. ────────
// Filled-accent buttons use the scheme's dark `primary` as their label colour
// (.btnFilledAccent / MUI primary.contrastText), so the label pair is primary-on-accent.
function pairsFor(t) {
  const onAccent = t.primary;
  return [
    // text on backgrounds
    { name: "textPrimary on primary (body text)", fg: t.textPrimary, bg: t.primary, min: 4.5 },
    { name: "textPrimary on secondary (filled-neutral btn, search dropdown, cards)", fg: t.textPrimary, bg: t.secondary, min: 4.5 },
    { name: "textMuted on primary (captions/labels)", fg: t.textMuted, bg: t.primary, min: 4.5 },
    { name: "textMuted on secondary (captions on cards)", fg: t.textMuted, bg: t.secondary, min: 4.5 },
    // accent usages
    { name: "accent text on primary (outline-accent btn, links)", fg: t.accent, bg: t.primary, min: 4.5 },
    { name: "accent border on primary (input/outline border, UI)", fg: t.accent, bg: t.primary, min: 3 },
    { name: "onAccent on accent (filled-accent btn label)", fg: onAccent, bg: t.accent, min: 4.5 },
    // warning usages
    { name: "warning text on primary (outline-warning btn)", fg: t.warning, bg: t.primary, min: 4.5 },
    // bonus usages (bonus1 = outline-bonus1 btn text)
    { name: "bonus1 text on primary (outline-bonus1 btn)", fg: t.bonus1, bg: t.primary, min: 4.5 },
    // map markers (non-text UI, 1.4.11)
    { name: "owned-canyon marker on primary (UI)", fg: OWNED_MARKER, bg: t.primary, min: 3 },
    { name: "shared-canyon marker on primary (UI)", fg: SHARED_MARKER, bg: t.primary, min: 3 },
  ];
}

// ─── Run ────────────────────────────────────────────────────────────────────
const src = readFileSync(schemesPath, "utf8");
const schemes = parseSchemes(src);
const failuresOnly = process.argv.includes("--failures");

let totalFail = 0;
for (const [id, tokens] of Object.entries(schemes)) {
  const rows = pairsFor(tokens).map((p) => {
    const r = ratio(p.fg, p.bg);
    return { ...p, ratio: r, pass: r >= p.min };
  });
  const fails = rows.filter((r) => !r.pass);
  totalFail += fails.length;
  if (failuresOnly && fails.length === 0) continue;
  console.log(`\n=== ${id} ${fails.length ? `(${fails.length} FAIL)` : "(all pass)"} ===`);
  for (const r of failuresOnly ? fails : rows) {
    const tag = r.pass ? "PASS" : "FAIL";
    console.log(
      `  [${tag}] ${r.ratio.toFixed(2)}:1 (need ${r.min}) ${r.fg}→${r.bg}  ${r.name}`,
    );
  }
}
console.log(`\n${totalFail === 0 ? "✓ ALL PASS" : `✗ ${totalFail} failing pair(s)`}`);
process.exit(totalFail === 0 ? 0 : 1);
