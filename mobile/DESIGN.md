# Mobile design conventions

The house style for the Logjam RN app. **Reference implementations:
`src/saved/SavedScreen.tsx`** (inventory: hero metric, categories, per-item
actions) and **`src/logs/`** (records: chronology, multi-axis filtering, a
create/edit form in a sheet). When a rule here is ambiguous, read those.

Scope: this supersedes the earlier "everything is a `Card` in a stack of
`SectionHeader` groups" pattern still present on some screens. Rebuild screens
onto these rules as they are touched; don't do a sweeping mechanical pass.

**Keep this file current.** Changing a convention means changing this file in
the same commit as the code.

---

## 1. The one question a screen answers

Every screen leads with the single question its user actually opened it to
answer, and answers it before any list appears.

- Saved → "what have I actually got on this phone, and what is it costing me?"
- A canyon → "what am I walking into?"
- Logs → "what have I done?" (a count, a twelve-month activity spark, a
  chronological list)
- A trip → "what did I do that day?"

That answer is the **hero**, not a title bar. A screen whose top edge is a
generic label with content dumped underneath is the pattern being replaced.

But the hero is a *frame*, not a billboard: size it to how much the user came
for it. Saved's storage figure earns a line and a meter, not display type —
people open Saved to manage assets, not to read a number. Restraint here is the
difference between an informative header and a dashboard nobody asked for.

## 2. Layout skeleton

```
HeroHeader          pinned · headline state + primary "add/create" action
filter rail         pinned · SegmentedControl scroll — categories with tallies
ScrollView          the inventory; only this moves
BottomSheet(s)      acquisition + per-item actions
```

- **Pin the hero and the rail, scroll only the list.** The filter you are
  working in must never scroll out of reach. Set `headerShown: false` on the
  route; `HeroHeader` carries its own top safe-area inset.
- Body padding `spacing(2)` horizontal, `spacing(1)` gap between rows,
  `spacing(4)` bottom (tab bar clearance).
- The rail owns a `spacing(1.5)` bottom pad: that gap is what the list scrolls
  *against*. Without it, rows slide flush into the chips and the two layers read
  as one.
- Screens that are genuinely a plain form or a settings list keep
  `Screen`/`ScreenScroll` + the native header. Don't force a hero onto them.
- **A hero on a pushed screen owns the back button** (`HeroHeader.onBack`).
  Turning off the native header removes the back affordance too, and the
  swipe/hardware gesture is not a visible way out.

### Chrome stays constant; secondary filters stay collapsed

Pinned chrome is a tax on every scroll, so a screen gets ONE pinned filter axis
— the one you flick between (Saved: category; Logs: activity type). Precise
filters (free text, a date range) hide behind a hero `IconButton` that reveals
them **in a slot the hero already occupies**: Logs swaps the activity spark for
the search row, so opening search doesn't shove the list down, and the spark —
retrospective decoration — isn't competing with a hunt for one trip.

An active hidden filter must announce itself: the reveal button renders
`filled`, and a set date range gets a dismissible summary strip above the list.
A filter you can't see is a bug report waiting to happen.

### Chronological lists group by time

Filters replace *category* sections (above), not date headers. A record list
gets a sticky year header carrying its own tally ("2025 · 16 trips"): it is an
ordering aid inside one filtered list, not a second way to pick a subset. Use
`SectionList` so the header stays pinned while its own rows pass under it, and
give the header the page colour so rows don't ghost through it.

### Filters over stacked sections

Mixed content types get a **filter rail**, not a stack of `SectionHeader`
groups and not a dropdown. A rail is one tap (a dropdown is two, and hides the
tallies), it shows what exists before you touch it, and it keeps a long screen
one screen tall.

- The first chip is **All**, a flat list across every category.
- Sort "All" by the axis the hero implies. On Saved the hero is storage, so All
  is size-descending — the order that answers "what do I delete". Inside a
  single category, registry/insertion order wins.
