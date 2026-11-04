# Logjam Web design

Read [`shared/DESIGN.md`](../shared/DESIGN.md) first: it holds every rule both
clients share. This file is only what a browser, a mouse, a keyboard and a
big screen change. "§" means a section there.

Copy from: `src/ui/` (the kit); `PlacesPanel.tsx` with `PlaceFilterSheet.tsx`
(a contract-drawn page with a hero, rails, a sheet, selection and verbs);
`NavRail.tsx`, `SidebarPanel.tsx`, `map/MapChrome.tsx` (the shell).

## 1. Tokens

- **Every colour, space, size, radius, duration and text size is a custom
  property**: `--color-<role>`, `--hue-<kind>`, `--space-<n>` (8 × n),
  `--radius-*`, `--font-*`, `--control-*`, `--motion-*`. They are generated
  from `@logjam/shared` by `npm run tokens`; layout values of the web's own
  (rail and panel widths, shadows) are in `src/index.css`.
- **A px literal only for** a 1–2px border or offset, the 768px breakpoint,
  and a shape's own geometry marked `/* intrinsic … */`.
- **CSS modules only.** An inline `style` sets a computed value, and a
  colour in it is a custom property the kit reads (`--tile-hue`,
  `--chip-hue`).
- **Heights are `min-height` and type is `rem`**, so text can grow. 12px is
  the floor.
- **Targets follow the pointer, not the width**: `@media (pointer: coarse)`
  gets Logjam GPS's sizes.
- **Depth is the scheme's surfaces and hairlines.** A shadow only on things
  floating over the map (`--shadow-float`, `--shadow-modal`).
- **`--radius-full` is a circle on a square box only**; anything
  stadium-shaped is `--radius-pill`.

- **A text style is a role** from `TEXT_ROLES`: `composes: <role> from
  "…/textRoles.generated.module.css"`, never a `font-size` or `font-weight`
  written by hand (`textRoles.test.ts`). Put one role on an element; a
  variant that changes the role is its own class. The roles are the one
  list in `shared/src/designTokens.ts`; the colour of a text is the
  element's own, never the role's.

Radius: `sm` swatch or checkbox; `md` tile, icon button, menu item, field;
`lg` row, card, map button; `xl` popover, sheet; `pill` anything text-shaped
that is not a card.

## 2. The shell

```
rail │ panel 380              │ sheet 380 (optional)  │ map
     │ hero          pinned   │ Sort and filter       │ search ─ notices    Layers
     │ rails         pinned   │ …scrolls…             │
     │ list          scrolls  │ footer: count · Done  │ compass · scale    tools …
```

- **A page is a panel beside the map.** The panel body neither scrolls nor
  pads; the page pins its hero and rails and scrolls its own list.
- **`Hero` draws the title, the back arrow (`onBack`) and the panel's ×**; a
  panel never makes its own. Every hero is the same height, so switching
  views never moves the rail under it.
- **A page with two views swaps them under one chip rail**, the first under
  the hero. A view reached from the page (Trips → Stats, by a hero icon) or a
  step inside a view opens in place with `Hero onBack`; focus goes to the arrow on the way in and to the opened row on the
  way out.
- **One "add" per page**: a compact filled `Add ▾` in the hero, opening a
  menu. A page's housekeeping verbs (Mark all as read) are behind the hero's
  ⋯. A list's search bar sits under its rail (`shared/DESIGN.md` §2).
- **Narrow web (≤768px) is Logjam GPS's tab bar, less its Map tab.** Places,
  Trips, Ways, Plans, then More. A page is a sheet over the map, so closing it
  is how a user gets back to the map, and a tab for it would be a second way to
  do the same thing. Logjam GPS keeps one because its pages fill the screen.
  One breakpoint: `useIsMobile()` for behaviour, `@media` for layout. A narrow
  branch changes the furniture, never a thing's landmark, name, roles or keys.
- **A narrow sheet has two heights, half (a bit under half the screen) and
  full, and a way out.** Swiping it down from half closes it, as its × does.
  It is dragged by its grab bar (a hit area at least 44px tall) or by a pull
  down anywhere on a page that is scrolled to its top, as on Logjam GPS. There
  is no peek to rest at: it showed a title and nothing to read.
