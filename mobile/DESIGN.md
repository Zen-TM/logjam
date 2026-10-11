# Logjam GPS design

Read [`shared/DESIGN.md`](../shared/DESIGN.md) first: it holds every rule both
clients share. This file is only what a phone in the field changes: touch,
sheets, no signal, a native map. "§" means a section there.

Copy from: `src/ui/` (the kit); `src/places/` (a contract-drawn collection
with rails, a filter sheet and verbs shared with the map);
`src/saved/SavedScreen.tsx` (an inventory with per-item sheets and
multi-select); `src/screens/` (the More hub and plain settings pages).

## 1. Tokens

- **Import tokens from `src/theme.ts`**: `theme` (the scheme's role colours),
  `radius`, `spacing(n)` (8 × n), `fontSize`, `controlSize`; a tint is
  `withAlpha(token, a)`.
- **A scheme change applies at the next launch**, because `theme` is read at
  import. A control that changes it says "applies next time".
- **Type scales with the OS font size (capped at 2×); spacing and radius do
  not.** Never size a box from text scale, except the two map instruments.
- **`Button` is 48 (compact 40); anything drawn smaller reaches 48 with
  `hitSlop`.**
- **No shadows.** A sheet is the page colour sliding up; the rows on it are
  cards.
- **A photo viewer's chrome is fixed**: a photo sits on black.

- **A text style is a role** from `TEXT_ROLES`: `...textRole.<name>`, never
  a `fontSize` and `fontWeight` written by hand.

Radius: `md` tile or inline surface; `lg` card or row; `xl` sheet; `pill`
anything text-shaped that is not a card; `sm` swatch.

## 2. Screens

```
Hero            pinned · the answer + the one "add"
filter rail     pinned · ChipRail, tallies on the chips
list            the only thing that scrolls
BottomSheet     acquisition, per-item verbs, forms
```

- **A screen with a hero sets `headerShown: false`**; `Hero` carries the top
  inset and, on a pushed screen, the back arrow (`onBack`). A plain form or
  settings list keeps `Screen`/`ScreenScroll` and the native header.
- **Body padding is `spacing(2)` across, `spacing(1)` between rows,
  `spacing(4)` at the bottom.**
- **A control under the rail stays mounted** (dimmed and inert during a
  selection), so the rail's height never changes.
- **A sheet with several subjects gets a rail inside it** (`MapLayersSheet`),
  never stacked sections.
- **A list of layers is one row per kind**: glyph, hue, "4 of 4 shown", a
  master switch, a chevron to its items.
- **A time-ordered list is a `SectionList` with sticky year or day headers**
  in the page colour, each with its tally.
- **A long list is a memoised `FlatList`/`SectionList`** with stable render
  callbacks.
- **A preference goes on the Settings page its storage lives on**: device
  (Display, Map, Offline and storage, Privacy and security) or account
  (Notifications).

## 3. The map

The map is the whole screen: a search pill, one column of actions, the
instruments, and badges only while true. Before changing a layer, a press
handler or a camera write, read
[ADR 0015](../docs/decisions/0015-mlrn-11-map-interaction-rules.md).

- **Which edge is which is the user's** (Settings → Map). Read it from
  `mapPreferences.ts`; chrome offsets live in `mapChrome.ts`.
- **Nothing pushes chrome around**: anything new goes in the top notice
  stack, as a `Notice`.
- **A tap drops a cursor and opens what the map knows about the spot; a hold
  offers what can go there.** The hold sheet and the Settings → Map
  long-press preference are one vocabulary.
- **Only a one-finger drag stops following you.**
- **A stale or coarse fix greys the location arrow** (`gpsSignal.ts`). No
  accuracy halo.
- **A running recording is a light**: the record button pulses, its numbers
  are a sheet one tap away, and a recorder that is not saving points says so
  on the map unasked.
- **A tool is a mode with a panel in the notice stack.** Measure and route
  draw are one implementation (`useRouteDraft`, `DraftToolPanel`); what a
  tool lacks is an absent prop. A question asked once (measure) draws dotted
  and clears without a confirm; work (a route) draws solid and confirms.
- **A tapped handle is selected and its delete rides beside the point**, no
  confirm, undoable.
- **A drawn line shows its direction** with arrows above a zoom floor.
- **An area is framed with edge handles**, not corners.

## 4. Sheets

`BottomSheet` is the one modal surface.

- **Never open a second sheet from the first.** Swap the content (a
  sub-mode) and back out to its parent, the title naming the step. Reset a
  sub-mode when the sheet opens, not only when it closes.
- **A choice that leads to a form, a permission prompt or a system picker
  parks the target and opens it from `onClosed`**, or it never resolves.
- **Content that can outgrow the sheet pins its primary action in
  `footer`.**
- **`Alert` is for destructive confirms only**; a list of choices is a sheet.
- **Give every sheet a title**: it draws the × and names the screen-reader
  dismiss.
- **A background job's toast is at the shell** (`BackgroundToast.tsx`),
  never on the screen that started it.
- **Long work is a progress card, not a screen**, unless leaving would break
  it.

## 5. Rows, verbs and selection

- **A row with a kind takes `icon` and `hue`.** One `IconButton` per row
  action, never a bare `Pressable`.
- **Every kind has one options sheet, mounted by both the map and its list**
  (`PlaceOptionsSheet`, `RouteOptionsSheet`, `TrackOptionsSheet`,
  `ImportOptionsSheet`, `WaypointSheet`). A verb whose panel fits is a
  sub-mode of the sheet; a verb that needs the map hands over by a nonce'd
  navigation param.
- **A tapped pin or line opens that sheet**, Open place first on a place.
- **One picker for "which place?"** (`usePlacePicker`) **and one for
  people** (`useSharePanel`). Extend them.
- **Share and Send a copy are dimmed offline, never withheld.**
- **Filling a place's route slot goes through `fillRouteSlot.ts`**, which
  confirms what displacing the incumbent costs.
- **Multi-select starts with press-and-hold**; tap toggles, the last
  deselect ends it. The bar's last slot is the screen's one irreversible
  verb. A row the verb cannot act on is not selectable and says why on long
  press.
- **A bulk confirm counts each consequence** (`bulkDeleteConfirm.ts`).

## 6. Forms

- **Edit in a sheet, not in the row**: a field in a list ends up under the
  keyboard.
- **A form is a `FormStack` of `Field`s** (`TextField` is one). A form
  sets no `gap` of its own.
- **One control's problem is its `error` prop; the whole form's is an
  `ErrorBanner` above submit**, in the pinned footer. The sheet scrolls to
  the first error out of view.
- **Seed a form when its sheet opens**, not on a prop's identity.
- **A bounded range is `RangePills`, never a slider**: a thumb is smaller
  than a fingertip and its drag fights the sheet's.
- **`DatePicker` for a date or a range.**
- **An unavailable cell in a swipeable grid stays a `Pressable` with a no-op
  press**, so the grid still swipes.

## 7. Kit gotchas

- **Import the kit only through its barrel** (`src/ui`).
- **A card's border width never changes with state**: Fabric drops the
  children of a rounded `overflow: hidden` card. Change its colour.
- **A view whose background changes after layout loses its corner radius on
  Android.** Remount it (`ui/pill.ts`).
- **A primitive's `alignSelf` belongs to it**; fix the axis where it is used.
- **A rail cues its own scroll with an edge fade** and nudges a cut-off chip
  into view, never recentres.
- **`ChipPicker` keeps vocabulary order**; a selection whose order matters
  stars its first (`primaryValue`).

## 8. Offline and guests

Reads come from the on-device mirror and writes queue in the outbox.

- **Offline is one muted `StatusPill` in the hero**; a second counts what is
  waiting to sync (`SyncStatusPills`). Never a banner, never per row.
- **A network-only action is disabled with "Needs a connection" as its
  subtitle.** These need a connection: downloading regions, topos and
  GeoPDFs; sharing and reading who a place is shared with; adopting or
  discarding a value from a copy; full-resolution media not yet on the
  phone; notification preferences; username, email, deleting the account.
  Everything else works offline.
- **`src/auth/capabilities.ts` owns the guest matrix and both strings.** A
  screen whose data needs an account gates itself with
  `capabilityScreenBlock`: hero and back arrow over an `EmptyState`, no
  fetch.
- **A screen whose every action is a local write stays live offline** and
  rewords what it cannot promise ("It goes up when you have signal").
- **Unasked work runs only at app start, on return to the foreground and on
  regained signal**, never on a timer, and goes through
  `offline/networkPolicy.ts`. Sync now always runs.
- **Show an empty state on `data == null`**, never on
  `MirrorQueryState.loading`.
- **Not downloaded yet is a state, not an error.**

## 9. Privacy on the phone

- **Form state lives in component state and leaves only through the
  outbox**: nothing is autosaved outside the app's storage.
- **Sync issues never shows a coordinate** (`syncIssueDisplay.ts`): it is the
  screen most likely to be screenshotted into a bug report.
- **"Today" is the local day** (`todayDateKey`).
- **A default name never needs the network or says where an area is**
  (`map/regionName.ts`).