- A `SectionHeader` still earns its place for a **different kind of list** in
  the same view (Saved: "Available to download" — things *not* on the device,
  scoped to that one filter so All stays a true inventory).

## 3. Category identity — glyph + hue

Anything with kinds gets a per-kind hue and glyph from a single map
(`CATEGORY_META` + `assetHue`), used in **all four** places: the row's icon
tile, its filter chip when active, its `CapacityBar` segment, and its entry in
the add sheet. That repetition is what makes a mixed list scannable, and it
means a new kind is one object literal, not a design decision.

`assetHue` (in `src/theme.ts`) is deliberately **scheme-independent** — a kind
is what it is regardless of the user's theme, and remapping the hues per scheme
would collapse them into that scheme's narrow range. All four schemes are dark,
so mid-light muted hues work on every one. New hues: mid-light, muted, drawn
from the NSW canyon palette (rock, scrub, water, heath). Never a saturated web
primary.

`region` intentionally aliases the active scheme's `accent`, so the biggest and
most common class always feels native to the chosen theme.

### Open vocabularies hash their hue from the label

Some "kinds" aren't a fixed set — trip types are a seed list the user extends
with free text. Those can't have an exhaustive map, so (see
`src/logs/tripTypeMeta.ts`):

- The **seeded** entries get a fixed identity, and the canonical one
  (`canyoning`) takes the scheme accent, exactly as `assetHue.region` does.
- **User-typed** entries hash the LABEL into a fixed palette — never an index
  into a sorted list, which would repaint every custom kind the moment another
  one sorts ahead of it. Hashing keeps a colour stable across sessions,
  reorderings and devices.
- A record with several kinds is represented by its **first** (the user's own
  ordering), so a picker that reorders selected chips must order them by
  selection, not by vocabulary — otherwise the row's glyph changes for reasons
  the user can't see.
- Stored casing is the user's own; capitalise for display only
  (`tripTypeLabel`). Writing the display form back creates exactly the
  case-variant duplicate the API rejects.

### Tallies answer "what would I get", and empty chips stay put

A filter chip's count is computed with **every axis except its own** applied, so
it predicts the result of tapping it rather than restating the current view. A
chip the other axes have emptied is rendered `disabled` — still in place, but
not a tap into a dead end. Never remove it: a rail that reshuffles under the
thumb on every keystroke is worse than a greyed chip. Same rule for the
synthetic buckets ("No type"): existence comes from the whole set, the count
from the other axes.

## 4. Type, shape, depth

| Role | Token |
|---|---|
| Screen/hero title | `fontSize.xl` / `bold` — the dominant element |
| Hero metric | `fontSize.lg` / `medium` (+ `sm` muted suffix) |
| Display metric | `fontSize.display` — **only** on a screen whose whole purpose IS the number. Saved's storage figure is context, not the point, so it does not get this |
| Eyebrow, section header, stat label | `fontSize.xs` / `medium` / uppercase / `letterSpacing` 0.8-1 |
| Row title | `fontSize.base` / `medium` |
| Row subtitle, hint, legend | `fontSize.sm` (`xs` for legend/size chips) / `textMuted` |

**Radius:** `md` (8) for icon tiles and inline surfaces · `lg` (12) for content
cards and rows · `xl` (16) for sheets and the hero's bottom corners · `pill`
for everything text-shaped that isn't a card — buttons, chips, status pills,
meters, badges. Do not introduce a fourth card radius.

**Depth (no shadows, no white-alpha overlays — everything from scheme tokens):**

```
theme.bonus2     hero, toasts    lightest
theme.secondary  cards / rows    surface.card
theme.primary    page, sheets    darkest
```

A sheet uses the **page** colour, not a lighter one: rows inside it are
`surface.card`, which must stay lighter than what they sit on. It also means a
sheet reads as the page sliding up rather than a foreign panel.

Tints come from `withAlpha(hex, a)` on a scheme token or asset hue — icon tile
at `0.16`, meter track and badge at `0.10-0.12`, hero hairline at `0.25`.
Never hardcode `rgba(255,255,255,…)`.

## 5. Rows

