# Logjam GPS design

How Logjam GPS applies the [UX principles](../docs/ux-principles.md). Read
those first: they hold every rule both clients share. This file is only what
is particular to a phone in the field: touch, sheets, no signal, a native map.

**Reference implementations.** When a rule here is ambiguous, read these:

- `src/saved/SavedScreen.tsx`: an inventory with a hero, a category rail,
  per-item sheets and multi-select.
- `src/logs/`: records in time order, a filter sheet, a create/edit form in a
  sheet.
- `src/places/`: a collection with two rails, a filter sheet over a shared
  predicate, and verbs shared with the map.
- `src/screens/`: the More hub and its pages, a plain settings list.

A screen Logjam Web also has is drawn from its **screen contract**
(`shared/src/contracts/`): its sections, their order, its verbs and every
word. Render from it, as `PlacesScreen`, `PlaceDetailScreen`,
`TripDetailScreen`, `LogsScreen`, their filter sheets and the verb sheets
(`PlaceOptionsSheet`, `TripOptionsSheet`) do, and change the contract, not the
component.

Change a convention, change this file in the same commit.

## 1. Tokens

`src/theme.ts` reads every token from `@logjam/shared` (`designTokens.ts`,
`themeSchemes.ts`): `theme` holds the active scheme's role colours, beside the
shared `radius`, `spacing(n)` (8 × n), `fontSize`, `controlSize` and
`withAlpha` (`src/themeParity.test.ts` holds them equal to the declaration). Never a hex, never `rgba(255,255,255,…)`: a tint is
`withAlpha(token, a)`.

- **The scheme applies at the next launch, and says so.** `theme` is a module
  constant that ~45 files snapshot into `StyleSheet.create` at import, so a
  running app cannot repaint without a provider and a style factory in every
  one of them. The device's copy paints (read synchronously from `prefsDb`, no
  network); the account's copy follows the user, and `AppShell` mirrors it onto
  the device. The picker shows the choice, with "applies next time" while the
  choice and the painted scheme differ. A device that refuses the write says
  so.
- **Text size multiplies the OS font scale, and the pair is capped at 2×**
  (`clampTextScale`). Type scales; spacing and radius do not. The two map
  instruments size their boxes from `textScale`; nothing else does.
- **Touch targets**: every pressable's visual size plus `hitSlop` reaches
  48dp. `Button` is 48 (compact 40), `IconButton` 40 + `hitSlop`.
- **No shadows.** Depth is the scheme's surfaces; a sheet is the page colour
  sliding up, and the rows on it are cards.
- **`themeMode` (dark or light) drives the status and navigation bars.**
  Colours drawn on the map (labels, halos, casings) are the fixed `MAP_INK`:
  they belong to the basemap, not the scheme. A photo viewer's chrome is fixed
  too: a photo sits on black.

| Role | Token |
|---|---|
| Screen / hero title | `fontSize.xl`, bold |
| Hero metric | `fontSize.lg`, medium (+ `sm` muted suffix) |
| Display metric | `fontSize.display`, only where the number is the whole point of the screen |
| Eyebrow, section header, stat label | `fontSize.xs`, medium, uppercase, `letterSpacing` 0.8–1 |
| Row title | `fontSize.base`, medium |
| Field or control label | `ui/fieldLabel.ts`: `fontSize.sm`, sentence case, `textMuted`; never uppercase (`ui/fieldLabel.test.ts` lists the files that may be) |
| Row subtitle, hint, legend | `fontSize.sm` (`xs` for legends), `textMuted` |

**Radius**: `md` for tiles and inline surfaces; `lg` for cards and rows; `xl`
for sheets; `pill` for anything text-shaped that is not a card. `sm` only for
decorative swatches. No fourth card radius.

A count badge is a fixed box with a radius of exactly half its side
(`ui/pill.ts`), remounted when its chip flips: React Native on Android drops a
view's corner radius when its background changes after layout, and
`radius.pill` makes it worse. Guard: `ui/pill.test.ts`.

## 2. Screens

```
Hero            pinned · the answer + the one "add"
filter rail     pinned · ChipRail, tallies on the chips
list            the only thing that scrolls
BottomSheet     acquisition, per-item verbs, forms
```

- **Set `headerShown: false` and let `Hero` carry the top inset.** A hero on a
  pushed screen owns the back arrow (`Hero onBack`): turning off the native
  header removes the back button too, and the system gesture is not a visible
  way out.
- **A plain form or settings list keeps `Screen`/`ScreenScroll` and the native
  header.** No hero there.
- **Body padding `spacing(2)` across, `spacing(1)` between rows, `spacing(4)`
  at the bottom** for the tab bar. The rail owns a `spacing(1.5)` bottom gap so
  rows scroll against it rather than into it.
