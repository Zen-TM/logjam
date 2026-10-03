#!/usr/bin/env node
// WCAG 2.1 contrast checker for the Logjam theme schemes.
// Verifies every *rendered* foreground/background pair, named by its colour
// roles (`ThemeTokens`) and measured on the surface it renders on, under every
// scheme: text >= 4.5:1 (7:1 in a light scheme, which exists for full sun),
// muted text >= 4.5:1, an edge, glyph or fill a user must see >= 3:1.
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
const friendSearchPath = join(here, "..", "shared", "src", "friendSearch.ts");

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

// The six hues a friend's avatar is drawn in. Shared, so one client cannot
// retune them alone — and measured here because the web avatar is a solid fill
// with the ink initials on it, the same tile every other web row wears.
function parseFriendAvatarHues() {
  const src = readFileSync(friendSearchPath, "utf8");
  const block = /export const FRIEND_AVATAR_HUES = \[([\s\S]*?)\] as const;/.exec(src);
  if (!block) throw new Error("FRIEND_AVATAR_HUES not found in friendSearch.ts");
  const colors = [...block[1].matchAll(/"(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1]);
  if (colors.length === 0) throw new Error("FRIEND_AVATAR_HUES parsed empty");
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
  return {
    ink: ink[1],
    assetHues: hues("ASSET_HUES"),
    statusHues: hues("PLACE_STATUS_HUES"),
    tripTypeHues: hues("TRIP_TYPE_OPEN_HUES"),
  };
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
// Each scheme is `<key>: { id: "...", ..., mode: "...", tokens: { role: "#hex" | INK, ... } }`.
function parseSchemes(src, ink) {
  const schemes = {};
  const idRe = /(\w+):\s*\{\s*id:\s*"(\w+)",[\s\S]*?mode:\s*"(dark|light)",\s*tokens:\s*\{([\s\S]*?)\}\s*,?\s*\}/g;
  let m;
  while ((m = idRe.exec(src))) {
    const tokens = {};
    for (const t of m[4].matchAll(/(\w+):\s*(?:"(#[0-9A-Fa-f]{6})"|(INK))/g)) {
      tokens[t[1]] = t[2] ?? ink;
    }
    schemes[m[2]] = { mode: m[3], tokens };
  }
  if (Object.keys(schemes).length === 0) throw new Error("no schemes parsed from themeSchemes.ts");
  return schemes;
}

const PLACE_TYPE_COLORS = parsePaletteColors();
// Read from the declaration, not restated: it is reserved precisely so it is
// never a type colour, and a copy here is the half that would drift.
const SHARED_MARKER = parseSharedPlaceColor();
const FRIEND_AVATAR_HUES = parseFriendAvatarHues();
const { ink: INK, assetHues: ASSET_HUES, statusHues: STATUS_HUES, tripTypeHues: TRIP_TYPE_HUES } = parseDesignTokens();
// Every identity hue. An identity hue is only ever a FILL — a tile with an
// `onFill` glyph, an active chip with an `onFill` label, a swatch, a mark on
// the map — never a glyph, line or text on a theme surface, so the label on it
// is the only pair it has. Mid-light hues fail 3:1 as glyphs on a light page,
// and some did on dark cards (Logjam GPS's old wash tile).
const IDENTITY_FILLS = [
  ...PLACE_TYPE_COLORS.map((color) => [`place-type ${color}`, color]),
  ["shared heath", SHARED_MARKER],
  ...ASSET_HUES.map(([name, color]) => [`asset hue ${name}`, color]),
  ...STATUS_HUES.map(([name, color]) => [`status hue ${name}`, color]),
  // A user-typed trip type's tile and its active chip (tripTypeIdentity).
  ...TRIP_TYPE_HUES.map(([name, color]) => [`trip type hue ${name}`, color]),
  ...FRIEND_AVATAR_HUES.map((color) => [`friend avatar ${color}`, color]),
];

/**
 * Pairs that fail today and are KNOWN to, each with where it renders. They are
 * printed but do not fail the run — and a known failure that starts PASSING
 * does fail it, so this list can only shrink: fix the pair, delete its line.
 * Adding to it is a decision to ship an inaccessible pair, and needs saying.
 */
const KNOWN_FAILURES = new Map([]);

/** The one hue reserved for "shared", read from the same declaration. */
function parseSharedPlaceColor() {
  const src = readFileSync(placeTypesPath, "utf8");
  const match = /export const SHARED_PLACE_COLOR = "(#[0-9A-Fa-f]{6})";/.exec(src);
  if (!match) throw new Error("SHARED_PLACE_COLOR not found in placeTypes.ts");
  return match[1];
}

// ─── Rendered pairs, by role. `min` is the WCAG threshold. ──────────────────
function pairsFor({ mode, tokens: t }) {
  // A light scheme exists for full sun, where AA is not enough: its text
  // clears AAA. Muted text keeps the AA floor in every scheme.
  const textMin = mode === "light" ? 7 : 4.5;
  const surfaces = [
    ["page", t.page],
    ["card", t.card],
    ["cardPressed", t.cardPressed],
    ["field", t.field],
  ];
  return [
    // Words: only ever `text` or `textMuted`, on every surface they sit on.
    ...surfaces.map(([name, bg]) => ({ name: `text on ${name}`, fg: t.text, bg, min: textMin })),
    ...surfaces.map(([name, bg]) => ({ name: `textMuted on ${name}`, fg: t.textMuted, bg, min: 4.5 })),
    { name: "onInverse on inverse (toast, tooltip)", fg: t.onInverse, bg: t.inverse, min: textMin },
    // An edge that must be seen: a field's outline, an outline control.
    ...["page", "card", "field"].map((name) => ({
      name: `lineStrong on ${name} (field and outline-control edge)`,
      fg: t.lineStrong,
      bg: t[name],
      min: 3,
    })),
    // Intent colours are fills, edges and glyphs, never words: the `onFill`
    // label on each as a fill, and each as an edge or glyph on page and card.
    ...["accent", "warning", "success"].flatMap((intent) => [
      { name: `onFill on ${intent} (filled button, active chip, badge)`, fg: t.onFill, bg: t[intent], min: 4.5 },
      { name: `${intent} on page (edge, glyph)`, fg: t[intent], bg: t.page, min: 3 },
      { name: `${intent} on card (edge, glyph)`, fg: t[intent], bg: t.card, min: 3 },
    ]),
    // A thing with no kind wears `neutral` the way a kind wears its hue.
    { name: "onFill on neutral (untyped trip tile, Add tile)", fg: t.onFill, bg: t.neutral, min: 4.5 },
    ...IDENTITY_FILLS.map(([label, color]) => ({
      name: `onFill on ${label} (tile, active chip, avatar)`,
      fg: t.onFill,
      bg: color,
      min: 4.5,
    })),
    // ── Washes: a tint of a role laid over a surface ──
    // An "on" icon button wears the same wash with a `text` glyph: an accent
    // glyph on a wash of itself fell to 2.7:1 on the light page.
    {
      name: "text on accent wash over page (filters-active strip, active icon button)",
      fg: t.text,
      bg: tint(t.accent, 0.12, t.page),
      min: textMin,
    },
    // The sign-in success banner: the same idea over a CARD at 15%. A wash
    // does not carry the ratio the flat surface does, which is why this pair
    // exists separately (found 2026-09-19 by the a11y spec's sign-in case).
    {
      name: "text on accent wash over card (sign-in success banner)",
      fg: t.text,
      bg: tint(t.accent, 0.15, t.card),
      min: textMin,
    },
    // ProgressBar: the fill in its `field` track. A wash of the text colour
    // darkened the light page's track until the fill fell to 2.5:1.
    { name: "accent on field (ProgressBar fill in its track)", fg: t.accent, bg: t.field, min: 3 },
    { name: "warning on field (failed ProgressBar fill in its track)", fg: t.warning, bg: t.field, min: 3 },
  ];
}

// ─── Run ────────────────────────────────────────────────────────────────────
const src = readFileSync(schemesPath, "utf8");
const schemes = parseSchemes(src, INK);
const failuresOnly = process.argv.includes("--failures");

let totalFail = 0;
const knownPassing = new Set();
const knownFailing = new Set();
for (const [id, scheme] of Object.entries(schemes)) {
  const rows = pairsFor(scheme).map((p) => {
    const r = ratio(p.fg, p.bg);
    return { ...p, ratio: r, pass: r >= p.min, known: KNOWN_FAILURES.has(p.name) };
  });
  const fails = rows.filter((r) => !r.pass && !r.known);
  totalFail += fails.length;
  for (const r of rows) if (r.pass && r.known) knownPassing.add(r.name);
  for (const r of rows) if (!r.pass && r.known) knownFailing.add(r.name);
  if (failuresOnly && fails.length === 0) continue;
  console.log(`\n=== ${id} (${scheme.mode}) ${fails.length ? `(${fails.length} FAIL)` : "(all pass)"} ===`);
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
