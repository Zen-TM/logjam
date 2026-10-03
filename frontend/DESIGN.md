# Logjam Web design

How Logjam Web applies the [UX principles](../docs/ux-principles.md). Read
those first: they hold every rule both clients share. This file is only what
is particular to a browser, a mouse, a keyboard and a big screen.

**Reference implementations.** When a rule here is ambiguous, read these:

- `src/ui/`, the kit. Every screen composes it.
- `src/components/sidebar/panels/PlacesPanel.tsx` with `PlaceFilterSheet.tsx`:
  a collection page with a hero, two rails, a sheet beside the list, selection,
  and verbs shared with the map.
- `src/components/sidebar/NavRail.tsx`, `SidebarPanel.tsx`, `map/MapChrome.tsx`,
  `map/LayersPopover.tsx` and `map/MapSearchBox.tsx`: the shell.

Building a page that Logjam GPS also has? Open its counterpart first and lift
its question, words and states. Anything both compute goes to `@logjam/shared`.

Change a convention, change this file in the same commit.

## 1. Tokens

All tokens are declared in `@logjam/shared` (`designTokens.ts`,
`themeSchemes.ts`) and generated into `src/tokens.generated.css` by
`npm run tokens`; never edit that file (`src/tokens.generated.test.ts` fails
when it is stale). Logjam Web's own layout values (rail and panel widths,
shadows) are in `src/index.css`. A scheme is a `data-scheme` attribute on
`<html>`, applied live.

- **Every colour, space, size, radius, duration and text size is a custom
  property, never a literal**: `--color-<role>`, `--hue-<kind>`, `--space-<n>`
  (8 × n: `--space-1-5` is 12px), `--radius-*`, `--font-*`, `--control-*`,
  `--motion-*`. A px literal is allowed only for a 1–2px border or offset, the
  768px breakpoint (a media query cannot read a variable) and a shape's own
  geometry marked `/* intrinsic … */` (the 36×4 grab handle).
  `src/pxBudget.test.ts` holds each screen stylesheet to a count that only
  shrinks. A hue set per element goes through a custom property the kit reads
  (`--tile-hue`, `--chip-hue`), never an inline colour. CSS modules only; an
  inline `style` only sets a custom property.
- **Density is desktop density**, decided in the tokens alone: type
  12/13/14/18/20px (`--font-xs` … `--font-xl`), in `rem` so the browser's text
  size reaches it, and 12px is the floor. Controls are `--control-lg` 36
  (buttons, fields), `--control-md` 32 (chips, icon buttons, menu items) and
  `--control-sm` 24 (the round button at a pill's end). Heights are
  `min-height`, so nothing clips when text grows.
- **A coarse pointer gets Logjam GPS's targets** (`@media (pointer: coarse)`,
  48/40/32), keyed to the pointer and not the width: a narrow desktop window
  still has a mouse.
- **Map chrome is a step larger** than the panel (42px buttons, 15px search
  text): it sits on a busy picture rather than a calm page.

| Role | Size / weight |
|---|---|
| Page title (hero) | `--font-xl` / 700 |
| Sheet title, hero metric | `--font-lg` / 600 |
| Row title | `--font-base` / 600, two lines at most |
| Body, subtitle, chip, menu item | `--font-sm` (muted for subtitles) |
| Section title, legend, badge | `--font-xs` / 600; section titles uppercase, 1px tracking |

**Radius** (`RADIUS`, the same scale as Logjam GPS): `sm` for swatches and a
checkbox's box; `md` for tiles, icon buttons, menu items and fields; `lg` for
rows, cards and map buttons; `xl` for popovers and sheets; `pill` for anything
text-shaped that is not a card. `--radius-full` is 50%, a circle only on a
square box; anything stadium-shaped is `--radius-pill`.

**Depth** is the scheme's surfaces, never a shadow, except for things floating
over the map (`--shadow-float`, `--shadow-modal`). Panels, sheets and rows
separate with a hairline. The hero has no fill.

## 2. The shell

```
rail 84px │ panel 380px             │ sheet 380px (optional) │ map
          │ hero          pinned    │ Sort and filter        │ search ─ notices     Layers
          │ rails         pinned    │ …scrolls…              │
          │ list          scrolls   │ footer: count · Done   │ compass · scale     tools …
```

- **The rail labels every page**: Places, Logs, Ways, Maps, Friends, a spacer,
  then Inbox, Account, Settings. The active page's icon sits in an accent pill
  with an `onFill` glyph, the only fill on the rail. Pressing the open page
  closes it.
