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
| What a route or track colour is CALLED | `TRACK_COLOR_NAMES` in `shared/src/media.ts` |
| Which filter control a numeric attribute gets | `filterPillStops` in `shared/src/placeFilterOptions.ts` |
| The filter predicate, search and sort | `shared/src/placeFilter.ts` |
| A notification's words, kind, order and day sections | `shared/src/notificationLabel.ts` |
| Collapsing a bulk share, and counting it as one | `shared/src/notificationBatches.ts` |
| What a notification's row lets you answer, and the confirm copy | `shared/src/notificationActions.ts` |
| Which way the one read/unread button goes | `shared/src/bulkReadAction.ts` |
| A logbook's dates, year sections, date presets, stats ranges, spark axis, and every sentence a stats screen says | `shared/src/logbook.ts` |
| A trip type's glyph and hue | `shared/src/tripTypeIdentity.ts` |
| Theme schemes | `shared/src/themeSchemes.ts` |
| Every colour pair either client renders | `scripts/wcag-contrast.mjs` (CI) |

What stays per client is the medium: glyph family (lucide here, Feather there), gestures, layout. When you build a web screen, **open its Logjam GPS counterpart first** and lift its question, vocabulary and states. If you need something the phone computes, extract it to `shared/` and call it from both — never rewrite it.

## 1. The one question a page answers

Every page leads with the question its user opened it to answer, and answers it before any list.

- Places → "how far through my list am I, and what's left?" (a count; the status rail right under it breaks it down)
- Logs → "what have I done?" (the trip count); its Stats view → "how much, and of what?" (days out, the number the list cannot give)
- Ways → "what lines have I got?" (routes I drew, tracks I recorded, files I imported); a way's own page → "what is this line, and what can I do with it?"
  - **Every kind has that page, and says only what it can honestly say.** A route carries its geometry, so it gets measured figures and a real profile; a recorded track reports the distance, climb and descent its recorder measured; an import reports its size and feature count. A figure nothing knows is absent, never a zero. Only routes fetch a profile — a file's geometry is an S3 object this page has not downloaded, and opening a page should not spend the egress gate.
- Maps → "what maps have I made, and what is still being made?" (GeoPDFs, LiDAR topos)
- Friends → "who can I share with, and who is waiting on me?"
- Inbox → "what happened while I was away?"
- Account → "who am I here, and what am I using of it?"
- Settings → nothing to headline. It is a plain list; no hero (mobile §2).
- The map → nothing. It IS the answer; its chrome is the least it can be.
- Layers → "what is my map made of, and what is drawn on it?" (Basemap and Overlays views)

That answer is the **hero**, sized to how much the user came for it (mobile §1).