- **More's hero is the sync answer** ("Everything's synced · 2 min ago") with
  Sync now: the one screen that can be about the app itself.
- **Settings is a menu of pages split by where a preference is stored**:
  Display, Map, Offline and storage, Privacy and security are on the device;
  Notifications is on the account and states its one reason once. A new
  preference goes on the page its storage already lives on.
- **Places has two rails** (type, then status) because they answer different
  questions; only the type rail says "Any type". Both stay mounted, dimmed and
  inert, while a selection runs.
- **A category may add a narrowing control under the rail** (Saved's name
  search, the waypoint tag rail), always mounted so the rail's height never
  changes, absent only when the tab has no rows to narrow.
- **A sheet with three different subjects gets a rail inside it**
  (`MapLayersSheet`: Basemap, Layers, Offline), never three stacked sections.
- **A list of layers is one row per kind**: glyph, hue, "4 of 4 shown", a
  master switch, and a chevron to its items. A control that is the same for
  every item of a kind belongs to the kind's row.
- **Time-ordered lists use `SectionList` with sticky year or day headers**,
  each with its tally, in the page colour so rows don't ghost through.
- **The sign-in screen leads with the form.** One filled action (Sign in);
  creating an account is outline, continuing without one is ghost. Continuing
  without an account is a state of this screen with three ways out, and a
  one-time question asked after sign-in stores an answer for both buttons.

## 3. The map

The map is the whole screen: no header, no hero, no rail. A search pill, one
column of actions, the instruments, and badges only while true. Gesture and
camera rules are code-level and live in
[ADR 0015](../docs/decisions/0015-mlrn-11-map-interaction-rules.md) and the
comments in `src/map/MapScreen.tsx`; these are the ones a screen designer meets.

- **Two edges, and which is which is the user's** (Settings → Map,
  `mapPreferences.ts`). The action column: layers, locate, the tool group,
  record, attribution. The instrument edge: the native compass, the compass
  tape and the scale bar, nothing that changes the app. The search pill and the
  record button hold the two top corners and flip together.
- **Chrome offsets live in `mapChrome.ts`; `CHROME_BOTTOM` is a constant.**
  Anything that would push chrome around goes in the top notice stack, one
  positioned column.
- **Prefer the native ornament to a JS one** (the compass); the JS scale bar
  follows the camera through a ref, not screen state.
- **A tap asks, a press-and-hold commits.** A tap drops a cursor dot and
  opens what the map knows about that spot (position, elevation, distance and
  bearing from you, navigate, drop a waypoint). A hold offers the things that
  can go there; its sheet and the Settings → Map long-press preference are one
  vocabulary.
- **Only a one-finger drag stops following you.** A pinch while following
  scales (and turns, except in course-up) around your position.
- **The location arrow goes grey when the fix is stale or coarse**
  (`gpsSignal.ts`), and a rate-limited toast says it in words. No accuracy
  halo.
- **A running recording is a light**: the record button pulses, its numbers
  are in a sheet one tap away, a long press finishes it (same confirm), and a
  recorder that is not saving points says so on the map unasked.
- **A tool is a mode with a panel in the notice stack.** Tools share one `+`
  button whose tray opens sideways; arming one closes the tray. A tool's own
  settings live in its panel, not the layers sheet.
- **Measure and route draw are one implementation** (`useRouteDraft`,
  `DraftToolPanel`, `RouteDraftLayer`); what a tool lacks is an absent prop.
  Measure's points are a question asked once (dotted, discarded on exit,
  Clear without a confirm); a route's are work (solid, Save, and both Clear
  and leaving confirm). A drawn thing's properties (direction, colour) are
  edited in its tool, and the tool edits the draft, which Save writes.
- **A tapped handle is selected and its delete rides beside the point**, no
  confirm, undoable.
- **A drawn line shows its direction** with arrows along it above a zoom
  floor; first and last anchors are quietly distinct.
- **An area is framed with edge handles**, not corners; the map moves inside
  the frame.
- **Offline, the map is blank outside your saved regions**
  (`offlineMask.ts`).

## 4. Sheets

`BottomSheet` is the one modal surface. Each rule below was a bug once.

- **The backdrop fades, the sheet slides**; the scrim covers both system
  bars and the sheet runs to the physical bottom edge.
- **The whole sheet drags, not only its handle**: past ~120pt or a flick
  dismisses, less springs back. Content that scrolls drags the sheet once it
  is at its top, in the same gesture; a horizontal gesture inside a sheet
  stays its own. A tap on the handle does nothing, because a drag is discard.
- **A titled sheet draws a × at the top right of its header.**
- **The backdrop is the screen-reader dismiss** (`Close <sheet title>`); the
  handle is hidden from assistive tech. The title is therefore read as part of
  the way out.
