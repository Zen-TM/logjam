# Logjam Web design conventions

The house style for Logjam Web. **Reference implementations:**

- `src/ui/` — the kit. Every screen composes it.
- `src/components/sidebar/panels/PlacesPanel.tsx` and `PlaceFilterSheet.tsx`, a collection page: hero, two rails, a sheet beside the list, selection, and verbs shared with the map.
- `src/components/sidebar/NavRail.tsx`, `SidebarPanel.tsx`, `map/MapChrome.tsx`, `map/LayersPopover.tsx` and `map/MapSearchBox.tsx`, the shell.

When a rule here is ambiguous, read those.

**Read `mobile/DESIGN.md` as well.** Logjam GPS and Logjam Web are one product used in two places — the phone in the field, the browser at home. The two files differ in medium, not in beliefs. Rules about hierarchy, identity, copy, privacy and states hold on both; this file only restates one where the web applies it differently, and says so.

**Keep this file current.** Changing a convention means changing this file in the same commit as the code.

Scope: files still listed in `MUI_LEGACY_FILES` (`eslint.config.js`) predate this file. Rebuild them onto these rules as they are touched; the list may only shrink.

---

## 0. One product, two clients: how they stay the same

Drift between the clients happened because each kept its own copy of the same decision. The rule now: **a decision both clients make is declared once, in `@logjam/shared`, with a test.**

| Decision | Declaration |
|---|---|
| Identity hues, the ink, radii | `shared/src/designTokens.ts` |
| Place status: rule, labels, order, row summary | `shared/src/placeStatus.ts` |
| Filter sheet words, sort options, presets | `shared/src/placeFilterOptions.ts` |
| Range pills (tap to start, widen, narrow, clear) | `shared/src/rangeSelect.ts` |
| Which filter control a numeric attribute gets | `filterPillStops` in `shared/src/placeFilterOptions.ts` |
| The filter predicate, search and sort | `shared/src/placeFilter.ts` |
| Theme schemes | `shared/src/themeSchemes.ts` |
| Every colour pair either client renders | `scripts/wcag-contrast.mjs` (CI) |

What stays per client is the medium: glyph family (lucide here, Feather there), gestures, layout. When you build a web screen, **open its Logjam GPS counterpart first** and lift its question, vocabulary and states. If you need something the phone computes, extract it to `shared/` and call it from both — never rewrite it.

## 1. The one question a page answers

Every page leads with the question its user opened it to answer, and answers it before any list.

- Places → "how far through my list am I, and what's left?" (a count; the status rail right under it breaks it down)
- Logs → "what have I done?"; its Stats view → "how much, and of what?"
- Ways → "what lines have I got?" (routes I drew, tracks I recorded, files I imported)
- Maps → "what maps have I made, and what is still being made?" (GeoPDFs, LiDAR topos)
- Friends → "who can I share with, and who is waiting on me?"
- Inbox → "what happened while I was away?"
- Account → "who am I here, and what am I using of it?"
- Settings → nothing to headline. It is a plain list; no hero (mobile §2).
- The map → nothing. It IS the answer; its chrome is the least it can be.
- Layers → "what is my map made of, and what is drawn on it?" (Basemap and Overlays views)

That answer is the **hero**, sized to how much the user came for it (mobile §1).

- **The hero is one line**: the title that answers, then the page's actions. **No eyebrow naming the page**: the rail's lit pill already says where you are, and a title that answers the question names the page too. That line of capitals was removed from Places for giving nothing back.
- **No breakdown the page already shows.** Places had a visited / not visited / shared meter under its title, and the status rail beneath it carried the same three counts on its chips. Before adding a meter, check that no rail or list head already states its numbers.

## 2. Layout skeleton

```
rail 84px │ panel 380px             │ sheet 380px (optional) │ map
          │ hero          pinned    │ Sort and filter        │ search ─ notices     Layers
          │ rails         pinned    │ …scrolls…              │
          │ list          scrolls   │ footer: count · Done   │ compass · scale     tools …
```