- **The panel and the sheet beside it are both 380px**: `--filter-sheet-width`
  is defined as `--panel-width`.
- **The panel body neither scrolls nor pads**; the page pins its hero and
  rails and its own list scrolls.
- **Every hero is the same height** whatever it carries (`Hero`'s
  `min-height`), so switching a page's views never moves the rail under it.
- **A page with two views swaps them under one chip rail**, the first rail
  under the hero (Logs | Stats, GeoPDFs | LiDAR topos). A step inside a view
  opens in place with a back arrow in the hero (`Hero onBack`); focus goes to
  the arrow on the way in and back to the opened row on the way out.
- **Narrow web (≤768px)** is Logjam GPS's tab bar: Map · Places · Logs · Ways
  · More. One breakpoint: `useIsMobile()` and every `@media` agree, CSS for
  layout and the hook only for behaviour. A narrow branch changes the
  furniture, never what a thing is: the same landmark, name, roles and keys
  (`e2e/a11y.spec.ts`). Today a page there is a bottom sheet with three
  heights; the principles say a page fills the phone, and the shell is due to
  follow.

### Sheets beside the list

- **`SideSheet` places itself and `usePanelSheet` does the plumbing**: docked
  beside the panel, or taking the page's place on narrow web, and telling the
  map a sheet is out so its chrome moves (`sidebarSheetOpen`, which names no
  page). A page supplies only the contents.
- **A sheet is for anything tuned by watching the map**: filters, a topo's
  vector style. It is non-modal: the list or map beside it updates live, focus
  moves to its heading on open and back to its button on close, Escape closes
  it. It never opens by itself on arrival, except as a consumed request
  (returning from drawing an area).
- **Every filter wears `FilterField`**: its label, what it is set to, and a
  clear × while set. The control is chosen by the attribute's shape
  (`filterPillStops`, `AttributeFilter`), never by its key.
- **Sort is a preference, filters are ephemeral.** Sort persists in
  `localStorage` and survives a Reset; filters do not.
- **Search sits behind the hero's icon** and takes the title's place on the
  same line; the title stays in the document as the page's heading.

### The map's chrome

- **Two edges, two jobs.** The action edge (right): Layers alone at the top,
  then Tools, 3D, locate and zoom above the credits. The instrument edge
  (left): the compass beside the scale bar, nothing that changes the app.
- **Search is top-left; notices stack beneath it**, centred over the visible
  map, saying only what is true right now ("Showing 42 of 298 places"). A
  notice wider than the visible map overflows rightwards, never over the panel.
- **The compass is a needle**, north half in `warning`, rotated by the
  bearing. Like the scale bar it sits beneath MapLibre's corners so the credits
  draw over it, not under it.
- **Layers → Overlays divides by what a thing IS**: Places, Ways, LiDAR topos.
  Whose a thing is lives on the thing (the shared ring, the shared row mark),
  so ownership never splits a toggle.
- **Layers → Basemap** previews each map in `BASEMAP_CATALOG` order. A stored
  pick no longer offered falls back to the default.
- **Tools share one button and its tray opens sideways**; arming a tool closes
  the tray. A tool the web lacks is absent, not disabled.
- **An armed map tool is a page in the panel**, never a card over the map, so
  every pixel of the map takes a click. Its own settings and edit controls
  (snap, Undo, Reverse, Clear) are in its footer; its body is the same page the
  saved thing shows, so entering and leaving the tool rearranges nothing.
  Leaving discards the draft, so both ways out confirm, and leaving navigates:
  back to the way being edited or the list a new one came from.
- **Chrome is placed from `--map-inset-left`**, derived in CSS from
  `data-panel-open` and `data-sheet-open` on `#map`. Never pass a width from JS.
- **MapLibre's controls are restyled, not re-invented.** Zoom, compass and
  locate are kit buttons on the map's public API; the scale bar and the
  attribution are MapLibre's own, restyled.
- **Map-drawn colours belong to the basemap, not the scheme**: labels, halos
  and line casings use the fixed `MAP_INK` and do not change with Daylight.

## 3. Rows

`Row` is the only list row: a leading tile, title and subtitle, trailing
accessories, and an optional `footer` inside the card.

- **`onOpen` makes the title a real button stretched over the card**, so the
  card opens from anywhere while its tile, marks and ⋯ stay their own controls.
  A button inside a button is invalid.
- **A trailing group with no real control in it stands aside** (`:has()` in
  `Row.module.css`), so a mark beside the title never swallows the card's
  press.
- **Hover responds at once**, with no transition, and only on a row that opens
  or can be picked.