- **Never open a second sheet from the first.** Swap the sheet's content (a
  sub-mode) instead, backing out to its parent, with the title naming the
  step. Reset a sub-mode on the sheet's open edge, not only in its close.
- **A choice that leads to a form parks the target and opens the form from
  `onClosed`.** The same for a system window (a permission prompt, a picker):
  never from an open sheet, or it never resolves.
- **Keyboard**: the sheet lifts by the keyboard's measured height (not
  `KeyboardAvoidingView`), and a field takes focus with `.focus()` on the next
  frame, not `autoFocus`.
- **A sheet whose content can outgrow the 80% cap pins its primary action in
  `footer`.**
- **A list of choices is a sheet, not an `Alert`** (Android drops a fourth
  button silently). `Alert` is for destructive confirms only.
- **Toasts report outcomes; one channel per screen.** A background job's toast
  is at the shell (`BackgroundToast.tsx`), never on the screen that started it.
  A form still open when its action fails reports in the form.
- **Long work is a progress card, not a screen**, unless leaving would break
  it: say the cost, don't trap the user.

## 5. Rows, verbs and selection

- **`Row` is the only list row.** Give it `icon` + `hue` when the row has a
  kind; its tile is the hue, solid, with an `onFill` glyph. Trailing order:
  metric → status pill → status marks → inline recovery → ⋯, the most common
  mark last. One `IconButton` per row action, never a bare `Pressable`.
- **`Row`'s `footer` holds the answer to a row that asks a question**
  (accept / decline), and a chart or other full-width content under the row.
- **Every kind has ONE options sheet, mounted by both the map and its list**
  (`RouteOptionsSheet`, `TrackOptionsSheet`, `ImportOptionsSheet`,
  `WaypointSheet`, `PlaceOptionsSheet`); they differ only by "Show on map".
  A verb whose panel fits is a sub-mode of the sheet, never conditional on a
  callback the caller might not pass. A verb that needs the map hands over by a
  nonce'd navigation param.
- **A tapped pin or line opens that sheet**, with Open place first on a place.
- **Verbs and their confirm copy are descriptors** (`saved/assetActions.ts`,
  `PLACE_VERBS` and `placeDeleteConfirm` in `@logjam/shared`); a verb the API refuses is absent from the
  descriptor, so no surface can offer it.
- **One panel for "which place?"** (`usePlacePicker`) and **one for picking
  people** (`useSharePanel`, its promise banner first); extend them, never a
  second picker. Share and Send a copy are dimmed offline, never withheld.
- **Filling a place's one route slot goes through `fillRouteSlot.ts`**, which
  owns what displacing the incumbent costs and confirms at the write.
- **Multi-select starts with press-and-hold**; tap toggles, the last
  deselect ends it. `SelectionBar` takes only the `ChipRail`'s slot at its
  height (`CHIP_RAIL_HEIGHT`); narrowing controls stay mounted, dimmed and
  inert (`pointerEvents="none"`). The bar carries verbs better in bulk, its last
  slot the screen's one irreversible verb (not always delete: unsharing on a
  friend's screen), at most one extra verb per kind of row, a tally per verb on
  the count line. A row the group verb cannot act on is not selectable and
  says why on long press. `SelectionMark` takes the ⋯ button's box.
- **A bulk confirm counts each consequence** (`bulkDeleteConfirm.ts`).
- **The app lock is device-scoped and fail-closed** (`appLockPreference.ts`).

## 6. Forms and errors

- **Edit in a sheet, not in the row**: a field in a list ends up under the
  keyboard.
- **A problem with one control is drawn under it** (`TextField error`,
  `ChipPicker error`, or a bare `FieldError`), and an errored field's edge turns
  `warning`. **A problem with the whole form is an `ErrorBanner` right above
  submit**, in the pinned footer.
- **A requirement shows on submit; a limit shows live.** An error clears when
  its field is edited. A sheet scrolls to the first error out of view.
- **Type-to-confirm (deleting the account) and verbs over a selection are the
  exceptions that disable**: the field or the count says what is wanted.
