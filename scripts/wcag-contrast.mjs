#!/usr/bin/env node
// WCAG 2.1 contrast checker for the Logjam theme schemes.
// Verifies every *rendered* foreground/background pair, named by its colour
// roles (`ThemeTokens`) and measured on the surface it renders on, under every
// scheme: text and muted text >= 4.5:1 (7:1 in a light scheme, which exists
// for full sun); a label on a fill >= 4.5:1; an edge, glyph or fill a user must
// see >= 3:1; a surface told from the one under it (separation) by its fill or edge.
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

// The scheme-independent tokens (`INK`, `ASSET_HUES`, `PLACE_STATUS_HUES`,
// `MEDAL_HUES`), parsed the same way so a retuned hue is measured the moment
// it changes.
function parseDesignTokens() {
  const src = readFileSync(designTokensPath, "utf8");
  const ink = /export const INK = "(#[0-9A-Fa-f]{6})";/.exec(src);
  if (!ink) throw new Error("INK not found in designTokens.ts");
  const onScrim = /export const ON_SCRIM = "(#[0-9A-Fa-f]{6})";/.exec(src);
  if (!onScrim) throw new Error("ON_SCRIM not found in designTokens.ts");
  const scrimHeavy = /export const SCRIM = \{[\s\S]*?heavy: "rgba\(0,0,0,([0-9.]+)\)"/.exec(src);
  if (!scrimHeavy) throw new Error("SCRIM.heavy not found in designTokens.ts");
  const mapInk = (role) => {
    const m = new RegExp(`export const MAP_INK = \\{[\\s\\S]*?${role}: "(#[0-9A-Fa-f]{6})"`).exec(src);
    if (!m) throw new Error(`MAP_INK.${role} not found in designTokens.ts`);
    return m[1];
  };
  const hues = (name) => {
    const block = new RegExp(`export const ${name} = \\{([\\s\\S]*?)\\} as const;`).exec(src);
    if (!block) throw new Error(`${name} not found in designTokens.ts`);
    const entries = [...block[1].matchAll(/(\w+):\s*"(#[0-9A-Fa-f]{6})"/g)].map((m) => [m[1], m[2]]);
    if (entries.length === 0) throw new Error(`${name} parsed empty`);
    return entries;
  };
  return {
    ink: ink[1],
    onScrim: onScrim[1],
    scrimHeavyAlpha: Number(scrimHeavy[1]),
    mapCasing: mapInk("casing"),
    mapRing: mapInk("ring"),
    assetHues: hues("ASSET_HUES"),
    statusHues: hues("PLACE_STATUS_HUES"),
    medalHues: hues("MEDAL_HUES"),
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
const { ink: INK, onScrim: ON_SCRIM, scrimHeavyAlpha: SCRIM_HEAVY_ALPHA, mapCasing: MAP_CASING, mapRing: MAP_RING, assetHues: ASSET_HUES, statusHues: STATUS_HUES, medalHues: MEDAL_HUES, tripTypeHues: TRIP_TYPE_HUES } = parseDesignTokens();
// Every identity hue. An identity hue is only ever a FILL — a tile with an
// `onFill` glyph, an active chip with an `onFill` label, a swatch, a mark on
// the map — never a glyph, line or text on a theme surface, so the label on it
// is the only pair it has. Mid-light hues fail 3:1 as glyphs on a light page
// and on dark cards.
const IDENTITY_FILLS = [
  ...PLACE_TYPE_COLORS.map((color) => [`place-type ${color}`, color]),
  ["shared heath", SHARED_MARKER],
  ...ASSET_HUES.map(([name, color]) => [`asset hue ${name}`, color]),
  ...STATUS_HUES.map(([name, color]) => [`status hue ${name}`, color]),
  // A leaderboard medal's tile (LeaderboardPage, LeaderboardScreen).
  ...MEDAL_HUES.map(([name, color]) => [`medal hue ${name}`, color]),
  // A user-typed trip type's tile and its active chip (tripTypeIdentity).
  ...TRIP_TYPE_HUES.map(([name, color]) => [`trip type hue ${name}`, color]),
  ...FRIEND_AVATAR_HUES.map((color) => [`friend avatar ${color}`, color]),
];

/**
 * Pairs that fail today and are KNOWN to, keyed by scheme and pair
 * (`"ghostGum: textMuted on page"`), so a pair excused in one scheme is still
 * held in the others. Each carries the ratio it has today as a floor: a known
 * failure that falls below it fails the run, and one that starts PASSING does
 * too, so this list can only shrink: fix the pair, delete its line. Adding to
 * it is a decision to ship an inaccessible pair, and needs saying.
 */
const KNOWN_FAILURES = new Map([
  ["sandstone: line on page (separation: a card's edge)", { floor: 1.43, why: "its line is under 1.5:1 on the page" }],
  ["basalt: line on page (separation: a card's edge)", { floor: 1.47, why: "its line is under 1.5:1 on the page" }],
  ["scribblyGum: line on page (separation: a card's edge)", { floor: 1.25, why: "its line is under 1.5:1 on the page" }],
  ["ghostGum: line on page (separation: a card's edge)", { floor: 1.22, why: "its line is under 1.5:1 on the page" }],
  ["ghostGum: textMuted on page", { floor: 6.62, why: "its muted text is under 7:1" }],
  ["ghostGum: textMuted on cardPressed", { floor: 6.0, why: "its muted text is under 7:1" }],
]);

// Reference basemap grounds a point mark is drawn on, not tokens: the OSM Topo
// land colour and the satellite imagery's mid green.
const MAP_GROUNDS = { lightLand: "#F2EFE9", satellite: "#3D4A35" };

/** The one hue reserved for "shared", read from the same declaration. */
function parseSharedPlaceColor() {
  const src = readFileSync(placeTypesPath, "utf8");
  const match = /export const SHARED_PLACE_COLOR = "(#[0-9A-Fa-f]{6})";/.exec(src);
  if (!match) throw new Error("SHARED_PLACE_COLOR not found in placeTypes.ts");
  return match[1];
}

// ─── Rendered pairs, by role. `min` is the WCAG threshold. ──────────────────
function pairsFor({ mode, tokens: t }) {
  // A light scheme exists for full sun, where AA is not enough: its text and
  // muted text clear AAA. A label on a fill keeps the AA floor in every scheme.
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
    ...surfaces.map(([name, bg]) => ({ name: `textMuted on ${name}`, fg: t.textMuted, bg, min: textMin })),
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
    // Words on a scrim (a picker's hint, a pending-upload badge) are white in
    // every scheme; the worst ground under the veil is a white map.
    {
      name: "ON_SCRIM on scrim.heavy over a white map (picker hint, badge text)",
      fg: ON_SCRIM,
      bg: tint("#000000", SCRIM_HEAVY_ALPHA, "#FFFFFF"),
      min: 4.5,
    },
    // ── Washes: a tint of a role laid over a surface ──
    // An "on" icon button wears the same wash with a `text` glyph: an accent
    // glyph on a wash of itself falls to 2.7:1 on the light page.
    {
      name: "text on accent wash over page (active icon button)",
      fg: t.text,
      bg: tint(t.accent, 0.12, t.page),
      min: textMin,
    },
    // The sign-in success banner: the same idea over a CARD at 15%. A wash
    // does not carry the ratio the flat surface does, which is why this pair
    // exists separately.
    {
      name: "text on accent wash over card (sign-in success banner)",
      fg: t.text,
      bg: tint(t.accent, 0.15, t.card),
      min: textMin,
    },
    // ProgressBar: the fill in its `field` track. A wash of the text colour
    // darkens the light page's track until the fill falls to 2.5:1.
    { name: "accent on field (ProgressBar fill in its track)", fg: t.accent, bg: t.field, min: 3 },
    { name: "warning on field (failed ProgressBar fill in its track)", fg: t.warning, bg: t.field, min: 3 },
    // ── Separation: a surface told from the one under it (shared/DESIGN.md §1) ──
    // The light scheme's card fill cannot separate further from its page
    // without breaking its 3:1 intent pairs (accent, warning and success sit
    // in a narrow luminance band), so its edge carries the separation.
    { name: "card on page (separation: a pressable fill)", fg: t.card, bg: t.page, min: mode === "light" ? 1.1 : 1.2 },
    { name: "line on page (separation: a card's edge)", fg: t.line, bg: t.page, min: 1.5 },
    { name: "cardPressed on card (separation: press feedback)", fg: t.cardPressed, bg: t.card, min: 1.2 },
    // ── The map: a point mark's edge against the basemaps it sits on ──
    { name: "MAP_INK.casing on light land (point-mark edge)", fg: MAP_CASING, bg: MAP_GROUNDS.lightLand, min: 3 },
    { name: "MAP_INK.ring on satellite (point-mark halo)", fg: MAP_RING, bg: MAP_GROUNDS.satellite, min: 3 },
  ];
}

// ─── Run ────────────────────────────────────────────────────────────────────
const src = readFileSync(schemesPath, "utf8");
const schemes = parseSchemes(src, INK);
const failuresOnly = process.argv.includes("--failures");

let totalFail = 0;
const seenKnown = new Set();
const fixedKnown = [];
for (const [id, scheme] of Object.entries(schemes)) {
  const rows = pairsFor(scheme).map((p) => {
    const r = ratio(p.fg, p.bg);
    const key = `${id}: ${p.name}`;
    const known = KNOWN_FAILURES.get(key);
    if (known) seenKnown.add(key);
    if (known && r >= p.min) fixedKnown.push(key);
    // A known failure may not get worse than it is today.
    const regressed = known && !(r >= p.min) && r < known.floor - 0.005;
    return { ...p, ratio: r, pass: r >= p.min, known: known && !regressed, key };
  });
  const fails = rows.filter((r) => !r.pass && !r.known);
  totalFail += fails.length;
  if (failuresOnly && fails.length === 0) continue;
  console.log(`\n=== ${id} (${scheme.mode}) ${fails.length ? `(${fails.length} FAIL)` : "(all pass)"} ===`);
  for (const r of failuresOnly ? rows.filter((row) => !row.pass) : rows) {
    const tag = r.pass ? "PASS" : r.known ? "KNOWN" : "FAIL";
    console.log(
      `  [${tag}] ${r.ratio.toFixed(2)}:1 (need ${r.min}) ${r.fg}→${r.bg}  ${r.name}`,
    );
  }
}
const unmatched = [...KNOWN_FAILURES.keys()].filter((key) => !seenKnown.has(key));
for (const key of fixedKnown)
  console.log(`\n✗ "${key}" now passes — delete it from KNOWN_FAILURES.`);
for (const key of unmatched)
  console.log(`\n✗ "${key}" matches no scheme or pair — delete it from KNOWN_FAILURES.`);
const knownStill = [...KNOWN_FAILURES].filter(([key]) => seenKnown.has(key) && !fixedKnown.includes(key));
if (knownStill.length)
  console.log(`\n! ${knownStill.length} known failing pair(s): ${knownStill.map(([key, k]) => `${key} (${k.why})`).join("; ")}`);
const ok = totalFail === 0 && fixedKnown.length === 0 && unmatched.length === 0;
console.log(`\n${ok ? "✓ ALL PASS" : `✗ ${totalFail} failing pair(s)`}`);
process.exit(ok ? 0 : 1);