`Row` is the only list-row component. Give it `icon` + `hue` (not a bare
`leading` node) whenever the row has a kind. Trailing order, left to right:
**size/metric → status pill → inline recovery action → overflow `⋯`**.

- One tap target per row action, `IconButton` (40pt + `hitSlop`) — never a bare
  `Pressable` around a glyph, and never an icon without an
  `accessibilityLabel`.
- In-flight work uses `Row`'s `progress` bar on the row itself; a single
  exclusive operation with no row of its own gets one "active operation" `Row`
  pinned above the list, carrying label, percent and cancel.

## 6. Sheets, motion, and toasts

**Sheets** (`BottomSheet`) are the app's one modal surface. Non-negotiables,
because each was a bug once:

- The **backdrop fades, the sheet slides.** RN's `animationType="slide"`
  animates the whole modal, dragging the scrim up from the bottom — one moving
  slab instead of a dimming screen.
- The scrim covers **both system bars** (`statusBarTranslucent` +
  `navigationBarTranslucent`), and the sheet's own padding carries
  `insets.bottom` so its surface runs to the physical bottom edge. A sheet that
  stops on the tab bar leaves a stripe of the wrong colour.
- **The handle drags.** Down past ~120pt (or a flick) dismisses; less springs
  back. A grab handle that ignores a grab is worse than no handle.
- The sheet is **keyboard-aware** (`KeyboardAvoidingView`, and it drops its
  bottom safe-area inset while the keyboard is up — the keyboard already covers
  the nav bar, so keeping it leaves a dead band under the form). That makes a
  sheet the right home for a short form: a text field inline in a list ends up
  under the keyboard whenever its row sits low on screen. **Edit in a sheet, not
  in the row.**
- **Never open a second sheet from the first.** Swap the open sheet's *content*
  instead (see `menuMode` in SavedScreen: the item's action list becomes the
  rename form in place). Two Modals overlapping is not just a motion nit — the
  incoming window doesn't hold focus while the outgoing one animates away, so
  `focus()` claims RN focus without raising the keyboard, and a later retry is a
  no-op on an already-focused input. One sheet also means one animation: the
  user's tap produces a single motion instead of a settle-then-jump.
- A field in a sheet takes `inputRef` + `.focus()` on the next frame
  (`requestAnimationFrame`), **not** `autoFocus`, which runs before attach. With
  the sheet already open and focused, the keyboard then rises *with* the form
  appearing.
- **Keyboard offset is measured, not delegated.** The sheet lifts by the
  keyboard's own reported height; it does not use `KeyboardAvoidingView`. KAV's
  `height` behavior shrinks its own frame, and a sheet that MOUNTS while the IME
  is already up inherits the shrunk frame and never gets it back — it then
  floats a nav-bar's height off the screen edge with a stripe of tab bar showing
  underneath. (`Keyboard.dismiss()` before opening is not a fix: dismissal is
  async, so the sheet still mounts into the shrunk frame.)
- **A sheet whose content can outgrow the 80% cap puts its primary action in
  `footer`**, pinned below the scroll area. A Done button that scrolls away
  behind a long list leaves the handle as the only exit — and the handle means
  *discard*, not *done*.
- **A sub-mode backs out to its parent, not out of the sheet.** When a sheet
  swaps content (form → date picker → canyon picker), route the drag and the
  backdrop tap to "return to the form" while a sub-mode is open. Otherwise the
  gesture that means "go back one step" throws away everything the user typed.
  The sheet's title changes with the mode, so which step you are on is never a
  guess.

**A list of choices is a sheet, not an `Alert`.** Android's Alert caps at three
buttons and drops the rest silently — that is how "Take photo" shipped
unreachable behind a three-option Alert. `Alert` is for destructive confirms
(where the copy is the point) and nothing else; anything with glyphs, subtitles
or a sub-step is a sheet.