- **The panel and the sheet beside it are both 380px.** `--filter-sheet-width` is defined AS `--panel-width`, so they cannot drift apart. 440 was tried first and read as too wide; at 380 a row title wraps to its second line more often, which `Row` allows for.
- **The rail is fixed at 84px** and labels every page: Places, Logs, Ways, Maps and Friends, then a spacer, then Inbox, Account and Settings. The active page's icon sits in an accent pill with an ink glyph. It is the only filled thing on the rail. Pressing the open page closes it.
- **Narrow web (≤768px) is Logjam GPS's tab bar**: Map · Places · Logs · Ways · More. The panel becomes the bottom sheet, and Map closes the panel. More is a menu, with Inbox first because it is the badged one. Keep `useIsMobile()` and every `max-width: 768px` query in step.
- **A page with two views swaps them under one chip rail** (Logs | Stats, GeoPDFs | LiDAR topos), never two pages and never tabs that change the URL.
- **Pin the hero and the rails; only the list scrolls.**
- **One pinned filter axis per page; Places is the exception with two** (type, then status), for the reason mobile §2 gives. Only one rail may say "All" (the type rail's is "Any type").
- **Precise filters live in a sheet that opens BESIDE the list**, not over it. The list it narrows stays visible and updates live. It is non-modal: focus moves to its heading on open and back to its button on close, and Escape closes it. On narrow web it swaps the panel's content instead. **It never opens by itself** when the page is visited; the one exception is returning from drawing an area, which it asks for as a consumed request (§9).
- **Every filter in the sheet wears `FilterField`**: its label, what it is set to ("Any", "3–5", "Yes"), and a clear × while set. So every filter shares one label style and one way to clear, whatever sits beneath.
- **A filter's control is chosen by the attribute's SHAPE, never by its key** (`filterPillStops`). A canyon's grades are ordinary attributes: no section, preset, prefix or label exists for any one type's fields, and the section is "Attributes". By shape:
  - small bounded whole-number axis (bounds are whole numbers, span ≤ 12, integer OR float) → round numbered pills. Tap follows `rangeSelect`; a drag across them selects the span dragged over, and tapping stays the single-pointer path (WCAG 2.5.7).
  - any other bounded number → From / To boxes
  - an unbounded number → an operator (Under, Over, Exactly) and a value
  - yes/no → two chips, the active one clears on press
  - text → Contains
  - a date → From / To
- **An active hidden filter announces itself.** The filter button renders tinted, and an accent strip above the list says "3 filters active · Easiest first" with a round clear button at its right edge (§4).
- **Search hides behind the hero's icon** and takes the title's place on the same line, so opening it moves nothing; the title stays in the document as the page's heading. While it is open the line is the box, the filter button and close.

### The map's chrome

- **Two edges, two jobs** (mobile §2). The action edge, on the right, holds Layers alone in the top corner, then Tools, 3D, locate and zoom stacked above the credits. The instrument edge, on the left, holds the compass beside the scale bar and nothing that changes the app.
- **Search is top-left; notices stack beneath it**, centred over the visible map. They are true-right-now statements ("Showing 42 of 298 places", "5 selected · 14 × 11 km"), never permanent chips. Centring is `safe`: a notice wider than the visible map wraps or overflows to the right, never leftwards over the panel or its sheet.
- **The compass is a needle**, north half filled in the scheme's warning red, counter-rotated by the bearing. Not lucide's `Compass`, a "navigation" symbol whose needle points nowhere: on the map the glyph's direction IS the reading. Like the scale bar, it sits BENEATH MapLibre's control corners: on a narrow map the credits run leftwards over both, and the compass must not be the one thing drawn over the credit text.
- **Layers → Basemap offers six maps, two rows of 3:2 previews**: the OSM family on top (OSM Vector, OSM Topo, OSM Cycle Topo), the SIX sheets beneath. `BASEMAP_CATALOG`'s order is the pickers' order. OSM Vector is the default; the raster OSM "Default" is not offered, because it drew the same map a second way. A stored pick the picker no longer offers falls back to the default rather than hiding every basemap.
- **Tools share one button; its tray opens sideways.** Arming a tool closes the tray. There is no web measure tool, so none is offered — absent, not disabled.
- **Chrome is measured from `--map-inset-left`**, derived in CSS from `data-panel-open` and `data-sheet-open` on `#map`. It slides clear of the panel and sheet. Never pass the width in as a number from JS.
- **MapLibre's own controls are restyled, not re-invented.** Zoom, compass and locate are kit buttons driving the map's public API. GeolocateControl stays mounted, hidden, for the dot and follow mode; the locate button mirrors its state classes. The scale bar and the compact attribution are MapLibre's own, restyled in `Map.module.css`. OSMF allows the credit to collapse to an (i) while it stays one press away.
- **Only things floating over the map cast a shadow.** Panels, sheets and rows separate with hairlines.

## 3. Identity — glyph and hue

Mobile §3 holds in full: a kind has one hue and one glyph, used everywhere it appears. Hues are scheme-independent and come from `designTokens.ts`; the CSS reads them as `--hue-*`, written at startup.

- **Places split their two vocabularies by surface** (mobile §3). On the map the fill is the type's colour and the ring is sharing. A shared place is the SAME pin as your own, with a thin ring set 2px clear of it (`shared-place-halos`): a mark on a pin, not a louder pin. The ring takes clicks too, because your own copy of a shared place sits on the same coordinate and draws over it. On a list row the tile is the STATUS (visited: accent; not visited: `--hue-todo`; shared: `--hue-shared`), and the type is a word in the subtitle, only while the type rail isn't already filtering by it.
- **Web tiles are a SOLID hue with an ink glyph; Logjam GPS's are a hue glyph on a 16% wash.** Measured: a hue glyph on its wash over a card cannot reach 3:1 for the clay and waratah hues at any wash, and misses for most hues under Sandstone. The phone's version is a known failure in the contrast guard.
- **A notification borrows the hue of the thing it is about.** A hub menu is not a vocabulary. Open vocabularies hash their hue from the label (mobile §3).
- **Tallies answer "what would I get".** A chip's count applies every axis but its own. An emptied chip stays in place, disabled.

## 4. Type, shape, depth

| Role | Size / weight |
|---|---|
| Page title (hero) | `--font-xl` 20 / 700 |
| Sheet title, hero metric | `--font-lg` 18 / 600 |
| Row title | `--font-base` 14 / 600, two lines max |
| Body, subtitle, chip, menu item | `--font-sm` 13 (muted for subtitles) |
| Section title, legend, badge | `--font-xs` 12 / 600, section titles uppercase with 1px tracking |

**Labels are sentence case**: a field's label, a filter's label, a switch's title (`--font-sm`). Uppercase belongs only to section titles, because a label in capitals beneath a section title in capitals reads as another heading. (Logjam GPS's `TextField` label is still uppercase; see Open items.) A field whose meaning the control right above it already shows hides its label visually and keeps it as its name (`TextField hideLabel`): the number after Under / Over / Exactly needs no "Value".