- **The hero is one line**: the title that answers, then the page's actions. **No eyebrow naming the page**: the rail's lit pill already says where you are, and a title that answers the question names the page too. That line of capitals was removed from Places for giving nothing back.
- **Every hero is the same height**, whatever it carries: `Hero` states `min-height: calc(var(--control-md) + 2 * 12px + 1px)` on its border box (its own padding and its hairline are the two addends). Left to its content, a hero holding actions is as tall as a `--control-md` button and a title-only one is only its text — 57 vs 55, measured — so swapping a page's two views moved the rail under it and the list under that (operator, 2026-09-16).
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
- **A page with two views swaps them under one chip rail** (Logs | Stats, GeoPDFs | LiDAR topos), never two pages and never tabs that change the URL. **The switch is the first rail under the hero**, never above it: the hero stays the page's first line, and each view's hero answers its own question ("130 trips", "130 days out"). While a selection runs, the switch stays mounted and inert, like Places' type rail.
- **A step inside a view opens in place, with a back arrow in the hero** (`Hero onBack`): one activity's stats. Focus goes to the arrow on the way in and back to the row that was opened on the way out.
- **Pin the hero and the rails; only the list scrolls.** The shell does this for every page by default: the panel body neither scrolls nor adds a gutter, and the page's own list does both. `LEGACY_PAGES` in `SidebarPanel.tsx` names the pages not yet rebuilt, which still scroll inside the body; rebuilding a page takes it off that list. It lists the old pages rather than the new ones because the first page rebuilt against an opt-in list never opted in.
- **One pinned filter axis per page; Places is the exception with two** (type, then status), for the reason mobile §2 gives. Only one rail may say "All" (the type rail's is "Any type").
- **Precise filters live in a sheet that opens BESIDE the list**, not over it. The list it narrows stays visible and updates live. It is non-modal: focus moves to its heading on open and back to its button on close, and Escape closes it. On narrow web it swaps the panel's content instead. **It never opens by itself** when the page is visited; the one exception is returning from drawing an area, which it asks for as a consumed request (§9).
- **The sheet places itself, and ANY page's sheet moves the map.** `SideSheet` owns its own placement — docked at `left: 100%` of the panel at `--filter-sheet-width`, or taking the page's place on narrow web, reading `useIsMobile()` itself — and `usePanelSheet` owns the plumbing every page repeats: open state, telling App a sheet is out, growing the bottom sheet on narrow web, and clearing the flag when the page unmounts. A page supplies only the contents. Both were once written out per page: the placement CSS was duplicated in two panel modules, and App's flag read `placesSheetOpen && activePanel === "places"`, so the Logs date sheet opened over map chrome that never moved (operator, 2026-09-16). The flag is `sidebarSheetOpen` and names no page.
- **Every filter in the sheet wears `FilterField`**: its label, what it is set to ("Any", "3–5", "Yes"), and a clear × while set. So every filter shares one label style and one way to clear, whatever sits beneath.
- **A filter's control is chosen by the attribute's SHAPE, never by its key** (`filterPillStops`). A canyon's grades are ordinary attributes: no section, preset, prefix or label exists for any one type's fields, and the section is "Attributes". By shape:
  - small bounded whole-number axis (bounds are whole numbers, span ≤ 12, integer OR float) → round numbered pills. Tap follows `rangeSelect`; a drag across them selects the span dragged over, and tapping stays the single-pointer path (WCAG 2.5.7).
  - any other bounded number → From / To boxes
  - an unbounded number → an operator (Under, Over, Exactly) and a value
  - yes/no → two chips, the active one clears on press
  - text → Contains
  - a date → From / To
- **One control draws an attribute, on both sides and for both entities.** `AttributeFilter` (`src/ui`, and its counterpart in `mobile/src/ui`) takes a definition and a filter and picks the control by the shape above; `passesCustomFieldFilters` in `@logjam/shared` decides whether a value passes. A PLACE keeps its answers in `fieldValues` and a TRIP in `customFields`, and that is the ONLY difference between them — so the five-kind switch and its edge cases (an unparsable date is an unknown, not a match) exist once rather than four times.
- **Logs' sheet is Sort · Attributes · Date range**, and the attributes it offers are `tripFieldDefs(defs, the types of the places these trips link, every key a trip has answered)` — the union clause matters here exactly as it does on a form: a trip whose place was retyped or unlinked still holds its answer, and dropping the field would hide those trips behind an axis the user cannot see.
- **"Include trips/places missing this info" sits WITH the attributes, and widens.** Most records answer most fields not at all, so without the choice one attribute filter empties the list and nothing on screen says why. It is not one of the filters the strip counts, because it never narrows.
- **Sort is a preference; filters are ephemeral.** The trip sort is two options and not a menu (a logbook is chronological — the only question is which end you start from), it persists in `localStorage` like Places' sort, and a Reset does NOT clear it: clearing it would move the list for someone who only asked to see all their trips again. The year headings run the way the trips inside them do (`groupTripsByYear(trips, sort)`), or "Oldest first" reads bottom-to-top.
- **An active hidden filter announces itself.** The filter button renders tinted, and an accent strip above the list says "3 filters active · Easiest first" with a round clear button at its right edge (§4).
- **Search hides behind the hero's icon** and takes the title's place on the same line, so opening it moves nothing; the title stays in the document as the page's heading. While it is open the line is the box, the filter button and close.

### The map's chrome

- **Two edges, two jobs** (mobile §2). The action edge, on the right, holds Layers alone in the top corner, then Tools, 3D, locate and zoom stacked above the credits. The instrument edge, on the left, holds the compass beside the scale bar and nothing that changes the app.
- **Search is top-left; notices stack beneath it**, centred over the visible map. They are true-right-now statements ("Showing 42 of 298 places", "5 selected · 14 × 11 km"), never permanent chips. Centring is `safe`: a notice wider than the visible map wraps or overflows to the right, never leftwards over the panel or its sheet.
- **The compass is a needle**, north half filled in the scheme's warning red, counter-rotated by the bearing. Not lucide's `Compass`, a "navigation" symbol whose needle points nowhere: on the map the glyph's direction IS the reading. Like the scale bar, it sits BENEATH MapLibre's control corners: on a narrow map the credits run leftwards over both, and the compass must not be the one thing drawn over the credit text.
- **Layers → Basemap offers six maps, two rows of 3:2 previews**: the OSM family on top (OSM Vector, OSM Topo, OSM Cycle Topo), the SIX sheets beneath. `BASEMAP_CATALOG`'s order is the pickers' order. OSM Vector is the default; the raster OSM "Default" is not offered, because it drew the same map a second way. A stored pick the picker no longer offers falls back to the default rather than hiding every basemap.
- **Tools share one button; its tray opens sideways.** Arming a tool closes the tray. There is no web measure tool, so none is offered — absent, not disabled.
- **An armed map TOOL is a PAGE, not a card over the map.** The route tool lived over the canvas twice and both were wrong: a fixed `left: 50%` box sat on the ground being drawn, and the centred version's full-width container swallowed clicks either side of it, so anchors could not be dropped there at all (operator, 2026-09-17). It is `way-draw`, an ordinary page in the 380px panel the map is already inset for — so nothing floats, every pixel of canvas takes a click, and the tool has room for the line's figures and its elevation profile AS IT IS DRAWN, which the card never had. On narrow web the panel is the bottom sheet, so the same code is the bottom bar. A tool's own settings live in it rather than in Layers, because they change what the NEXT click does (the snap picker). Leaving the tool discards its draft, which is why both ways out confirm.
  - **What is being drawn is a property of the draft, not a question at the end.** The colour is picked in the tool, where the line is on the map in that colour as it is built; the save dialog asks only for a name. It was in both, which is two controls for one property.
  - **The terrain is read when the line PAUSES**, not per placed point: a profile per click is a request per click, and the figures are only looked at between decisions anyway (`PROFILE_SETTLE_MS`).
- **Chrome is measured from `--map-inset-left`**, derived in CSS from `data-panel-open` and `data-sheet-open` on `#map`. It slides clear of the panel and sheet. Never pass the width in as a number from JS.
- **MapLibre's own controls are restyled, not re-invented.** Zoom, compass and locate are kit buttons driving the map's public API. GeolocateControl stays mounted, hidden, for the dot and follow mode; the locate button mirrors its state classes. The scale bar and the compact attribution are MapLibre's own, restyled in `Map.module.css`. OSMF allows the credit to collapse to an (i) while it stays one press away.
- **Only things floating over the map cast a shadow.** Panels, sheets and rows separate with hairlines.

## 3. Identity — glyph and hue

Mobile §3 holds in full: a kind has one hue and one glyph, used everywhere it appears. Hues are scheme-independent and come from `designTokens.ts`; the CSS reads them as `--hue-*`, written at startup.

- **Places split their two vocabularies by surface** (mobile §3). On the map the fill is the type's colour and the ring is sharing. A shared place is the SAME pin as your own, with a thin ring set 2px clear of it (`shared-place-halos`): a mark on a pin, not a louder pin. The ring takes clicks too, because your own copy of a shared place sits on the same coordinate and draws over it. On a list row the tile is the STATUS (visited: accent; not visited: `--hue-todo`; shared: `--hue-shared`), and the type is a word in the subtitle, only while the type rail isn't already filtering by it.
- **Web tiles are a SOLID hue with an ink glyph; Logjam GPS's are a hue glyph on a 16% wash.** Measured: a hue glyph on its wash over a card cannot reach 3:1 for the clay and waratah hues at any wash, and misses for most hues under Sandstone. The phone's version is a known failure in the contrast guard.
- **A trip wears its FIRST type's glyph and hue** (`tripTypeIdentity`): canyoning takes the accent, the other seeded activities borrow asset hues, a type the user typed hashes its label into `TRIP_TYPE_OPEN_HUES`, and a trip with no type is `--theme-bonus-1` with a book. The first type is the user's own ordering, so the form stars it rather than reordering the chips.
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

**Radius** (`RADIUS`, same as the phone): `sm` 4 for decorative swatches and a checkbox's box; `md` 8 for tiles, icon buttons, menu items and fields; `lg` 12 for rows, cards and map buttons; `xl` 16 for popovers and sheets; `pill` for everything text-shaped that isn't a card (buttons, chips, notices, meters, the search box).

**Depth**, from scheme tokens only:

```
text-primary        toast, tooltip      the one inverted surface (ink text)
secondary           rows, chips, cards
primary             page, panel, sheet, popover, menu
surface-field       text fields         a step darker than the page
```

- **The hero has no fill.** Logjam GPS's hero fills with `bonus2`, which fails AA in Sandstone and Ironbark. The web hero separates with a 25%-accent hairline.
- **Text or a glyph ON a fill is `--ink`**: filled buttons, active chips, tiles, badges, the rail's active pill. Never the scheme's `primary` (root CLAUDE.md).
- **Accent as TEXT only on the page colour** (4.5:1 there, not on a card). On a card, accent is an edge or a glyph (3:1). So an **outline button** is an accent border around a text-coloured label: it also sits on cards (a notification's Decline), where an accent label measured 3.6:1 under Sandstone.
- **One focus ring for everything**: 2px text-coloured outline, 2px off. Composite widgets draw it on the part that has focus (a menu item, the card behind a stretched row button). On a light fill (a toast) the ring is ink, since the text colour IS that fill.
- **An icon button at the end of a pill is `round`** (a `--control-sm` circle), and the pill pads that end by `calc((its height − var(--control-sm)) / 2)`, written as that calc so it holds under both pointer sizes. The circle is then concentric with the pill's end cap, so neither its hover fill nor its focus ring, drawn flush, crosses the pill's edge. A square button there clipped the pill's curve.

## 5. Rows

`Row` is the only list row. Anatomy: a leading tile, the title and subtitle, then trailing accessories.

- **The body opens and ⋯ acts** (mobile §7). `onOpen` makes the TITLE a real button stretched over the card, so the card opens from anywhere while its tile, metas and ⋯ stay their own controls. A button inside a button is invalid and unreachable.
- **Trailing order**, left to right: metrics (★ 4) → status glyphs (shared with N) → ⋯. The glyph most rows carry goes last. A trailing switch stands 8px further off the card's edge than ⋯ does, since its box has no whitespace of its own (the kit does this).
- **Hover responds at once.** No transition on a row's hover edge, and nothing a hover triggers may re-render above the list (§9).
- **Only a row that DOES something answers the pointer.** The hover edge is scoped to a row that opens (`onOpen`) or can be picked; a read-out row — Stats' rows — stays put, because lighting its edge promised a press that does nothing (operator, 2026-09-16). `highlighted` is lit from outside, so it stands whatever the row can do.
- **A row's verbs are the pin's verbs.** ⋯ holds the same list a pin opens: Open, Show on map, Make a map here, then Share or export, then Delete.
- **Selected is a state of the row: an accent edge, never a fill.** A tinted fill dropped subtitles below 4.5:1.
- **What the tile says to a sighted reader goes in `description`** (read by assistive tech, not shown).
- **Renaming happens in a dialog, never in a live field on the row.** Ways gave every file an always-editable input that committed on blur — so clicking anywhere else saved, and there was no way to abandon a rename once started. The body opens and ⋯ acts: Rename… is a menu item that opens a form with a Cancel, the way Logjam GPS's `RenameForm` already asks.
- **A row that asks a question is answered inside its card** (`footer`: Accept · Decline, Save a copy · Turn down, Zoom to map, Download), on a line under the text. Below the card, a pair reads as a caption for the next row down. The filled button is yes; the outline is no. The footer goes inert while a selection runs.
- **Unread is an accent edge** down the row's left side (`accentEdge`), not a "New" pill: the pill cost a title a line at 380px, and the hero already says how many. The edge is an inset shadow, so it never changes the row's size, and it survives the row being selected too.
- **A chronological list runs newest first in day sections** with sticky headings ("Today", "Yesterday", "12 Sept") and a count each, and never re-sorts itself by state: marking a row read must not move it (`newestNotificationsFirst`). A bulk share is one row that opens in place, its members a step in; it counts as one everywhere a count is shown.
- **Rows and pins light each other.** Hovering a row lights its pin; pressing a pin while the list is open scrolls to its row and lights it for 2s, rather than leaving the list.

## 6. Surfaces: popover, menu, sheet, dialog, toast

- **Menu** (`Menu`): verbs behind a trigger. A WAI-ARIA menu button in the top layer, so a list's overflow never clips it. Arrows move, Home and End jump, Escape closes and returns focus, Tab leaves, and pressing outside closes it. Title it with the thing it acts on.
- **Popover** (`Popover`): a non-modal panel beside a control (Layers). It stays open while the user pans the map; Escape or its own close button dismisses it, and focus returns to the control. **An item with more inside it than a switch opens a sub-view in place** (a back arrow; LiDAR topos gets Topos | Layers, "In this view" first), never a second popover and never an inline accordion that grows to 20 rows.
- **Side sheet** (`SideSheet`): §2.
- **Dialog** (`Dialog`): the modal counterpart of `SideSheet`, for a task that is finished or abandoned before the page is used again. A native `<dialog>` opened with `showModal()`, so the browser supplies the top layer, the inert page and the focus trap. Anatomy: a title and a close button, a body that scrolls, and a pinned footer holding Cancel and then the ONE primary action on the right. The three are separated by space, not hairlines: dividers above and below a two-line confirm boxed its message in and looked strange (operator, 2026-09-14). `ConfirmDialog` and `RouteNameDialog` are the reference.
  - **Focus** moves to the element marked `data-autofocus` (a form's first field), else to the title, and returns to the opener on close. React's `autoFocus` fires before the dialog is shown, when nothing in it can take focus.
  - **Escape, the close button and a press on the backdrop dismiss it**, and none of them does while a request is in flight (`dismissible={false}`). A press that starts inside and ends on the backdrop (a text selection dragged too far) is not a dismissal.
  - **It renders into `document.body` and stops its own Escape**, so closing it never also closes the MUI dialog it was raised from, or clears the selection of the list behind it.
  - **Two sizes.** `small` (400) is a confirm or a short form and stays centred at every width. `large` (640) is a long form and fills the screen on narrow web, the web's stand-in for Logjam GPS's sheet.
  - **A form's Save is `type="submit"`** tied to the form in the body (`form={formId}`), so Enter in a field saves, and it wears `busy` while the request runs.
  - **One dialog at a time.** A confirm may stand over the dialog it acts for (discard unsaved changes over a form, Delete over the trip it deletes, Delete file over the gallery); nothing else opens a dialog from a dialog. A form that is a second view of the same thing REPLACES the first (a trip's Edit closes its view). Mobile §6's sub-mode rule holds: a picker inside a dialog swaps the body and backs out to the form, not out of the dialog — the title names the step, and Escape, the close button and Done all go back to the form (`TripLogDialog`'s places). The form stays mounted, `hidden`, so an upload in flight survives the trip there and back.
  - **A view dialog's footer** is the destructive verb at the far left (`danger`, confirms) and the ONE primary on the right (Edit trip); the title's close button is its Cancel.
  - **Anything layered inside a dialog handles its own Escape on its own element** (the lightbox, the chip picker's add field, a menu): the dialog hears a document-bound Escape first and would close under it.
- **Confirm** (`ConfirmDialog`): an alert dialog, its body read as the description. It says what goes and what stays (§7). Cancel, then the verb: `destructive` (a warning fill with the ink label) when something is lost, `filled` when nothing is (Rename, Fetch from RopeWiki). A destructive TRIGGER (a menu's Delete) stays `danger`, so the fill only ever marks the last step.
- **Toasts** report the outcome of an action. They sit bottom-centre (the map owns both bottom corners) on the inverted light surface, with a round dismiss at the right edge (§4). **They still dismiss themselves after 6 seconds**; × only lets the user go sooner. They pause while hovered or focused (WCAG 2.2.1), and errors are `role="alert"`. A form still open when its action fails reports inside the form instead (`ErrorBanner` above the actions, `FieldError` under the field).

## 7. Actions

- **One acquisition affordance per page**: a compact filled `Add ▾` in the hero, opening a menu of the ways in (Add a place · Import from file · Import from RopeWiki). Never a footer of ghost buttons.
- **Selection starts from a row's tile**, which is also its checkbox: the status glyph at rest, a circle under the pointer, on focus and during a selection. Shift-click selects a range, Ctrl/⌘+A selects all, and Escape clears. Only items the user may act on are selectable (your own places); the rest dim. The type rail stays mounted but inert.
- **The selection bar takes the status rail's slot at the same height, and the list does not move** when selection starts or ends (chips and icon buttons are both `--control-md`). Clear, the count, then only verbs that are better in bulk (mobile §7), **as icon buttons**, so the bar stays one line at 380px. For places: Make a map (its menu names LiDAR topo and GeoPDF), Share or export, Export as, and Delete. Make a map was a filled labelled button until it pushed the bar onto a second line.
- **A page's housekeeping verbs sit behind the hero's ⋯**, never in a footer: the Inbox's Mark all as read and Clear read notifications. Disabled, not hidden, when there is nothing for them to do.
- **The tile-as-checkbox is the kit's `TileCheckbox`**, shared by every selectable list. Where a picked row stands for several things (an Inbox batch), the verbs act on all of them (`expandBatchSelection`). The Inbox's bar carries ONE read/unread button whose direction follows the selection (`bulkReadAction`, glyph eye / eye-off), then Delete; its count line states the unread tally that decides the direction.
- **Make a map is always enabled.** No area cap exists: a topo is bounded by the monthly quota and a GeoPDF by paper at a chosen scale. What fits is said in the next step, not by a greyed button. A topo opens its dialog with the selection's box; a GeoPDF opens its paper frame on the map over the box.
- **Destructive verbs confirm, and the confirm says what goes and what stays** ("Their photos, tracks and shares go too. Trips that link to them stay in your logbook, unlinked.").
- **Absent, not disabled, when the verb cannot exist here**; disabled, with the reason, when it can but not now (mobile §8).
- **A PROPERTY is inline; a VERB is in ⋯; and every ⋯ for the same thing renders the SAME list.** Ways had three surfaces disagreeing about which was which — a row's menu, a detail page's menu, and controls loose in the detail body — with no rule behind the split (operator, 2026-09-17). The rule: something you change in place (a colour, whether it is drawn on the map, which place it belongs to) is a control in the body and never a menu item; something you DO (Edit, Reverse, Share, Export, Delete) is a menu item and never a button in the body. `wayActions.ts` declares both halves once, the way `mobile/src/saved/assetActions.ts` does, so the surfaces cannot drift.
  - **The two menus differ by exactly one verb: Open**, which the detail page omits because you are already looking at the thing. That is the same single exception the phone allows.
  - **A row may hand a verb to the page rather than hosting it.** A menu cannot hold a form, so Share, Rename and Delete open the way's page with that verb armed (`onOpenWay(way, verb)`), which is invisible to the user and is what lets one list serve both surfaces instead of a shorter menu on rows.
- **Opening a thing CENTRES the map on it.** A page describing a line while the map shows somewhere else is two halves of one answer, so opening a way fits the map to its extent — and so does arming the editor on it, since the points being edited must be on screen. Every kind therefore knows its own extent (`WayItem.bounds`): a route from the geometry in hand, a file from the bbox its row already carries, so centring costs no download. With this, a separate "Centre the map here" verb is a second way to do what opening already did, and is gone.

## 8. States

- **Loading is not empty.** A list whose first fetch hasn't landed says "Loading your places…", never the first-run screen. Flashing "No places yet" at every user is the bug this rule came from.
- **Empty states sit on the page, not in a card**, centred in the space the list would fill and nudged about 15% above centre. First-run says what would be here and offers the way in. Filtered-empty says nothing matches and offers Clear filters.
- **A list the server truncated says so** ("Showing your 500 most recent places of 812…"), and so does anything computed from it: Stats counts the loaded trips and says "Counted over your 500 most recent trips of 812" when they are not all of them.
- **A chronological list runs newest first in sticky year or day sections** with a count each (Logs by year, the Inbox by day).
- **Errors**: three surfaces, one rule each (frontend/CLAUDE.md, "Error display"). Every caught error goes through `messageFromError`.

## 9. Kit rules

- **Compose `src/ui`.** A screen that needs something the kit lacks adds it to the kit, generically, with the smallest API that covers the case. Screen CSS modules do layout; the kit does look.
- **Form controls are native elements in one field's clothes.** `TextField`, `NumberField` and `Select` share an anatomy: a sentence-case label, the control, an optional `hint` (visible and read with the control, where a tooltip is neither) and `FieldError`.
  - `NumberField` types as text and sanitises each keystroke (`numberInput.ts`); the caller blocks Save with the same `numericFieldError`.
  - A date is `TextField type="date"`. The native picker already follows the page's dark `color-scheme`, so a `DateField` would have added a name and nothing else.
  - `Checkbox` is an item in a set (which types, which layers). A setting that applies at once is a `SwitchRow`.
  - `SwatchPicker` is a closed list of colours as native radios: one tab stop, arrows move the choice, and the chosen swatch wears an accent ring. **A swatch is named by `nameOf`, not by its hex**: "#e6194b" is a name but not a helpful one, and ten of them in a row is what a screen-reader user had to pick from. `trackColorName` (`@logjam/shared`) is the one for the route palette, so the phone's picker and this one cannot disagree about which colour is "Teal".
  - `TextArea` is several lines (notes): it rests at `minRows`, grows with the text (`field-sizing`) and stops at `maxRows`, where it scrolls.
- **Several choices from a vocabulary the user extends: `ChipPicker`** (a trip's types). Toggle chips that keep vocabulary order whatever is picked; an "Add" chip becomes a small field (Enter adds, Escape backs out of the field only); a value that cannot change here is `lockedValues` with the reason in `hint`; a pick whose POSITION means something is `primaryValue`, starred.
- **One single-choice control: `ChipRail`**, a radio group, wherever the choice sits, including inside a dialog. The kit has no `SegmentedControl`; it would have been a second look for the same decision.
- **A state as a word is a `StatusPill`**, never a `Chip`, which is a control. Logjam GPS's four tones: `accent` done or ready, `outline` neutral, `warning` needs the user (the edge and glyph in warning, the label in the text colour, because warning as text on a card measured 3.8:1), `muted` quiet and not a problem.
- **Progress is a `ProgressBar`**, with a `value` when the number is known and a sweep while it is not (a slow fade under reduced motion, since a still bar reads as a number).
- **A section title is `SectionHeader`**: an `h3` with an optional count, in sheets, dialogs and plain lists alike. Only a count: an action inside a heading becomes part of its name.
- **Numbers read at a glance: `StatGrid`** (a label over its value, a definition list) **and `ActivitySpark`** (bars sized to the busiest bucket, an empty one only its track, not pressable). A spark's bars are for the eye; assistive tech reads the same numbers as a list, each bucket `name`d in full ("March 2026", never "M").
- **`Button busy`** swaps the leading glyph for a spinner and disables the button without fading it, because it is working, not unavailable.
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
  - Dialog: a native modal `<dialog>`; a confirm is `role="alertdialog"` described by its body. (`Dialog.tsx`)
  - Checkbox, swatches, select: native inputs, so their keyboard and announcements are the platform's. (`Choice.tsx`, `TextField.tsx`)
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

- Every dialog but `ConfirmDialog` and `RouteNameDialog`, and every file in `MUI_LEGACY_FILES`, is still to be rebuilt. `ValidatedNumberField` goes when its last caller moves to `NumberField`.
- Logjam GPS's hero fill and row tile fail contrast (`KNOWN_FAILURES`); fixing them changes the phone, so the operator decides when.
- Maps, Friends, Account and Settings still render their pre-redesign content inside the new shell (`LEGACY_PAGES`).
- **A way's kind names what it IS; where it lives is a property of the row.** Ways briefly carried a fourth chip, "On a place", for the tracks on places a friend shared — not because they were a different kind of thing but because `GET /places/tracks` returned a place id, a media id and a colour and nothing else, so nothing could say what they were. The fix was at the source: the endpoint returns the file's name, `origin` and metadata too, and those rows are ordinary Tracks and Imports with their place in the subtitle. A rail that mixes "what a thing is" with "where it lives" is the thing to notice; widening the endpoint is usually cheaper than inventing a category for the gap. The two endpoints overlap on the user's own files, so `buildWays` de-duplicates by media id and keeps the row that knows the file is theirs (`waysModel.ts`).
- **Stats is Logjam GPS's stats, and the old canyoning Analytics is gone** (Phase B, 2026-09-14): its "Place trips / Unique places / Days canyoning / Total abseils" tiles, the completion ring and the year → month → day calendar. The phone's screen was built on `computeLogbookStats` so the two clients could not disagree; "Total abseils" summed a place attribute over trips, which root CLAUDE.md ("A TOTAL needs a declaration") rules out; the ring is "Places visited" per type; a day's trips are the Logs list with a date range. `GET /analytics` has no Logjam Web caller left — whether the API keeps it is the operator's call.
- Logjam GPS's Stats has "On foot", from recordings on that phone. Logjam Web has no recordings, so the section is absent.
- `PlaceDialog` (MUI, Phase B package 6) now hosts the kit's attribute inputs and add form, so its attribute section already looks like the trip form's while the rest of it does not.
- The GeoPDF hue was lifted a second time (#CE885C → #D99B72) on both clients, for the bikepacking trip chip's glyph on a card.
- **A batch of sent files is answered one file at a time on Logjam Web.** Logjam GPS's batch row carries Save all · Turn all down; a browser allows one download per press, so "Save all 8" would deliver one file and block the rest. The batch opens in place and each file keeps its own buttons.
- **Logjam GPS still draws the seven CANYON axes with bespoke controls** and `PLACE_THRESHOLDS` presets. Everything else converged on 2026-09-17: a user's own attributes are drawn by shape from one kit component on each side, and both clients filter through `passesCustomFieldFilters`. What remains is the preset axes — moving the phone onto `filterPillStops` for those would let `PLACE_THRESHOLDS` and `CANYON_FORM_FIELD_KEYS` go. On the web, `PlaceDialog.tsx` is the last user of `CANYON_FORM_FIELD_KEYS`.
- **A date attribute draws no row on the phone** (`mobile/src/ui/AttributeFilter.tsx` returns null for it), while Logjam Web draws it as two bounds. The shared predicate already handles the filter, so this is UI only: the phone's date picker is a MODE of its sheet keyed to the built-in date fields, and adding one means widening that sheet's `Mode` to carry a custom key.
- Logjam GPS's `TextField` label is uppercase; Logjam Web's field labels are sentence case (§4).
- A one-value pill filter (just "4") excludes a stored 4.5 on a float axis such as quality. It always did for canyons; campsites now share the control.