**Toasts** (`Toast`), not inline banners, for the outcome of an action: an
inline card reflows the list under the user's thumb and then lingers with no
owner. One toast channel per screen, `{ text, tone, nonce }`; errors stay up
longer than confirmations. An error that is *state* rather than an event (a
failed background fetch whose data the current filter needs) stays inline as a
row with a retry — it persists because the problem persists.

## 7. Actions

- **One primary acquisition affordance per screen** — a labelled compact
  `Button` in the hero (`+ Add`), opening a `BottomSheet` of the ways in. Not
  three or four outline buttons scattered between sections. Each sheet entry is
  a `Row` with its category glyph/hue and a verb title.
- **Per-item actions live in an overflow sheet**, titled with the item's name.
  Rows stay clean and a mis-tap can't destroy anything.
- **Every asset gets the same three verbs** where they apply: *show on map*,
  *rename*, *delete*. Uniformity is the feature — a user should never have to
  learn which kinds happen to support which action. Renaming is display-only
  (`label` overrides the derived name; resolution still keys off ids), so it is
  cheap to extend to a new kind.
- **Destructive actions confirm in a dialog**, which carries the explanation.
  The sheet entry itself is just the verb ("Delete from device") — consequence
  copy in a menu row only ellipsises.
- **No explanatory subtitles on actions.** A glyph plus a verb ("Show on map",
  "Rename") is the whole affordance; if it needs a sentence to be understood,
  the label or the icon is wrong. Reserve subtitles for entries where something
  genuinely non-obvious happens — a multi-step flow ("Pick an area on the map,
  then save its tiles"), or where the input comes from ("From this phone's
  storage or a download"). Default to none.
- **Adding content switches to its category** so the new row is visible, and the
  rail scrolls the active chip into view — otherwise the list silently filters
  while the chip that explains why is off-screen. Acting on an *existing* item
  does not: yanking the user to another filter to rename something they were
  already looking at is a non-sequitur.
- **Open editors don't outlive their context.** Changing filter or leaving the
  tab drops an in-progress rename — a form that survives the thing it was
  editing being scrolled out of view is a stale prompt, not a resumed task.
- **One form per entity, create and edit.** `TripEditSheet` is the same
  component in both modes: same fields, same validation, same derived-title
  preview, with only the sheet title and the submit label differing. Two forms
  drift, and the one the user reaches less often is the one that rots.
- **An edit pushes only the fields that changed.** Diff against the entity you
  seeded from and send the difference (see `save()` in `TripEditSheet`). Sending
  the whole form makes every save a write to every column, which under
  field-scoped LWW clobbers a concurrent edit to a field the user never touched.
- **Definitions are online, values are offline.** A trip's field VALUES queue
  through the outbox like everything else, but the field DEFINITIONS live in an
  account-level preference blob the web and every device share, so editing them
  requires a connection and says so when it fails. Queuing an offline edit to a
  shared list would need merge rules for a list the user could be reordering in
  a browser at the same time.
- **A destructive action reports the part the user can't see.** Deleting a
  custom field also clears its value from every trip that had one, so the
  confirm asks the server for that count first and puts it in the dialog
  ("12 trips have a value…"), rather than discovering it afterwards.
- **A chart is not an affordance.** `ActivitySpark` is deliberately
  non-interactive because it exposes no filter — same rule as the drag handle,
  read the other way: don't render something that looks tappable unless it is.

## 8. States

- **Empty states are per-filter and actionable.** Name the thing that is
  missing, say why it matters *in the field*, offer the action that fixes it.
  A shared grey "nothing here" is not acceptable; nor is a muted one-liner
  hanging under a section header.
- **One notice channel per screen** — see §6. Four independent status lines,
  each owning its own corner, is the anti-pattern.
- Background fetches report failure **inside the filter that needs the data**
  (with a retry), not as a screen-level error. Never swallow it entirely.
- **Report the true cost of a thing.** A saved asset's size is everything it put
  on disk — an imported GeoPDF is its source file *plus* the tiles rendered from
  it, which is the larger half. A storage figure that quietly omits a component
  is worse than no figure.
- Connectivity is a `StatusPill` in the hero when offline, and it disables
  network actions — it does not hide them.

## 9. Kit rules

Screens import from the barrel `../ui`, never from a component file. When a
screen needs a variation, **extend the primitive** (`Row.icon`, `Button.icon`,
`SegmentedControl.scroll`, `StatusPill.icon`) rather than hand-rolling a local
copy — a hand-rolled row is how the last drift started. Add a new kit file only
for a genuinely new shape (`CapacityBar`, `HeroHeader`).

**A long list is a `SectionList`/`FlatList` with stable render callbacks and a
narrowed window.** An inline `renderItem={({item}) => …}` arrow is a new
function identity every render, which makes VirtualizedList re-render every
mounted cell — and the default `windowSize` of 21 screens means "every mounted
cell" is the whole list. Memoise the row component, hand it callbacks that take
the item rather than closing over it, and set `windowSize`/`initialNumToRender`
to something near what fits. This was the whole of the Logs screen's
sluggishness: tapping the search icon re-rendered 115 rows to change one chip.

A rail cues its own scrollability: **either** edge dissolves into the page
colour when there is content past it (`SegmentedControl`'s `EdgeFade`, an
`expo-linear-gradient` fade to `theme.primary`, `spacing(6)` wide). Both sides,
driven by scroll offset — a fade on only one end still leaves a hard-sliced chip
at the other, and a fade shown at rest dims a chip with nothing behind it. Use a
real gradient for any fade; stacked alpha steps band visibly.

**One visual, one component.** `Chip` is the single pill primitive behind both
`SegmentedControl` (single-select rail) and `ChipPicker` (multi-select
vocabulary); `MediaStrip` is the single photo surface behind both detail
screens. When a second screen needs something the first already draws, lift it
into the kit rather than copying the styles — two stylesheets for one visual is
the drift itself, not a risk of it.

Native pickers are not automatically the lazy option. `DatePicker` is a themed
month grid rather than the Android dialog because a trip log needs the same
picker for one date and for both ends of a range: the OS dialog can't be tinted
to the scheme and would put two or three different-looking pickers on one
screen. One themed surface, reused three times, no native dependency.

The kit is presentation only. A shared component that owns permissions, file
IO or outbox writes is a FEATURE component and lives with its feature
(`src/media/MediaStrip.tsx`), even when two screens use it — otherwise `src/ui`
slowly becomes the place everything shared goes.

Current kit: `ActivitySpark` · `BottomSheet` · `Button` · `CapacityBar` ·
`Card` · `Chip` · `ChipPicker` · `DatePicker` · `EntityEditForm` ·
`ErrorBanner` · `HeroHeader` · `IconButton` · `Row` ·
`Screen`/`ScreenScroll` · `ScreenStates` · `SectionHeader` ·
`SegmentedControl` · `StatGrid` · `StatusPill` · `TextField` · `Toast` ·
`Toggle`.

## 10. Privacy in the UI

A design constraint, not a checklist item (see `CLAUDE.md`). Rows show generic
labels ("Offline map region"), user-supplied names, sizes and dates — **never
coordinates, bboxes or derived location detail**, however useful it would look.
When a label would have to leak location to be informative, the generic label
wins.

**Failure copy is ours, not the error's.** A caught error goes to `console.error`
and the user gets a sentence we wrote ("Couldn't save this trip."). Interpolating
an error message into a toast is how a canyon name reaches a screenshot.

**A calendar day is the user's, not UTC's.** Date-only values are stored as UTC
midnight, but "today" for a picker or a default must come from the LOCAL clock
(`todayDateKey`). Reading it in UTC greys out the current day for the first
hours of every AEST morning — the user cannot log the trip they just got back
from.

**Nothing is autosaved outside the app's own storage.** The web keeps a
half-written trip in `localStorage`; mobile deliberately has no equivalent —
form state lives in component state and goes out only through the outbox's
authed push. The OS doesn't reclaim a foreground sheet the way a browser evicts
a tab, so the draft would be a persistent copy of canyon names and notes bought
for no benefit.