- **Trailing order**: metrics → status marks → ⋯. The mark most rows carry
  goes last, so it holds one column.
- **Unread is `accentEdge`**, an inset edge that never changes the row's size
  and survives selection. Selected is an accent edge and the tile's check.
- **A row that asks a question answers it in its `footer`**: filled button for
  yes, outline for no.
- **A file to download or a page to open is a `Row` with an `href`**, a real
  anchor, so middle-click and "open in a new tab" work. Its subtitle says what
  the press does ("Click to download").
- **The tile's meaning for a sighted reader goes in `description`.**
- **Hovering a row lights its pin; pressing a pin opens the place**, from any
  page.

## 4. Surfaces

- **`Menu`**: verbs behind a trigger, a WAI-ARIA menu button in the top layer.
  Arrows move, Home and End jump, Escape closes and returns focus, Tab leaves,
  an outside press closes. Titled with the thing it acts on.
- **`Popover`**: a non-modal panel beside a control. Escape or its close
  button dismiss it and return focus. Whether an outside press does is the
  caller's call (`dismissOnOutsidePress`): Layers stays open while the map is
  panned; a field's value picker closes. The trigger always toggles. An item
  with more than a switch inside opens a sub-view with a back arrow, never a
  second popover or an accordion.
- **`Dialog`** is the modal for making and changing: a native `<dialog>` with
  `showModal()`, so the browser gives the top layer, the inert page and the
  focus trap. A title and close, a scrolling body, a pinned footer with Cancel
  then the one primary action at the right, separated by space, not hairlines.
  - Focus goes to `data-autofocus` (a form's first field), else the title, and
    returns to the opener. React's `autoFocus` fires too early.
  - Escape, close and a backdrop press dismiss it, none while a request is in
    flight (`dismissible={false}`); a drag that ends on the backdrop is not a
    dismissal. It renders into `document.body` and stops its own Escape.
  - `small` (400) for a confirm or short form, centred at every width; `large`
    (640) for a long form, full screen on narrow web.
  - A form's Save is `type="submit"` tied by `form={formId}`, so Enter saves,
    and it wears `busy` while the request runs.
  - A rail naming the part of a long form you are in is pinned (`toolbar`),
    with anything that acts on the whole form above it.
  - The body and `SideSheet`'s body are `position: relative`, so a visually
    hidden label is clipped by them and not laid out against the page.
  - Anything layered inside a dialog (a lightbox, a menu, a field's own
    Escape) handles its Escape on its own element.
- **`ConfirmDialog`** is an alert dialog described by its body: Cancel, then
  the verb, `destructive` when something is lost and `filled` when nothing is.
  A destructive trigger in a menu stays `danger`, so the warning fill marks only
  the last step.
- **A setting a task rarely changes is a `Row` that opens a sub-view**, with
  its current answer as its subtitle, never an accordion in the body.
- **A caught error is shown in exactly one place, in our words**: pass it
  through `messageFromError(err, "Couldn't save place.")`
  (`src/errors/messageFromError.ts`), then `ErrorBanner` for a failed dialog or
  form submit, `FieldError` under a field, `useToast().error` for a background
  failure. Never render `err.message`: it can carry a place name.
- **Toasts** sit bottom-centre on the inverse surface with a round dismiss.
  They go after 6 seconds, pause on hover or focus (WCAG 2.2.1), and an error
  is `role="alert"`.

## 5. Actions

- **One "add" per page**: a compact filled `Add ▾` in the hero, opening a menu
  of the ways in. Never a footer of ghost buttons.
- **Selection starts from a row's tile**, which is its checkbox
  (`TileCheckbox`): Shift-click selects a range, Ctrl/⌘+A all, Escape clears.
  Rows the user cannot act on dim.
- **`SelectionBar` takes the status rail's slot at the same height**: Clear,
  the count, then only the verbs that are better in bulk, as icon buttons so
  the bar stays one line at 380px.
- **A page's housekeeping verbs are behind the hero's ⋯** (Mark all as read),
  disabled when there is nothing to do.
- **A thing's verbs are declared once** (`placeVerbs` in `placesModel.ts`,
  `wayActions.ts`) and every menu for it renders the same list; the page's
  menu omits Open. A verb that needs a form hands over by opening the page
  with that verb armed (`onOpenWay(way, verb)`).
- **Export and Download are different verbs**: Export writes a file from
  geometry the page holds; Download fetches the stored bytes through the
  egress gate, and is the owner's alone.
- **A verb that edits a thing's geometry belongs to its tool**, not a menu
  (Reverse is beside Undo).
- **Make a map is always enabled**: what fits is said in the next step.