**Density is desktop density, and it is decided in `index.css` alone.** A mouse and a big screen want more on screen than a thumb does. A panel at the phone's sizes looked too small because its content was too big, not the other way round.

- Type is `rem`, so a browser text-size setting reaches it. **12px (`--font-xs`) is the floor**; nothing is drawn smaller.
- Every control height and hit target reads a token: `--control-lg` 36 (buttons, text fields), `--control-md` 32 (compact buttons, chips, icon buttons, menu items, filter pills), `--control-sm` 24 (the round button at a pill's end). Margins read `--gutter` 16. **Never write a control's height in px.** Heights are `min-height`, so nothing clips when text grows.
- **A coarse pointer gets Logjam GPS's targets back** (`@media (pointer: coarse)`: 44 / 40 / 32). Keyed to the pointer, not the width: a narrow desktop window still has a mouse, and a touch laptop at full width still has a finger. The mouse sizes still clear WCAG 2.5.8's 24px minimum.
- **Map chrome stays a step larger** than the panel (map buttons and the search box 42, its text 15px): it sits on a busy picture rather than a calm page. The rail's icons are untouched.

**Radius** (`RADIUS`, same as the phone): `sm` 4 for decorative swatches only; `md` 8 for tiles, icon buttons, menu items and fields; `lg` 12 for rows, cards and map buttons; `xl` 16 for popovers and sheets; `pill` for everything text-shaped that isn't a card (buttons, chips, notices, meters, the search box).

**Depth**, from scheme tokens only:

```
text-primary        toast, tooltip      the one inverted surface (ink text)
secondary           rows, chips, cards
primary             page, panel, sheet, popover, menu
surface-field       text fields         a step darker than the page
```

- **The hero has no fill.** Logjam GPS's hero fills with `bonus2`, which fails AA in Sandstone and Ironbark. The web hero separates with a 25%-accent hairline.
- **Text or a glyph ON a fill is `--ink`**: filled buttons, active chips, tiles, badges, the rail's active pill. Never the scheme's `primary` (root CLAUDE.md).
- **Accent as TEXT only on the page colour** (4.5:1 there, not on a card). On a card, accent is an edge or a glyph (3:1).
- **One focus ring for everything**: 2px text-coloured outline, 2px off. Composite widgets draw it on the part that has focus (a menu item, the card behind a stretched row button). On a light fill (a toast) the ring is ink, since the text colour IS that fill.
- **An icon button at the end of a pill is `round`** (a `--control-sm` circle), and the pill pads that end by `calc((its height − var(--control-sm)) / 2)`, written as that calc so it holds under both pointer sizes. The circle is then concentric with the pill's end cap, so neither its hover fill nor its focus ring, drawn flush, crosses the pill's edge. A square button there clipped the pill's curve.

## 5. Rows

`Row` is the only list row. Anatomy: a leading tile, the title and subtitle, then trailing accessories.

- **The body opens and ⋯ acts** (mobile §7). `onOpen` makes the TITLE a real button stretched over the card, so the card opens from anywhere while its tile, metas and ⋯ stay their own controls. A button inside a button is invalid and unreachable.
- **Trailing order**, left to right: metrics (★ 4) → status glyphs (shared with N) → ⋯. The glyph most rows carry goes last. A trailing switch stands 8px further off the card's edge than ⋯ does, since its box has no whitespace of its own (the kit does this).
- **Hover responds at once.** No transition on a row's hover edge, and nothing a hover triggers may re-render above the list (§9).
- **A row's verbs are the pin's verbs.** ⋯ holds the same list a pin opens: Open, Show on map, Make a map here, then Share or export, then Delete.
- **Selected is a state of the row: an accent edge, never a fill.** A tinted fill dropped subtitles below 4.5:1.
- **What the tile says to a sighted reader goes in `description`** (read by assistive tech, not shown).
- **Rows and pins light each other.** Hovering a row lights its pin; pressing a pin while the list is open scrolls to its row and lights it for 2s, rather than leaving the list.

## 6. Surfaces: popover, menu, sheet, dialog, toast

- **Menu** (`Menu`): verbs behind a trigger. A WAI-ARIA menu button in the top layer, so a list's overflow never clips it. Arrows move, Home and End jump, Escape closes and returns focus, Tab leaves, and pressing outside closes it. Title it with the thing it acts on.
- **Popover** (`Popover`): a non-modal panel beside a control (Layers). It stays open while the user pans the map; Escape or its own close button dismisses it, and focus returns to the control. **An item with more inside it than a switch opens a sub-view in place** (a back arrow; LiDAR topos gets Topos | Layers, "In this view" first), never a second popover and never an inline accordion that grows to 20 rows.
- **Side sheet** (`SideSheet`): §2.
- **Dialogs** are still MUI and are the largest migration left. The target is one kit `Dialog`: the modal counterpart of `SideSheet`, focus-trapped, with a title, a close button, a scrolling body and a pinned footer holding the one primary action. Mobile §6's sub-mode rule holds: a picker inside a dialog backs out to the form, not out of the dialog.
- **Toasts** report the outcome of an action. They sit bottom-centre (the map owns both bottom corners) on the inverted light surface, with a round dismiss at the right edge (§4). **They still dismiss themselves after 6 seconds**; × only lets the user go sooner. They pause while hovered or focused (WCAG 2.2.1), and errors are `role="alert"`. A form still open when its action fails reports inside the form instead (`ErrorBanner` above the actions, `FieldError` under the field).

## 7. Actions

- **One acquisition affordance per page**: a compact filled `Add ▾` in the hero, opening a menu of the ways in (Add a place · Import from file · Import from RopeWiki). Never a footer of ghost buttons.
- **Selection starts from a row's tile**, which is also its checkbox: the status glyph at rest, a circle under the pointer, on focus and during a selection. Shift-click selects a range, Ctrl/⌘+A selects all, and Escape clears. Only items the user may act on are selectable (your own places); the rest dim. The type rail stays mounted but inert.
- **The selection bar takes the status rail's slot at the same height, and the list does not move** when selection starts or ends (chips and icon buttons are both `--control-md`). Clear, the count, then only verbs that are better in bulk (mobile §7), **as icon buttons**, so the bar stays one line at 380px. For places: Make a map (its menu names LiDAR topo and GeoPDF), Share or export, Export as, and Delete. Make a map was a filled labelled button until it pushed the bar onto a second line.
- **Make a map is always enabled.** No area cap exists: a topo is bounded by the monthly quota and a GeoPDF by paper at a chosen scale. What fits is said in the next step, not by a greyed button. A topo opens its dialog with the selection's box; a GeoPDF opens its paper frame on the map over the box.
- **Destructive verbs confirm, and the confirm says what goes and what stays** ("Their photos, tracks and shares go too. Trips that link to them stay in your logbook, unlinked.").
- **Absent, not disabled, when the verb cannot exist here**; disabled, with the reason, when it can but not now (mobile §8).

## 8. States

- **Loading is not empty.** A list whose first fetch hasn't landed says "Loading your places…", never the first-run screen. Flashing "No places yet" at every user is the bug this rule came from.
- **Empty states sit on the page, not in a card**, centred in the space the list would fill and nudged about 15% above centre. First-run says what would be here and offers the way in. Filtered-empty says nothing matches and offers Clear filters.
- **A list the server truncated says so** ("Showing your 500 most recent places of 812…").
- **Errors**: three surfaces, one rule each (frontend/CLAUDE.md, "Error display"). Every caught error goes through `messageFromError`.

## 9. Kit rules

- **Compose `src/ui`.** A screen that needs something the kit lacks adds it to the kit, generically, with the smallest API that covers the case. Screen CSS modules do layout; the kit does look.
- **No MUI, no Emotion.** ESLint errors outside `MUI_LEGACY_FILES`. When a file is rebuilt, delete its line; when the list is empty, remove the dependencies and `src/theme.ts`.
- **Native elements first**: `<button>`, `<input type="date">`, the Popover API, `matchMedia`. A library is justified only by a behaviour the platform lacks.
- **Every colour is a token** (`var(--theme-*)`, `--ink`, `--hue-*`, `--surface-field`, `--hairline`). A hue is set per element through a custom property (`--chip-hue`, `--tile-hue`), never an inline colour.
- **Icon-only controls require a `label`**: it is both the accessible name and the mouse tooltip. `Toggle` requires `label` or `labelledBy`, and throws without one.
- **Pure decisions leave the component** into a tested module beside it (`placesModel.ts`, `floating.ts`, `rovingFocus.ts`, `topoFootprint.ts`). Arithmetic in a render is arithmetic nobody checks.
- **Motion respects `prefers-reduced-motion`.**
- **Nothing that changes many times a second is React state above the list.** Hover, drag and pointer positions that another component needs go through a subscribe channel (`map/placeHighlight.ts`), not App state. As App state, hovering one Places row re-rendered App, the map and every row, a 56–300 ms long task per row (measured), and the row's own hover styling waited behind it. Check with a `longtask` PerformanceObserver: anything over 50 ms on hover or typing is a defect.
- **A request to open something on arrival is consumed, not counted** (`openFiltersRequested` + `onOpenFiltersConsumed`, like `revealPlaceId` + `onRevealConsumed`). A counter that stays above zero fires again on every remount; the filter sheet reopened on every later visit to Places that way.

## 10. Accessibility — WCAG 2.2 AA is the floor

- **Contrast is measured, under all four schemes**, by `scripts/wcag-contrast.mjs` in CI: text 4.5:1, UI 3:1. A new pair joins the script in the same change. `KNOWN_FAILURES` may only shrink.
- **Patterns, and where they live:**
  - Chip rail: a radio group with roving focus; the wheel scrolls it sideways, at half a page's speed per notch; `scroll-padding` keeps a focused chip clear of the edge fade (2.4.11); the selected chip is nudged into view, never recentred. (`Chip.tsx`)
  - Menu button, popover, side sheet: §6. (`Menu.tsx`, `SideSheet.tsx`)
  - Search: a combobox with `aria-activedescendant`. (`MapSearchBox.tsx`)
  - Switch: `role="switch"`, named by its visible title. (`Toggle.tsx`)
  - Row checkbox: `role="checkbox"` on the tile. (`PlacesPanel.tsx`)
  - Tooltip: on hover AND focus, dismissable with Escape, hoverable (1.4.13). (`Tooltip.tsx`)
  - Badges: aria-hidden, with the count in the name ("Inbox, 9 unread").
- **Every page has one `h2` (its hero or header); sections are `h3`.** Landmarks: `nav` "Pages", `aside` per panel, `main` for the map.
- **Automated**: `e2e/a11y.spec.ts` runs axe (WCAG 2.0–2.2 A/AA) over every redesigned surface. A new page or surface joins it. Axe catches about a third of failures. Also check by hand: Tab order, focus return after every close, Escape at every layer, 200% zoom, and 390px width.

## 11. Privacy in the UI

Mobile §11 in full, plus:

- **A position is never text in a list.** An area filter is summarised by its SIZE ("18 × 11 km"), never its coordinates.
- **Nothing a user types about their places leaves the browser by default.** The map search matches places locally as you type, and asks the public geocoder only when the user chooses "Search locations for …". Geocoding every keystroke would send every canyon name looked up to a third party.
- **No telemetry, no analytics, no third-party requests keyed to user data.**

## 12. Theme

The user's scheme applies live on the web (the phone applies it at launch, mobile §12). `themePreferences.tsx` writes the scheme tokens as `--theme-*` and the scheme-independent ones (`--ink`, `--hue-*`) at startup, from `@logjam/shared`. Never restate a hex in CSS.

## 13. Copy

Mobile §13 holds. For the web in particular:

- **Name the product**: Logjam Web and Logjam GPS, never "the app" where either could be meant.
- **Say it the phone's way**: "Visited", "Not visited", "Shared", "Any type", "Easiest first". The words come from `@logjam/shared`, so they cannot drift.
- **Counts are pluralised by rule** ("1 place", "37 places"), never "1 places".
- **Sentence case** for buttons, titles and menu items. Verbs on buttons ("Make a map", not "Map").

---

## Open items

- Dialogs (§6) and every file in `MUI_LEGACY_FILES` are still to be rebuilt.
- Logjam GPS's hero fill and row tile fail contrast (`KNOWN_FAILURES`); fixing them changes the phone, so the operator decides when.
- Logs, Ways, Maps, Friends, Inbox and Account still render their pre-redesign content inside the new shell.
- **Logjam GPS's filter sheet still draws the canyon axes with bespoke controls** and `PLACE_THRESHOLDS` presets; Logjam Web draws every attribute by shape (§2). Moving the phone onto `filterPillStops` would let `PLACE_THRESHOLDS` and `CANYON_FORM_FIELD_KEYS` go. On the web, `PlaceDialog.tsx` is the last user of `CANYON_FORM_FIELD_KEYS`.
- Logjam GPS's `TextField` label is uppercase; Logjam Web's field labels are sentence case (§4).
- A one-value pill filter (just "4") excludes a stored 4.5 on a float axis such as quality. It always did for canyons; campsites now share the control.
