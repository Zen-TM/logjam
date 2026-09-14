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
const placeTypesPath = join(here, "..", "shared", "src", "placeTypes.ts");
const designTokensPath = join(here, "..", "shared", "src", "designTokens.ts");

// Parsed out of the TypeScript source rather than imported: this script runs on
// bare node with no build step, exactly as the scheme parsing below does.
function parsePaletteColors() {
  const src = readFileSync(placeTypesPath, "utf8");
  const block = /export const PLACE_TYPE_COLORS = \[([\s\S]*?)\] as const;/.exec(src);
  if (!block) throw new Error("PLACE_TYPE_COLORS not found in placeTypes.ts");
  const colors = [...block[1].matchAll(/"(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1]);
  if (colors.length === 0) throw new Error("PLACE_TYPE_COLORS parsed empty");
  return colors;
}

// The scheme-independent tokens (`INK`, `ASSET_HUES`, `PLACE_STATUS_HUES`),
// parsed the same way so a retuned hue is measured the moment it changes.
function parseDesignTokens() {
  const src = readFileSync(designTokensPath, "utf8");
  const ink = /export const INK = "(#[0-9A-Fa-f]{6})";/.exec(src);
  if (!ink) throw new Error("INK not found in designTokens.ts");
  const hues = (name) => {
    const block = new RegExp(`export const ${name} = \\{([\\s\\S]*?)\\} as const;`).exec(src);
    if (!block) throw new Error(`${name} not found in designTokens.ts`);
    const entries = [...block[1].matchAll(/(\w+):\s*"(#[0-9A-Fa-f]{6})"/g)].map((m) => [m[1], m[2]]);
    if (entries.length === 0) throw new Error(`${name} parsed empty`);
    return entries;
  };
  return { ink: ink[1], assetHues: hues("ASSET_HUES"), statusHues: hues("PLACE_STATUS_HUES") };
}

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
/** `color` at `alpha` laid over the opaque `over` — a CSS color-mix tint. */
function tint(color, alpha, over) {
  const alphaHex = Math.round(alpha * 255).toString(16).padStart(2, "0");
  return flatten(`${color}${alphaHex}`, over);
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
// Read from the shared declaration rather than restated: these two ARE palette
// entries, and a copy here would be the list that drifts.
const PLACE_TYPE_COLORS = parsePaletteColors();
const OWNED_MARKER = PLACE_TYPE_COLORS[0];
// Read from the declaration, not restated: it is reserved precisely so it is
// never a type colour, and a copy here is the half that would drift.
const SHARED_MARKER = parseSharedPlaceColor();
const { ink: INK, assetHues: ASSET_HUES, statusHues: STATUS_HUES } = parseDesignTokens();
// Every hue that fills a chip, tile or badge with a label on it.
const LABELLED_FILLS = [
  ...PLACE_TYPE_COLORS.map((color) => [`place-type ${color}`, color]),
  ["shared heath", SHARED_MARKER],
  ...ASSET_HUES.map(([name, color]) => [`asset hue ${name}`, color]),
  ...STATUS_HUES.map(([name, color]) => [`status hue ${name}`, color]),
];

/** Logjam GPS `Row` tile: hue glyph on `withAlpha(hue, 0.16)` over the card. */
function worstTilePair(t) {
  const pairs = [["done", t.accent], ...STATUS_HUES, ...ASSET_HUES].map(([name, color]) => ({
    hue: name,
    fg: color,
    bg: tint(color, 0.16, t.secondary),
  }));
  const worst = pairs.reduce((a, b) => (ratio(a.fg, a.bg) <= ratio(b.fg, b.bg) ? a : b));
  return { name: "hue glyph on its 16% wash over a card (Logjam GPS Row tile, worst hue)", fg: worst.fg, bg: worst.bg, min: 3 };
}

/**
 * Pairs that fail today and are KNOWN to, each with where it renders. They are
 * printed but do not fail the run — and a known failure that starts PASSING
 * does fail it, so this list can only shrink: fix the pair, delete its line.
 * Adding to it is a decision to ship an inaccessible pair, and needs saying.
 */
const KNOWN_FAILURES = new Map([
  // Logjam GPS HeroHeader fills with bonus2 (found 2026-09-13). Fails in
  // Sandstone (muted 3.94:1) and Ironbark (bonus2 is a LIGHT green there).
  ["textPrimary on bonus2 (Logjam GPS hero fill)", "mobile/src/ui/HeroHeader.tsx"],
  ["textMuted on bonus2 (Logjam GPS hero fill)", "mobile/src/ui/HeroHeader.tsx"],
  // Found 2026-09-13 building the web kit, which fills its tiles instead.
  ["hue glyph on its 16% wash over a card (Logjam GPS Row tile, worst hue)", "mobile/src/ui/Row.tsx"],
]);

// ─── Rendered pairs → actual CSS usage. `min` is the WCAG threshold. ────────
// Filled-accent buttons use the scheme's dark `primary` as their label colour
// (.btnFilledAccent / MUI primary.contrastText), so the label pair is primary-on-accent.
/** The one hue reserved for "shared", read from the same declaration. */
function parseSharedPlaceColor() {
  const src = readFileSync(placeTypesPath, "utf8");
  const match = /export const SHARED_PLACE_COLOR = "(#[0-9A-Fa-f]{6})";/.exec(src);
  if (!match) throw new Error("SHARED_PLACE_COLOR not found in placeTypes.ts");
  return match[1];
}

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
    { name: "owned-place marker on primary (UI)", fg: OWNED_MARKER, bg: t.primary, min: 3 },
    { name: "shared-place marker on primary (UI)", fg: SHARED_MARKER, bg: t.primary, min: 3 },
    // A PLACE TYPE'S COLOUR IS A MARKER COLOUR, so every entry of the curated
    // palette has to clear the same bar under every scheme. This is why the
    // palette is curated at all: a free hex picker would not fail this check,
    // it would delete it — there would be nothing fixed left to assert.
    ...PLACE_TYPE_COLORS.map((color) => ({
      name: `place-type palette ${color} on primary (UI)`,
      fg: color,
      bg: t.primary,
      min: 3,
    })),
    // AND THE CHIP, which is a TEXT pair and therefore a different bar.
    // A type's colour FILLS its chip on the Places rail and in the create
    // form, with the scheme's dark `primary` as the label — the same shape as
    // a filled-accent button. Checking only the marker pair above and reading
    // it as proof the chip was legible is the "guard whose two sides share one
    // assumption" failure: it passed while ten of twelve colours failed AA on
    // the label. This is the pair the user actually reads.
    ...PLACE_TYPE_COLORS.map((color) => ({
      name: `place-type chip label on ${color} (text)`,
      fg: onAccent,
      bg: color,
      min: 4.5,
    })),
    // THE INK. Every label or glyph drawn on a fill — an active chip, a filled
    // button, a hue tile — uses the one fixed dark ink on both clients, because
    // `primary` fails on the heath and on the GeoPDF clay.
    { name: "ink on accent (filled button / active chip label)", fg: INK, bg: t.accent, min: 4.5 },
    ...LABELLED_FILLS.map(([label, color]) => ({
      name: `ink label on ${label} ${color} (text)`,
      fg: INK,
      bg: color,
      min: 4.5,
    })),
    // A hue as a GLYPH on the page colour (a row's type/status tile, a legend
    // swatch): non-text, so 3:1.
    ...[...ASSET_HUES, ...STATUS_HUES].map(([name, color]) => ({
      name: `${name} hue glyph on primary (UI)`,
      fg: color,
      bg: t.primary,
      min: 3,
    })),
    // ── Logjam Web kit (frontend/src/ui) ──
    { name: "ink on textPrimary (toast, tooltip)", fg: INK, bg: t.textPrimary, min: 4.5 },
    { name: "ink on warning (nav badge)", fg: INK, bg: t.warning, min: 4.5 },
    {
      name: "textPrimary on accent-tinted strip (filters-active strip)",
      fg: t.textPrimary,
      bg: tint(t.accent, 0.12, t.primary),
      min: 4.5,
    },
    { name: "accent edge on secondary (selected row, toggle on a card)", fg: t.accent, bg: t.secondary, min: 3 },
    {
      name: "accent glyph on its own tint (filled icon button)",
      fg: t.accent,
      bg: tint(t.accent, 0.16, t.primary),
      min: 3,
    },
    // StatusPill: `accent` is ink on accent, `outline` and `muted` are textMuted,
    // and a `warning` label is textPrimary, all measured above. Warning as TEXT
    // on a card failed (3.8:1, Basalt), so it is the pill's edge and glyph.
    { name: "warning edge and glyph on secondary (warning StatusPill on a card)", fg: t.warning, bg: t.secondary, min: 3 },
    // ProgressBar: the fill against its track, a wash of the text colour.
    { name: "accent fill on its track (ProgressBar)", fg: t.accent, bg: tint(t.textPrimary, 0.12, t.primary), min: 3 },
    { name: "warning fill on its track (failed ProgressBar)", fg: t.warning, bg: tint(t.textPrimary, 0.12, t.primary), min: 3 },
    // A web row's identity tile is a solid hue with an ink glyph — covered by
    // the ink-on-fill pairs above. Logjam GPS's tile is the hue glyph on a 16%
    // wash of itself on a card; measured at its worst hue, because it fails for
    // several and one line per hue would bury the rest of the report.
    worstTilePair(t),
    // A chip's leading glyph, inactive: the hue on the chip's card colour.
    ...[...PLACE_TYPE_COLORS.map((color) => [`place-type ${color}`, color]), ...STATUS_HUES].map(
      ([name, color]) => ({ name: `${name} chip glyph on secondary (UI)`, fg: color, bg: t.secondary, min: 3 }),
    ),
    { name: "textPrimary on bonus2 (Logjam GPS hero fill)", fg: t.textPrimary, bg: t.bonus2, min: 4.5 },
    { name: "textMuted on bonus2 (Logjam GPS hero fill)", fg: t.textMuted, bg: t.bonus2, min: 4.5 },
  ];
}

// ─── Run ────────────────────────────────────────────────────────────────────
const src = readFileSync(schemesPath, "utf8");
const schemes = parseSchemes(src);
const failuresOnly = process.argv.includes("--failures");

let totalFail = 0;
const knownPassing = new Set();
const knownFailing = new Set();
for (const [id, tokens] of Object.entries(schemes)) {
  const rows = pairsFor(tokens).map((p) => {
    const r = ratio(p.fg, p.bg);
    return { ...p, ratio: r, pass: r >= p.min, known: KNOWN_FAILURES.has(p.name) };
  });
  const fails = rows.filter((r) => !r.pass && !r.known);
  totalFail += fails.length;
  for (const r of rows) if (r.pass && r.known) knownPassing.add(r.name);
  for (const r of rows) if (!r.pass && r.known) knownFailing.add(r.name);
  if (failuresOnly && fails.length === 0) continue;
  console.log(`\n=== ${id} ${fails.length ? `(${fails.length} FAIL)` : "(all pass)"} ===`);
  for (const r of failuresOnly ? rows.filter((row) => !row.pass) : rows) {
    const tag = r.pass ? "PASS" : r.known ? "KNOWN" : "FAIL";
    console.log(
      `  [${tag}] ${r.ratio.toFixed(2)}:1 (need ${r.min}) ${r.fg}→${r.bg}  ${r.name}`,
    );
  }
}
// A known failure passes only once it passes under EVERY scheme.
const fixedKnown = [...KNOWN_FAILURES.keys()].filter(
  (name) => knownPassing.has(name) && !knownFailing.has(name),
);
for (const name of fixedKnown) {
  console.log(`\n✗ "${name}" now passes in every scheme — delete it from KNOWN_FAILURES.`);
}
const knownStill = [...knownFailing].map((name) => `${name} (${KNOWN_FAILURES.get(name)})`);
if (knownStill.length) console.log(`\n! ${knownStill.length} known failing pair(s): ${knownStill.join("; ")}`);
const ok = totalFail === 0 && fixedKnown.length === 0;
console.log(`\n${ok ? "✓ ALL PASS" : `✗ ${totalFail} failing pair(s)`}`);
process.exit(ok ? 0 : 1);