## 6. Kit

The kit is `src/ui`, native elements and CSS modules. Its component list is
`KIT_COMPONENTS` in `@logjam/shared`, the same names Logjam GPS uses.

- **Compose the kit; extend it rather than styling around it.** Screen CSS
  modules do layout; the kit does looks.
- **Native first**: `<button>`, `<dialog>`, `<input type="date">`, the Popover
  API, `matchMedia`. A library needs a behaviour the platform lacks. MUI and
  Emotion are banned by ESLint.
- **Form controls are native elements in one field's clothes**: `TextField`,
  `NumberField`, `Select`, `TextArea` share a sentence-case label, the
  control, an optional `hint` and `FieldError`. A label the control above
  already says is hidden visually and kept as the name (`hideLabel`).
  - `NumberField` types as text and sanitises each keystroke
    (`numberInput.ts`); `LiveNumberField` is a number in force while typed,
    applying only valid values.
  - `Checkbox` is an item in a set; a setting that applies at once is a
    `SwitchRow`.
  - `ChipRail` is the one single-choice control; `ChipPicker` is several
    choices from a vocabulary the user extends.
  - `SwatchPicker` for a closed palette (an identity colour), `ColourField`
    for a free colour with opacity (a topo style). Never a free picker for an
    identity hue: the contrast guard measures closed palettes.
  - `RangeField` is the one slider, for a bounded continuous multiplier.
  - `PlacePicker` wherever a field points at a place: a combobox over
    `placeMatchesSearch`, never a `<select>`, and never the network.
  - `SettingsRow` is a dense settings line: words left, control right, and an
    `InfoTip` button for what the words cannot say.
- **An attribute is drawn by the shape of its definition**, on a form as in
  the filter sheet (`CustomFieldInput`, `railStops`); a rail over an optional
  value starts with "—".
- **A state as a word is a `StatusPill`**, never a `Chip`, which is a control.
- **`Button busy`** swaps the glyph for a spinner and disables without fading.
- **Icon-only controls require a `label`**: the accessible name and the
  tooltip. `Toggle` throws without one.
- **Pure decisions leave the component** into a tested module beside it
  (`placesModel.ts`, `floating.ts`, `rovingFocus.ts`).

### Performance

- **Nothing that changes many times a second is React state above the list.**
  Hover, drag and pointer positions go through a subscribe channel
  (`map/placeHighlight.ts`, `map/routeHover.ts`).
- **On the map, a thing that moves every frame is a `Marker`, never a GeoJSON
  source**: `setData` repaints the whole canvas.
- **Derived data that is a pure function of its input is fetched once, keyed
  by the input** (`elevationCache.ts`).
- **Measure a pointer interaction against a control**: the same drag over an
  inert part of the page is the floor. Over 50ms on hover or typing is a
  defect (a `longtask` PerformanceObserver).
- **A request to open something on arrival is consumed, not counted**, or it
  fires again on every remount.

## 7. Accessibility

WCAG 2.2 AA is the floor.

- **Contrast**: every pair is measured on the surface it renders on
  (`scripts/wcag-contrast.mjs`). Prose links are underlined text-coloured
  words.
- **Patterns, and where they live**: chip rail, a radio group with roving
  focus that nudges a focused chip into view (`Chip.tsx`); menu button,
  popover, side sheet (`Menu.tsx`, `SideSheet.tsx`); dialog and alert dialog
  (`Dialog.tsx`); native checkbox, swatches and select (`Choice.tsx`,
  `TextField.tsx`); combobox with `aria-activedescendant` (`MapSearchBox.tsx`);
  switch named by its title (`Toggle.tsx`); tooltip on hover and focus,
  dismissable and hoverable (`Tooltip.tsx`); row checkbox on the tile.
- **A set of exclusive choices is a named `radiogroup`.**
- **Nothing interactive goes inside a `<label>`.**
- **Escape closes one layer per press** (`useEscape`).
- **Badges are `aria-hidden`**, with the count in the name ("Inbox, 9 unread").
- **Every page has one `h2`**; sections are `h3`. Landmarks: `nav` "Pages",
  an `aside` per panel (the narrow sheet included), `main` for the map.
- **`e2e/a11y.spec.ts` runs axe over every page, dialog and sheet**, including
  narrow cases at 390. A new surface joins it. A case never writes to the
  account: it reaches a state with a `page.route` stub. Narrow a long list
  before walking it, and wait for a fading surface to settle before scanning.
  Axe catches about a third of failures: also check Tab order, focus return,
  Escape at every layer, 200% zoom and 390px by hand.