- **Seeding a form keys on the sheet opening**, not on a prop identity.
- **A destructive action counts what it reaches first** ("12 trips have a
  value…").
- **An unavailable cell in a swipeable grid stays a `Pressable` with a no-op
  press**, so the grid stays swipeable; `accessibilityState` says it is
  unavailable.

## 7. Kit

The kit is `src/ui`, imported only through its barrel. Its component list is
`KIT_COMPONENTS` in `shared/src/kit.ts`, the one list both clients' barrels are
held to (`src/ui/kit.test.ts`): which components Logjam Web has too, and why a
platform-only one is not shared.

- **A card fill means "press me"** (UX §4). `Row` and `StatGrid` sit on `card`
  only when they do something (`onPress`/`onLongPress`; a stat's `onCopy`); a
  read-only one has no fill but the same box. A switch is a `SwitchRow`: the
  whole row is the target and a screen reader meets one `switch`. There is no
  `Card`.
- **A disabled control dims by `opacity.disabled`, does not answer a press and
  says why**: a `Row`'s subtitle, a `Button`'s `disabledReason` (its
  accessibility hint).
- **Icons are ideas: draw `<Icon idea=…>`**, never a Feather or
  MaterialCommunityIcons name (a lint rule stops it). The registry is
  `shared/src/icons.ts`.
- **Map pills are `Notice`**, text centred, on the page colour.

- **Extend a primitive rather than hand-roll a copy** (`Row.icon`,
  `Button.icon`, `ChipRail.scroll`, `StatusPill.icon`). A new kit file only for
  a new shape. One visual, one component: `Chip` is the pill behind `ChipRail`
  and `ChipPicker`.
- **The kit is presentation only.** A shared component that owns permissions,
  file IO or outbox writes is a feature component and lives with its feature
  (`src/media/MediaStrip.tsx`).
- **A long list is a memoised `FlatList`/`SectionList`** with stable render
  callbacks that take the item, and a narrowed `windowSize`.
- **A rail cues its own scroll with an edge fade on whichever side has more**
  (a real gradient), and nudges a cut-off chip into view, never recentres.
- **`ChipPicker` keeps vocabulary order**; a selection whose order matters
  stars its first (`primaryValue`).
- **A bounded range is `RangePills`**, never a slider: a thumb is smaller than
  a fingertip and a drag fights the sheet's own.
- **`DatePicker` is a themed month grid**, one surface for a date and a range.
- **A primitive's `alignSelf` belongs to it; fix the axis where it is used.**
- **A card's border width never changes with state**: Fabric drops the
  children of a rounded `overflow: hidden` card when it does. Change its colour
  instead ([0017](../docs/decisions/0017-inbox-edits-are-outbox-ops.md)).
- **`StatGrid`'s `onCopy` draws its copy glyph by the value.**

## 8. Offline and guests

Reads come from the on-device mirror and writes queue in the outbox, so
almost everything works with no signal and offline is not an error.

- **"Am I offline?"** One `StatusPill` in the hero (`cloud-off`, muted). Never
  a banner, never per row. **"Is my work safe?"** A second pill counts what is
  waiting to sync. On More, the sync sentence replaces both.
- **"What can't I do now?"** Network-only actions are disabled with "Needs a
  connection" where their subtitle would be:

| Works offline | Needs a connection |
|---|---|
| Reading trips, places, notes, fields | Adopting or discarding a value that came in on a copy |
| Logging, editing, deleting a trip | Downloading regions, topo overlays, GeoPDFs |
| Adding, editing, deleting a place | Sharing a place, and reading who it is shared with |
| Attaching photos, videos, routes, tracks | Full-resolution media not yet downloaded |
| Viewing anything already on the phone | Saving a new region (Wi-Fi unless allowed) |
| Every Display, Map, Offline and Privacy preference | Notification preferences |
| Field definitions (they are synced rows) | Username, email, deleting the account |

- **"Needs an account" outranks it.** `src/auth/capabilities.ts` owns the
  guest matrix and is the only place either string is spelled. A screen whose
  data needs an account gates itself (`capabilityScreenBlock`), keeping its
  hero and back arrow over an `EmptyState`, with no fetch fired.
- **A screen whose every action is a local write stays live offline**, and
  rewords what it cannot promise ("Queue it again · It goes up when you have
  signal").
- **Work that happens unasked names its moment and its limit**: app start,
  return to the foreground and regained signal, never a background timer.
  Whether it happens and whether it may use mobile data are two switches
  (`offline/networkPolicy.ts`), and the policy gates only the unasked path:
  Sync now always runs.
- **A screen reached after the first sync shows its empty state on
  `data == null`**, never on `MirrorQueryState.loading`.
- **Not downloaded yet is a state, not an error**, and a tile the provider
  never made is not a failure.

## 9. Privacy on the phone

- **Nothing is autosaved outside the app's own storage**: form state lives in
  component state and leaves only through the outbox.
- **Sync issues never shows a coordinate**, whatever the op holds
  (`previewValue`, `syncIssueDisplay.ts`, tested): it is the screen most likely
  to be screenshotted into a bug report.
- **"Today" is the local day** (`todayDateKey`), though dates are stored as
  UTC midnight.
- **A default name never needs the network or says where an area is**
  (`map/regionName.ts`).