- **Chrome over the map is placed from `--map-inset-left`** (CSS, from
  `data-panel-open` and `data-sheet-open`). Never pass a width from JS.
- **An armed map tool is a page in the panel**, never a card over the map.
  Its settings and edit controls (snap, Undo, Reverse, Clear) are in its
  footer. Leaving a draft that would be kept (a route) confirms on every way
  out; a measurement is not kept, so leaving it asks nothing.
  Narrow, its sheet opens at the peek (the note, the distance and Undo:
  `DraftPeek`) so the map is there to press; dragging it up brings back the
  rest. The peek is only for a tool, or a map flow that holds the sheet there:
  a swipe never closes it, because the × asks first.
- **MapLibre's controls are restyled, not rebuilt**: kit buttons on the map's
  public API; the scale bar and attribution stay MapLibre's.
- **Hovering a row lights its pin; pressing a pin opens the place**, from any
  page.

### Sheets beside the list

- **`SideSheet` with `usePanelSheet`** docks beside the panel (or takes the
  page's place when narrow) and tells the map to move its chrome. A page
  supplies only the contents.
- **A side sheet is for anything tuned while watching the map** (filters, a
  topo's style). It is non-modal and never opens by itself on arrival.
- **Every filter wears `FilterField`**, and its control follows the shape of
  the attribute (`AttributeFilter`), never its key.

## 3. Surfaces and actions

- **`Dialog`** for making and changing: `small` for a confirm or short form,
  `large` for a long one. Footer: Cancel, then the one primary action. Save
  is `type="submit"` tied by `form={formId}` and wears `busy`; pass
  `dismissible={false}` while a request runs. First focus is the element
  marked `data-autofocus`. A dialog for reading (a maintainer message) has no
  footer; its × closes it.
- **`ConfirmDialog`**: `destructive` when something is lost, `filled` when
  nothing is. The menu item that leads to it is `danger`, without the fill.
- **`Popover`** is non-modal. Whether an outside press closes it is the
  caller's call, and Layers and a value picker both close (so does the Tools
  tray); a press on the map closes them too. More than a switch inside opens a sub-view, never a second popover
  or an accordion. The map point panels (the tap panel and the right-click
  menu) are the exception to the × (shared/DESIGN.md §3): no ×, a press on the
  map outside one closes it and is swallowed (`swallowWithin`), a press on any
  other control closes it and still acts, and Escape undoes one layer.
- **`Menu`** is titled with the thing it acts on.
- **A setting a task rarely changes is a `Row` that opens a sub-view**, its
  current answer as the subtitle. Inside a `Dialog`, two views of one thing
  are a `ChipRail` that swaps the view under it (Coordinates' Lat/Lon · E/N),
  never a disclosure. Two _ways of entering_ one thing are not views: Export
  an area's Area row has Pick on the map, an action that leaves the dialog
  for the map, beside Type the coordinates, which opens the edges beneath the
  row. Both take the filled look when they hold the answer (Pick once the
  area was drawn on the map, Type while the edges are open). An area picker
  with only the map way (Sharpen an area) is a single button.
- **A caught error goes through `messageFromError(err, "Couldn't save
  place.")`**, then `ErrorBanner` (a form still open), `FieldError` (one
  field) or `useToast().error` (background).
- **Selection starts from a row's tile**, which is its checkbox: Shift-click
  ranges, Ctrl/⌘+A selects all, Escape clears. Rows the verb cannot act on
  dim. `SelectionBar` verbs are icon buttons, so it stays one line at 380.
- **Export writes a file from geometry the page holds; Download fetches the
  stored bytes** and is the owner's alone. Never one word for both.
- **A verb that edits geometry belongs to its tool**, not a menu.
- **A verb that needs a form opens the page with that verb armed**
  (`onOpenWay(way, verb)`).
- **A file to download or a page to open is a `Row` with an `href`**, a real
  anchor, so middle-click works.

## 4. Kit

- **Native first**: `<button>`, `<dialog>`, `<input type="date">`, the
  Popover API. A library only for a behaviour the platform lacks.
- **`onOpen` makes a `Row`'s title a button stretched over the card.** Never
  nest a button in a button; the tile, marks and ⋯ stay their own controls.
- **Pick the control by the job**:

| Job                                                                                                                                           | Component                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| One choice from a few                                                                                                                         | `ChipRail`                                                                  |
| Several from a vocabulary the user extends, or from a short parallel set with no field of its own (Terrain, Overlays)                         | `ChipPicker`                                                                |
| An item in a set that carries a field or needs a sentence of its own / a setting that applies at once / one that applies at once over the map | `Checkbox` / `SwitchRow` / `Checkbox card`                                  |
| A colour                                                                                                                                      | `ColourField`: `palette` for an identity hue, free only for the slope scale |
| A field that points at a place                                                                                                                | `PlacePicker`, never a `<select>` or the network                            |
| A dense settings line                                                                                                                         | `SettingsRow`, with `InfoTip` for what the words cannot say                 |
| A state as a word                                                                                                                             | `StatusPill`, never a `Chip`                                                |
| A list's closing add button                                                                                                                   | `ListEnd`, fed the empty state's button                                     |
| Loading / failed load                                                                                                                         | `LoadingState` / `ErrorState`                                               |

- **A chip has no note of its own**: what a set needs said goes in the group's
  `hint`, and why a chip is off is that hint too (`disabled` chip, reason in
  the hint). An item that needs a sentence beside it is a `Checkbox`.

- **A label the control above already says is hidden with `hideLabel`**,
  not removed.
- **A screen stylesheet lays out and paints no corner, shadow or fill**:
  `lookBudget.test.ts` holds each file to a budget that only shrinks.
- **A disabled control stays focusable**: `disabledReason` is required by type.
- **Pure decisions leave the component** into a tested module beside it
  (`placesModel.ts`).

### Performance

- **Nothing that changes many times a second is React state above a list**:
  hover and drag go through a subscribe channel (`map/placeHighlight.ts`).
- **A thing that moves every frame on the map is a `Marker`**, never a
  GeoJSON source: `setData` repaints the canvas.
- **Over 50ms on hover or typing is a defect.**
- **A request to open something on arrival is consumed**, or it fires again
  on every remount.

## 5. Accessibility

WCAG 2.2 AA is the floor.

- **Copy the pattern from the kit file that has it**: radio group with roving
  focus (`Chip.tsx`), menu button (`Menu.tsx`), dialog (`Dialog.tsx`),
  combobox (`MapSearchBox.tsx`), switch (`Toggle.tsx`), tooltip
  (`Tooltip.tsx`).
- **Escape closes one layer per press** (`useEscape`); anything layered
  inside a dialog handles Escape on its own element.
- **A list of `Row`s is a `RowList`: one tab stop** (`useListKeys`, wired once
  in `SidebarPanel`; the page opts in by drawing its rows in one, and a test
  per page holds it). Up/Down, Home and End move between rows, Enter opens,
  Space ticks the tile (Shift+Space a range) and says so, Shift+F10 or the
  context-menu key opens the row's actions; the list is a `list` that says so.
  "Skip to panel" comes before "Skip to map".
- **A page with a back arrow is left by Escape** (`usePanelFocus`): the same as
  pressing the arrow, never from inside a text field. Focus goes to the arrow
  on the way in and to the row that was opened on the way back (the next row
  after a delete). Escape also lifts an armed Measure or Draw tool.
- **Nothing interactive inside a `<label>`.** Exclusive choices are a named
  `radiogroup`.
- **A badge is `aria-hidden`, its count in the name** ("Inbox, 9 unread").
- **One `h2` per page; sections are `h3`.** Landmarks: `nav`, an `aside` per
  panel, `main` for the map.
- **Prose links are underlined, text-coloured words.**
- **A new page, dialog or sheet joins `e2e/a11y.spec.ts`**, with a narrow
  case. Axe catches about a third: also check Tab order, focus return,
  Escape at each layer, 200% zoom and 390px by hand.
