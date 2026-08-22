# Mobile design conventions

The house style for the Logjam RN app. **Reference implementations:
`src/saved/SavedScreen.tsx`** (inventory: hero metric, categories, per-item
actions), **`src/logs/`** (records: chronology, multi-axis filtering, a
create/edit form in a sheet) and **`src/canyons/`** (a collection: a partition
rail, a filter sheet over a shared predicate, cross-entity actions) and
**`src/screens/`** (the More hub and its sub-pages: a hero that reports app state,
a plain settings list, and preference writes that are online-only). When a rule
here is ambiguous, read those.

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
- Canyons → "how far through my list am I, and what's left?" (a count and a
  three-way tick-list meter: done / to do / shared with me)
- A canyon → "what am I walking into?"
- Logs → "what have I done?" (a count, a twelve-month activity spark, a
  chronological list)
- A trip → "what did I do that day?"
- More → "is my work safe, and where is everything else?" (the sync answer in a
  sentence, then the menu)
- Inbox → "what happened while I was away?"
- Friends → "who can I share with, and who is waiting on me?"
- Sync issues → "what couldn't be saved, and what do you want done about it?"
- Account → "who am I on this service, and what am I using of it?"
- Map → nothing. The map IS the answer, and it gets the whole screen (below).
- Map layers → "what is my map made of, what is drawn on it, and what works with
  no signal?" — three questions, so three tabs, not one long scroll
- Save maps offline → "what is this going to cost me?" (a size and
  a duration, updating as the area, the maps and the detail change)

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
  `SettingsScreen` is the worked example: it is a menu of preference pages with
  no headline state, so a hero there could only say the word "Settings", which is
  the pattern the hero rule exists to replace.
- **Settings is a menu of pages, split by STORAGE BACKEND.** It was one scroll of
  six sections, which mixed device preferences (synchronous, no account, no
  signal) with account ones (`PATCH /users/me`, dead for a guest, dead offline) —
  so every account row had to carry its own §10 reason and the two kinds were
  indistinguishable until you tapped one. The five pages are Display, Map,
  Notifications, Offline and storage, and Privacy and security; every one of them
  is device-backed except Notifications, which is entirely account-backed and
  therefore states the reason ONCE. Adding a preference means picking the page its
  backend already lives on — a page that needs two reasons is the wrong page.
  Custom fields stay on the root as two rows rather than a sixth page: a page
  whose whole content is the two rows above it is not a page.
- **A HUB earns a hero if it can answer a real question, not otherwise.** More is
  a menu, and a menu is dull — but it is also the only screen in the app that can
  be about the app itself, so its hero is the §10 sync answer ("Everything's
  synced · Last synced 2 min ago") with `Sync now` as the one action. The menu
  under it is deliberately plain. If a hub has no such question, leave it on the
  native header rather than inventing a metric for it.
- **The MAP has no hero, and no chrome it can do without.** It is the one screen
  whose content is the whole point, and every pinned element is a piece of map the
  user can't see. So: no header, no hero, no rail — a search button, one column of
  floating actions, and badges only while something is true (a filter withholding
  pins, a route being shown, a download running). Anything that can live behind the
  layers sheet lives behind the layers sheet. A badge for a layer the user chose to
  leave ON is not that: the canyon-routes coverage note moved onto its own row in
  the sheet, because a permanent chip is a permanent tax on the thing the map is for.
- **Chrome for a RUNNING JOB is a light, not a readout — and the top edge is a
  PAIR.** Track recording used to pin a four-number card to the top notice stack
  for the whole trip. What a person reads while walking is one bit — is it still
  recording — and a card is an expensive way to say a bit. The record button now
  holds the top corner on the ACTION COLUMN'S edge, pulses slowly while a
  recording runs (a hollow ring idle, a filled ring holding still when paused),
  and opens the numbers in a sheet on tap (`tracks/RecordButton.tsx`,
  `tracks/RecordingSheet.tsx`). The search pill holds the opposite corner and
  expands into the space between them, reserving the button's width; both corners
  flip together with the Settings → Map handedness, or the two controls end up
  stacked in one corner. Freed of the map-space budget the sheet carries far more
  than the card did — moving and stopped time, both average speeds, two profiles.
  Two obligations come with the pattern and neither is optional. **The one urgent
  line stays on the map**: a recorder that is not saving points says so in the
  notice stack without being asked, because a warning behind a tap is a warning
  the user finds after the trip. And **the way to STOP keeps a one-gesture path**:
  long-press the button to finish, same confirm as the sheet's own button
  (`tracks/finishRecordingPrompt.ts` — one wording, two callers). Cold hands do
  not go looking for a panel.
- **The map's two edges have different jobs, and WHICH edge is the user's.** One
  edge is the action column (layers, locate, the TOOL GROUP, record, and the small
  attribution button under them); it defaults to the RIGHT and moves to the left
  from Settings → Map (`mapPreferences.ts`).
  The other edge belongs to the map's own instruments — the native compass, the
  compass tape (which way the USER faces, as against the native ornament's which
  way the MAP faces) and the scale bar — and carries nothing you can press to
  change the app. The native compass is the exception that proves the rule: it
  IS pressable (it resets north), so it is dropped entirely in course-up, where
  that press fights the mode steering the map and where the ornament has nothing
  to say anyway — map heading and user heading are the same thing there, and the
  tape below already reports it. **Dropping a control and moving the camera are
  two different mechanisms, so order them.** The ornament goes with a prop and
  the rotation comes from an imperative camera stop; driving the rotation from
  the tap handler ran it against the render that removes the ornament, so the
  compass faded IN as the map turned and blinked out a beat later. Course-up's
  opening rotation is fired from a layout effect for exactly that reason — after
  the commit, before the paint. An instrument that runs a sensor gets a device-scoped switch in
  Settings → Map rather than a control on the map (`compassPreference.ts`), and
  it defaults OFF (2026-08-17): the tape holds the magnetometer and the
  accelerometer open for as long as the map tab is, and most trips never read
  it. The location arrow turns the same sensor on for as long as the arrow is up,
  so "which way am I facing" stays one locate-me tap away with the tape off.
- **A TAP asks, a PRESS-AND-HOLD commits.** Tapping the map drops a small ringed
  dot (a cursor, not a pin) and opens a sheet answering the four things a map can
  say about a spot — position, elevation, distance and bearing from you — with
  "navigate here" and "drop a waypoint" under them. Press-and-hold keeps its
  existing meaning, "something goes HERE", and its sheet offers the five things
  that can — waypoint, navigate-to, route from here, measure from here, canyon.
  **That sheet and the Settings → Map long-press preference are ONE vocabulary**:
  the preference's options are the sheet's rows, with `Ask` meaning "show the
  sheet". Adding an action means adding it in both places, or the setting is a
  menu of a different app's features. Neither gesture ends follow mode: a tap is
  not a pan.
- **Only a one-finger drag stops the map following you, and a pinch while
  following is drawn by US.** It is impossible to pinch without also translating
  the map — MapLibre zooms about the midpoint between the fingers and MLRN
  exposes no way to fix that focal point — so treating every user interaction as
  a pan meant changing scale cost you the lock every time, and merely *keeping*
  the lock meant letting the view drift and snapping it back on release, which
  reads as the map fighting you. So while following, the map's root view CLAIMS
  the two-finger gesture (capture-phase responder handlers, `handlePinchMove` in
  `MapScreen.tsx`), MapLibre's own zoom AND rotate are disabled, and the camera
  is written directly: centre pinned to the latest fix, zoom from the ratio of
  finger separation, heading from the angle between the fingers. Nothing
  translates and nothing snaps back. **Drive both axes or neither** — leaving
  rotation with MapLibre put a second driver on the same two fingers, and since
  no real pinch is a pure scale, the incidental twist was enough to shake follow
  mode loose. Course-up is the one exception: two fingers there scale only,
  because its heading belongs to the compass, and turning the map by hand while
  it is meant to face where you are looking is two answers to one question.
- **While following, MapLibre has NO pan gesture, and this screen decides when a
  drag has begun.** `scrollEnabled` is false for the whole of follow mode, not
  merely for the duration of a pinch. MapLibre's move detector arms on the first
  finger down and tracks the focal point of everything touching, so when a second
  finger lands the focal point jumps to the midpoint of the two — half the finger
  separation, in a single frame — and MapLibre applies that jump as a pan; the
  pinch handler then writes the centre back to the fix, and that pair is a visible
  pan-then-snap on every mistimed pinch. Disabling the gesture only for the
  pinch cannot work: the flag is React state, so it reaches the native view
  48-92 ms after the second finger lands (measured on a Pixel 9) and the jump is
  already in the first frame. The detector has to be disarmed before the gesture
  starts, which means for as long as the map is following. So the drag that means
  "stop following" is recognised in `observeTouches` instead — one finger past
  `PAN_SLOP_DP` (8dp, Android's own touch slop) drops follow, which re-enables
  `scrollEnabled` and hands panning straight back to MapLibre. The cost is a
  frame or two of deadband at the start of a drag-to-stop-following; that is the
  gesture least able to notice it, and a pinch cannot absorb the same delay.
  - **A pinch is ONE gesture until the LAST finger lifts.** Lifting one finger of
    a pinch hands the responder back to the capture handlers with the other still
    down, which looks exactly like a one-finger drag from an origin set where the
    first finger landed — a guaranteed slop breach that dropped follow at the end
    of nearly every pinch. `gestureHadTwoFingers` suppresses pan detection for the
    rest of the gesture; only a one-finger touch START begins a new one. The
    consequence is deliberate: lifting one finger and dragging the other does not
    stop following, because it is indistinguishable from an uneven release.
- **A map TOOL is a mode with a HUD, and closing it discards its work.** The
  measure tool arms from the action column (the button lights while it is on),
  collects taps, and reports through a panel in the top notice stack next to the
  recording HUD — never a chip pinned over the map. Its points are a question
  asked once, not an asset: leaving the tool clears them, so a measurement can
  never reappear over unrelated ground later. A tool that produces something the
  user would want to keep is a different thing and belongs in Saved.
- **A tool's own settings belong in its HUD, not in the layers sheet.** The snap
  picker (`SnapPicker.tsx`) sits in the tool panel because it
  governs what the NEXT TAP does — it is part of the tool's mode, not a property
  of the map. Layer visibility goes in the layers sheet; tool behaviour goes with
  the tool. Use the wrapped `SegmentedControl` from the kit for the choice (§9:
  never hand-roll a chip row), and say plainly when the setting cannot take
  effect — snapping needs the vector basemap at a zoom that still carries paths
  and creeks, so the picker names that rather than silently doing nothing.
- **Tools live behind ONE `+` button, and its tray opens SIDEWAYS.** Every tool
  added to the column is a permanent piece of map the user can't see, so they
  share one slot (`MapToolGroup.tsx`). Sideways, not upward, because the column
  is bottom-anchored against a constant `CHROME_BOTTOM` and upward growth walks
  into the search pill. The tray is ABSOLUTELY positioned: laid out in flow its
  width pushed the whole action column leftward and every other button visibly
  jumped when the tools opened. Arming a tool closes the tray — the HUD is then
  the thing saying what mode you are in, and an open tray behind it is a second
  answer to the same question.
- **A tool that produces an ASSET asks before discarding.** Measure and route
  draw look alike and behave oppositely at the exit: leaving measure bins its
  points silently (a question asked once), while leaving route draw confirms,
  because those points were meant to become something. Route draw ends in Save,
  and the result lands in Saved.
- **The two point tools are ONE implementation, differing in exactly two
  things.** They share the draft model (`@logjam/shared` `routeDraft.ts` behind
  `useRouteDraft`), the HUD (`DraftToolPanel.tsx`) and the map layer
  (`RouteDraftLayer.tsx`); measure has no Save, and its line is DOTTED where a
  route is SOLID (a thing you are asking versus a thing you are making). They
  were parallel implementations once, and the measure copy is what quietly
  lacked draggable points. A third tool extends these, it does not fork them.
- **A handle is dragged far more often than it is deleted, so a TAP on one only
  offers.** Dropping a point ends on the same pixel as tapping it; removing a
  vertex on what felt like a drop is a loss the user cannot see coming, so the
  tap opens the §7 destructive confirm. The line follows the finger DURING the
  drag (preview, no undo step) and commits once on release — which is also when
  snapping re-runs, on BOTH segments touching a middle anchor.
- **A drawn line says which way it runs.** Small arrows along it
  (`RouteDirectionArrows`, a `symbol-placement: "line"` layer, so MapLibre
  spaces and rotates them itself) on the draft and on saved routes, with a zoom
  floor — at a low zoom a route is a few pixels of line and arrows are noise.
  The FIRST and LAST anchors carry a quiet variation of the handle (filled and
  hollow); a hint you read up close, not a badge competing at a glance.
- **Feather is the icon family; a second family is allowed only for a glyph it
  lacks.** Feather has no ruler in its 286 glyphs and the near misses read as
  "resize" or "commit", so measure uses MaterialCommunityIcons `ruler` (already
  inside `@expo/vector-icons` — no new dependency) while route draw uses Feather
  `pen-tool`. Reach for the second family only after checking Feather first.
- **Map chrome offsets live in ONE module** (`mapChrome.ts`), and `CHROME_BOTTOM`
  is a CONSTANT. It used to grow by the recording HUD's measured height so the
  columns could lift out of the way; `onLayout` never fires on the way out, so the
  lift stuck after recording ended and every button stayed shoved up the screen.
  Anything that would push chrome around goes in the top notice stack instead —
  which is where the recording HUD now lives.
- **Prefer the native map ornament to a JS one.** The compass is `compassEnabled`
  + `compassViewPosition`: it tracks the camera frame by frame, fades itself at
  north and resets north on tap, none of which the hand-rolled button did (it
  redrew only when a gesture settled, and a rotated glyph is not a needle). The
  scale bar stays in JS only because MapLibre RN v10 ships no scale-bar ornament —
  and it follows the camera through a ref (`ScaleBarHandle`), not through screen
  state, so gesture-rate updates re-render one small component instead of every
  layer on the map.
- **A native ornament is positioned by a NUMBER, so it has to be told what is
  under it.** MapLibre's compass sits outside the React tree, so its margin is
  computed from what the instruments column actually draws — the tape only with
  the compass switched on, the bar only with the scale bar switched on
  (`ornamentMarginY` in `MapScreen`). This is a preference read, not an
  `onLayout` measurement: `CHROME_BOTTOM`'s comment warns off measured offsets
  because they stick when the thing they measured goes away, and these values are
  known before the frame is drawn.
- **The compass tape reads TRUE north by default and can be switched to
  MAGNETIC — numbers only.** The map, the location arrow and the navigate-to chip
  stay true in both settings, because they are drawn against a true-north map and
  a magnetic arrow on a true map is simply a wrong arrow. The switch exists
  because a canyoner transfers a bearing onto a plate compass, where true north is
  the wrong number by ~12.5°. In magnetic the tape carries an "M": the default
  gets no mark (every pixel of chrome is terrain), a non-default that silently
  reads 12° low gets one.
- **A hero on a pushed screen owns the back button** (`HeroHeader.onBack`).
  Turning off the native header removes the back affordance too, and the
  swipe/hardware gesture is not a visible way out.

### The first screen is the sign-in screen, and everything else is subdued

`src/screens/LandingScreen.tsx` is the skeleton for an unauthenticated screen:
centred column on the page colour, `KeyboardAvoidingView` + a `flexGrow: 1`
scroll container (the keyboard covers a form otherwise), and, top to bottom:

```
mark          app icon at 88pt, radius.xl · title · one-line tagline
ErrorBanner   only when there is one
form          TextField · TextField · Button(filledAccent) · one FooterLink
secondary     Button(outlineAccent) · Button(ghost)   ← never competes above
```

- **No menu in front of the form.** The screen a fresh install lands on carries
  the email and password fields themselves; a chooser whose options are "sign
  in" and "don't" put the app's most common action one tap behind a decision
  most people had already made. The `chooser` and `signIn` auth states render
  the same screen for that reason — two screens meant two sign-in forms, and
  DESIGN's one-form-per-entity rule applies to auth like anything else.
- **One filled action.** Sign in is `filledAccent`; create-an-account is
  `outlineAccent` and continue-without is `ghost`. Weight is the whole hierarchy
  here — three equal buttons is the pattern being replaced.
- **A choice with consequences is a STATE of this screen, not a card under it.**
  "Continue without an account" swaps the form for the explainer (what stays on
  this phone, what needs an account) with three ways out — back, create an
  account, and the actual commit. An explainer rendered permanently below the
  buttons is read by nobody, and the consequence is unrecoverable a season
  later.
- **One question per arrival.** Consent questions that are not about getting in
  (crash reports) are not on this screen; they are asked once, as a sheet, after
  the user is inside (`CrashReportConsent`, mounted from `App.tsx`). A one-time
  question stores an answer for BOTH of its buttons — a "not now" that stores
  nothing is a dialog on every launch.

### Chrome stays constant; secondary filters stay collapsed

Pinned chrome is a tax on every scroll, so a screen gets ONE pinned filter axis
— the one you flick between (Saved: category; Logs: activity type). Precise
filters (free text, a date range) hide behind a hero `IconButton` that reveals
them **in a slot the hero already occupies**: Logs swaps the activity spark for
the search row, so opening search doesn't shove the list down, and the spark —
retrospective decoration — isn't competing with a hunt for one trip.

**Presets are the shortcut, not the ceiling.** A mobile filter that only offers
"under 30 m" is friendlier than the desktop's operator + number, and strictly
less capable — which is a downgrade, not a simplification. Lead with the three
or four answers people actually pick, and put the full control one tap behind a
`Custom` chip (see `ThresholdFilter` in `CanyonFilterSheet`). The draft rule
matters: opening Custom must NOT commit a value, or "under 0" applies the
instant you tap it and the list empties for no reason the user can see.

An active hidden filter must announce itself: the reveal button renders
`filled`, and a set date range gets a dismissible summary strip above the list.
A filter you can't see is a bug report waiting to happen.

### A sheet with three subjects gets a rail, not a longer scroll

`MapLayersSheet` is the worked example: basemap choice, layer visibility and
offline storage were one column of six stacked `SectionHeader` groups, so each of
the three was a scroll away from the others. They are now a pinned
`SegmentedControl` inside the sheet — the same content-swap rule as §6 ("never
open a second sheet"), applied to a sheet that is really three panels. The rail
carries the count that matters (`Layers 9`), and the tab you are in is never
scrolled out of reach.

Reach for this only when the sections are genuinely different SUBJECTS. Two short
groups are a scroll; three unrelated ones are a rail.

### A list of layers is one row per KIND, not one row per file

The layers tab is the worked example. A phone with a dozen GeoPDFs and thirty
tracks turned it into a scroll of near-identical switches with no way to turn a
whole kind off. Each kind is now ONE row — its glyph and hue, a live count
("4 of 4 shown"), a master switch, and a chevron that opens its files underneath.

- The master switch's value is "any of them visible"; flipping it writes every
  item in the kind. Kinds with exactly one thing behind them (canyon routes, and
  the user's own drawn routes) are the same row without the disclosure.
- **A control that is the same for every item in a kind belongs to the KIND.**
  GeoPDF opacity was five identical 5-step rails stacked; it is now one rail under
  the group, writing all of them.
- Items keep their own identity as a colour dot, not a second icon tile — the
  tile belongs to the group row above them, and repeating it flattens the
  hierarchy the disclosure just created.

### An inventory row is one thing the USER asked for, not one file we wrote

The layers-sheet rule above ("one row per KIND, not per file") read one level
down, for Saved. One "Save maps offline" run writes a basemap file per selected
map and a generated LiDAR topo job writes one file per layer — eight cards for
two things the user did, none of which could be deleted as a unit. Each is now
one card: title from the name the user gave it (`groupLabel`, else a rename,
else the generic label), size summed, extent unioned, and the group's three
verbs — show on map, rename, delete — acting on all of it. The files it is made
of are listed inside the `⋯` sheet under "Includes", each with its own size and
its own delete, because reclaiming one basemap must not cost the area.

The grouping is a pure module with a test (`offline/artifactGroups.ts`,
`regionDownloadGroups.ts`): a card that sums sizes and unions extents is
arithmetic, and arithmetic in a render is arithmetic nobody checks.

### A subtitle earns its line or it isn't there

A row's subtitle says something the user cannot already see. It never restates
the filter they are standing in ("LiDAR topo · on device" under the LiDAR Topos
filter), never restates the section header above it ("Not on this device" under
"Available to download"), and never repeats the pill beside it ("import
unfinished" next to an `Unfinished` pill). Dates, sizes, counts and failure
reasons stay — they are the reason the slot exists.

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
- **Prefer a rail whose buckets PARTITION the list.** Canyons uses done / to do /
  shared, which is a partition because a shared canyon structurally cannot be
  "done" (a trip only links to its own owner's canyons). Every row is in exactly
  one bucket, the tallies sum to All, and the user never has to work out what a
  combination of two axes would show. When the natural axes overlap, pick the one
  that partitions and push the rest into the filter sheet.
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

### A category may add its own narrowing control, below the rail

The filter rail picks a KIND; anything that narrows WITHIN one kind belongs
under it, rendered only for that filter. Waypoints are the case that earns this
(`SavedScreen`): every other saved kind is a handful of large files you scan by
eye, while a waypoint list is hundreds of small things you arrived looking for
one of, so the waypoint filter — and only it — grows a search field and a rail
of its tags. The tag rail is the vocabulary IN USE, so it never offers a chip
that would match nothing, and the search field follows the same rule one step
further out: with no waypoints at all there is nothing to narrow, so it is
absent and the empty panel gets the whole body. Both narrow the on-device mirror, so both work with
no signal; a narrowing control that needs the network does not belong here.

**When a thing has no kinds, its STATE is the category.** Canyons are all the
same sort of object, so `canyonHue` keys off done / to do / shared instead
(`CANYON_STATUS_META` in `src/canyons/canyonMeta.ts`), and `done` takes the
scheme accent for the same reason `region` does — the accent belongs on the state
the screen is celebrating. The identity still appears in both places the rule
requires: the row's icon tile and its rail chip.

### A notification borrows the hue of the thing it is about

The inbox is a genuine vocabulary of kinds, so it gets the glyph+hue treatment —
but every hue in `notificationHue` POINTS AT an existing one (`src/theme.ts`). A
topo notification wears the same eucalypt a topo overlay wears in Saved; a
canyon-share wears the same heath a shared canyon wears on the Canyons rail. The
inbox is where you first hear about a thing, and recognising it again where it
lives is what makes the inbox part of the app instead of a log of unrelated
events. Adding a kind means naming an existing hue; if the thing it refers to has
no hue yet, that gap is what to fill first.

The one exception earns itself: anything **failed or skipped** takes
`theme.warning` and the alert glyph regardless of what it was about, because
scanning an inbox is a hunt for the thing that went wrong.

### A hub menu is not a category vocabulary

Five hues for Inbox / Friends / Sync issues / Settings / Account would be
decoration — those rows aren't kinds of one thing, they're destinations. They take
the default accent tile, and only Sync issues changes hue (to `theme.warning`,
and only while something is actually parked). Don't invent a palette for a menu.

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
meters, badges. Do not introduce a fourth card radius. `sm` (4) exists for small
DECORATIVE chips only — colour swatches and preview squares in Settings — and
never for a content surface; a row, card or sheet reaching for it is the fourth
card radius arriving under another name.

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
  back. A grab handle that ignores a grab is worse than no handle. A TAP on it
  does nothing on purpose: dragging is *discard*, and a stray tap on the top
  edge of a half-filled form must not throw it away.
- **The BACKDROP is the screen-reader dismiss, and the handle is hidden from
  assistive tech.** A one-finger drag is a gesture TalkBack and VoiceOver claim
  for their own navigation, so it never reaches the handle — the handle used to
  announce itself as "Drag down to close", an instruction the user being given
  it cannot carry out. It is now `accessibilityElementsHidden` /
  `importantForAccessibility="no-hide-descendants"`, and the backdrop `Pressable`
  carries `accessibilityRole="button"` with the label `Close <sheet title>`. That
  makes every sheet in the app closable by a screen reader without relying on the
  OS back gesture, and it means the sheet's title is load-bearing copy: it is
  read aloud as part of the way out. Same rule as `ActivitySpark` in §7, read the
  other way — don't announce an action that cannot be performed.
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

**A paged surface puts its arrows at the vertical middle, over the content's
own edges.** Along the bottom they land on a video's transport controls, which
is the one place they must not be; and the row between them stays
`pointerEvents="box-none"` so it doesn't steal taps from the page underneath.

**One camera driver at a time, and the loser YIELDS.** The rule that took
rotation off MapLibre during a pinch (above) has a second half, one axis over:
the location watcher's recentre is a 600 ms ANIMATED stop, and the pinch writes
0 ms stops at gesture rate from the same fix — so a fix landing mid-gesture
starts an animation that the next finger frame overrides, and the map stutters
for as long as that animation had left to run. The watcher skips its recentre
while `pinchStart` is non-null (`applyFix` in `MapScreen`), which costs nothing:
every pinch frame already carries the latest fix as its centre. Course-up never
showed this because its own ~20 Hz driver was overwriting the animation
continuously — smoothness there was luck, not design.

**Don't ease a correction you can stop needing.** This used to say the opposite,
and the reasoning is worth keeping because it was wrong in an instructive way.
The pan-then-snap at the start of a mistimed pinch was read as "the first finger
alone pans, then the second arrives and we yank the centre back", and answered by
easing that correction over 600 ms (`pinchRecovery.ts`). It was also argued that
stopping the pan instead would trade a rare cosmetic snap for a frequent dead
gesture. Both halves were wrong, and only measuring the touch stream showed it:
the first finger never moves at all (`firstFingerTravel` was 0.0dp on every
gesture of a 40-gesture run) — what moves is MapLibre's focal point, jumping to
the midpoint the instant the second finger lands. Easing from "where MapLibre
left the map" was easing from a point derived from a pan that never happened, so
the module was inert once the stale-centre bug behind it was fixed. Disabling the
pan for the whole of follow mode turned out to cost a deadband nobody notices.
The correction did not need to be smoother; it needed to not exist. When a
correction keeps needing to be prettier, check whether the thing being corrected
can simply be prevented.

**While this screen drives the camera, its own record of zoom and heading is the
TRUTH, and MapLibre's reports are ignored.** `onRegionDidChange` arrives late,
coalesced and occasionally out of order, so a report describing a camera from
early in the last gesture can land after it — and `zoomRef`/`headingRef` are
what the NEXT pinch starts from, so one stale report made the map snap back a
couple of zoom levels the moment two fingers touched down. `setCameraStop`
records any zoom or heading it is given, and the settle handler only writes
those refs when `followMode === "off"` (nothing else can move the camera while
following: MapLibre's own zoom and rotate are disabled). The single exception is
`fitCameraToBbox`, where MapLibre picks the zoom and the report back is the only
way to learn it — it arms a one-shot flag for the next settle. **A stale report
is strictly worse than no report**, which is why this is not merely an
optimisation.

**Fit the camera once per request, not once per load.** A map layer can
re-resolve its source for reasons that have nothing to do with the user, and
refitting on each one yanks the camera back mid-pan — the map becomes
impossible to explore. Guard on the request's nonce.

**Stack chrome that talks to the user.** Notices, error strips and state badges
anchored to the same edge belong in ONE positioned column with a gap, not each
absolutely positioned at the same offset — otherwise the second message to
appear lands on top of the first (the map's route badge and its offline notice
did exactly this).

**A pointer between screens carries a nonce.** "3 saved areas ›" hands Saved a
category to select. Navigating there a second time with identical params changes
nothing downstream, so the pointer silently stops working once the user has
touched the filter themselves — the same failure the map's "show on map" nonce
exists to prevent, one screen over.

**A follow mode recentres on entry, not on the next sensor reading.** Position
fixes arrive every few seconds and only after several metres of movement, so a
"follow me" button that waits for one does nothing at all for a stationary user
who has panned away. Tapping it moves the camera immediately from the last known
fix; the watcher only keeps it there. And a camera write that repeats at sensor
rate (the POV heading) must carry the position too, or it cancels every recentre
the location watcher asks for.

**Draw what the user can act on.** The location marker is an arrow (position and
facing in one glyph) with no accuracy halo: the halo was a translucent disc the
size of a suburb that changed no decision and hid the map under itself.

**A choice that leads to a form parks the target and opens it from
`onClosed`.** The map's press-and-hold sheet ("waypoint or canyon?") can't mount
the canyon form directly — see the never-two-sheets rule above — so it stores the
point in a ref, closes, and the `onClosed` callback opens the form with it. Same
shape as launching a system window from a sheet, and the same reason.

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

**Long work belongs in a card, not a screen — unless leaving would break it.**
The two long jobs in the app are deliberately opposite, and the difference is
whether the user can walk away without cost:

- A **region download** only advances while the app is foregrounded, and it used
  to get a whole screen whose Done stayed shut until every job settled. That
  screen covered the map — the thing the user downloaded the tiles FOR — to
  enforce a constraint one small line of copy can state, so it is gone: the run
  is a progress card at the top of Saved's Regions filter (one card per run,
  per-job detail behind its `⋯`), the warning is a footnote under the cards, and
  a toast at the shell says how it went. Say the cost, don't imprison the user
  to enforce it.
- A **GeoPDF import** hands its work to a native executor and needs nothing from
  the JS thread, so it runs in the background (`geopdf/importRunner.ts`): a
  progress card at the top of Saved with a cancel, and a toast at the app shell
  when it lands. It used to take the whole screen for the whole run, which read
  as the app being frozen for minutes when it was idle for all but the first two
  seconds of them.

The corollary: a background job's toast is mounted at the SHELL, not on the
screen that started it, or it fires into an unmounted component the moment the
user goes somewhere else — which is exactly what a background job is for. ONE
component carries every background source (`BackgroundToast.tsx`, subscribing to
the GeoPDF import runner and the region download queue): a second mounted dock
would let two of them land on top of each other, and the user does not care
which subsystem is talking.

## 7. Actions

- **One primary acquisition affordance per screen** — a labelled compact
  `Button` in the hero (`+ Add`), opening a `BottomSheet` of the ways in. Not
  three or four outline buttons scattered between sections. Each sheet entry is
  a `Row` with its category glyph/hue and a verb title.
- **Per-item actions live in an overflow sheet**, titled with the item's name.
  Rows stay clean and a mis-tap can't destroy anything.
- **The three verbs follow the asset wherever it is listed.** A GeoPDF or a track
  you can see on the map gets the same `⋯` in the map's layer sheet that it has in
  Saved — same actions, same copy, from one definition (`saved/assetActions.ts`).
  Two places offering "Delete" with two descriptions of what is deleted is how one
  of them goes stale. Inside a sheet it opens as an `overlay` sub-mode, not a second
  sheet (§6).
- **A tapped LINE answers "what is this" before it offers verbs.** A route opened
  its stats sheet; a recorded track went straight to its verb list, and an
  imported file had no answer anywhere. All three now render ONE body
  (`tracks/TrackStatsBody.tsx`) from ONE derivation (`computeTrackDetail` in
  shared) — distance, ascent and descent, moving and stopped time, average and
  moving speed, the height band, and the elevation and speed profiles — with the
  verbs behind "View options" (map) or a `stats` sub-mode (Saved). Two rules hold
  it together. The stats are **derived on demand, never stored**: the recorder
  caches four columns because it writes them as it goes, and everything else is
  computed when something is looking at it, so a new stat is never a migration.
  And a series with **no timestamps renders no time-derived cell at all** — an
  imported GPX without `<time>` has a real distance and a real climb and no
  honest pace, so those cells are absent rather than zero.
- **A selection is a STATE of the row, not a label on it.** The basemap list used
  to hang a "Showing" pill off the active row; it now lights the whole card (accent
  border, accent tint, a filled check). One row looking different is read before any
  word is. Same pass killed an "Offline" pill on basemaps with a downloaded region —
  three square kilometres of saved tiles is not an offline basemap, and the pill
  claimed it was. It is one declaration — `Row`'s `selected` prop — so the active
  basemap and a multi-selected saved asset cannot drift into two looks.
- **A multi-select starts with press-and-hold, and its bar TAKES the rail's slot.**
  Hold any row to enter the mode with that row picked, tap to toggle the rest,
  and the last row deselected leaves the mode — no separate "done". While it is
  running, the contextual bar replaces the filter rail rather than stacking a
  second bar above the tab bar: two rows of chrome eat the list, and the tabs
  themselves are the way out of the mode. The bar reads `× | N selected · size |
  select-all · delete`, and it carries only verbs that are BETTER in bulk than
  one at a time. "Show on map" was in the first cut and came out: flying to the
  union of five extents is not what any of the five meant, and the single-item
  verb already does the thing the user wanted. Reference: `saved/SavedScreen.tsx`.
  - **A row the group verb cannot act on is not selectable.** Deleting is all a
    selection does, so a shared route or waypoint (no `delete` descriptor) is
    skipped by select-all and answers a long press with the reason instead of a
    checkbox — silently ignoring the press reads as a missed tap, and picking it
    would only teach the count to lie.
  - **Filter and selection are exclusive.** The rail is gone while picking, and
    any programmatic filter change clears the selection: a bulk delete that
    reaches rows scrolled behind another category is one the user never saw.
  - **A bulk confirm counts BOTH consequences, and reads as English in every
    combination.** A mixed selection of files and synced records is two different
    deletes ("deleted from this phone" vs "removed from every device on your
    account, and from anyone you shared their canyons with"), so the dialog says
    each with its own count rather than picking the sentence that is true for the
    majority. Counts that vary independently make copy assembled from clauses
    read like a filled-in template ("1 item is… 4 of them are…"), so the whole
    body is ONE function over the counts — `saved/bulkDeleteConfirm.ts`, with
    every combination pinned in its test — and a single-kind selection takes a
    pronoun back to the title instead of restating the count.
- **Show the thing, not a glyph standing in for it.** Three of the basemaps are
  renderings of the same NSW ground, and no icon vocabulary can say how "SIX Maps
  Topo" differs from "SIX Maps Base Map" — so each row leads with a real 44pt tile
  OF that basemap (`BasemapThumb`), glyph only as the fallback for the vector source
  and for offline. The tile is fetched only from providers whose terms let us keep
  their tiles; asking the OSM servers for a thumbnail earns an "Access blocked"
  image, which is both a policy breach and a worse icon.
- **Every asset gets the same three verbs** where they apply: *show on map*,
  *rename*, *delete*. Uniformity is the feature — a user should never have to
  learn which kinds happen to support which action. Renaming is display-only
  (`label` overrides the derived name; resolution still keys off ids), so it is
  cheap to extend to a new kind.
- **A verb the API would refuse is ABSENT from the descriptor, not disabled in
  the screen.** `AssetActions.rename` and `.delete` are optional and omitted for
  a route or waypoint shared through someone else's canyon (the API's writes are
  owner-only), so a surface cannot offer them: rendering branches on the verb
  existing, and the multi-select refuses to pick a row with no delete. Before
  this, `rename` was an `async () => undefined` stub and `delete` was always
  present, so three of the four surfaces offered both — a shared route's Delete
  removed the row from the phone, parked the push as `blocked`, and the next
  delta pull brought it back. The guard belongs where the verbs are declared;
  every surface then inherits it (`assetActions.test.ts` pins it). Copy for the
  absence is `SHARED_READ_ONLY_HINT`, written once.
- **Picking people is ONE panel, and the promise is the first thing in it.**
  `useSharePanel` (`src/sharing/SharePanel.tsx`) is what Saved's item sheet,
  the route sheet, the track sheet, the map's waypoint sheet and the canyon
  screen all render, in both of its modes — a live revocable Share and a
  permanent Send a copy. It opens with a tinted banner saying which promise
  this is (accent + eye, or warning + triangle), then an always-present search
  field, then the rows: initials avatar, name, and a trailing glyph that is the
  state of the row (a `+` you tap to grant, a tick you toggle to select). The
  banner is not decoration — the two verbs are one word apart and only one of
  them can be undone, so the panel says so before the list rather than after
  it, and the irreversible one keeps its confirm in a pinned `footer` (§6)
  while the revocable one acts on the tap. Extend the panel; never hand-roll a
  second picker.
  - **Both verbs are DIMMED offline, never withheld** (`useShareRowProps`).
    They are the first thing most saved items offer that needs a connection, so
    a row that simply is not there reads as "this kind can't be shared" rather
    than "not right now" — §10's rule, in the place it is easiest to get wrong,
    because the honest-looking alternative is to hide a verb that cannot work.
- **A switch that LOWERS a guard costs an authentication; raising it is free.**
  The app-lock toggle (Settings → Privacy and security) is what stands between someone
  holding this unlocked phone and the canyon coordinates on it, so turning it off
  goes through the device authenticator and a cancelled prompt springs the switch
  back on (`appLockPreference.ts`, fail-closed on any error). Without that
  asymmetry the switch is a one-tap bypass of the thing it controls. It is also
  DEVICE-scoped, not account-scoped: it is a claim about one handset's physical
  security, and syncing it would quietly unlock the user's other phone.
- **A destructive confirm describes what THIS entity loses.** Discarding a parked
  canyon edit keeps the typing on the conflict shelf; discarding a parked upload
  does not (its "fields" are a filename and two cache paths) and instead deletes
  the copy waiting on the device. One sentence for both was simply false for one of
  them — see `discardExplanation`.
- **Destructive actions confirm in a dialog**, which carries the explanation.
  The sheet entry itself is just the verb ("Delete from device") — consequence
  copy in a menu row only ellipsises.
- **The confirm copy for an entity is written ONCE, as a
  `{ confirmTitle, confirmBody }` descriptor, and every surface offering the verb
  reads it from there.** `saved/assetActions.ts` holds it for the saved kinds,
  `canyons/canyonDeleteConfirm.ts` for a canyon (it takes the linked-trip count,
  because that sentence is per-instance). This is the enforcement of the rule
  above it: the canyon copy was duplicated byte-for-byte across the list and the
  detail screen, and the map's waypoint sheet had *drifted* — it said only
  "Delete this waypoint?" while Saved said the delete reaches every device on the
  account and everyone the linked canyons are shared with. A second surface for
  an existing verb imports the descriptor; it never retypes the sentence.
- **A navigation row's subtitle is live STATE, never an explanation.** More's rows
  used to read "Notifications, shares and requests" and "Conflicts that need your
  attention" — copy that told the user nothing the title didn't. They now carry
  what is true right now: "3 unread", "2 changes need a decision", "1.2 GB of 5 GB
  used". Where there is no state to report (Settings, Friends) there is NO
  subtitle, and the slot is free for the §10 "Needs a connection" reason when the
  destination is online-only.
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
- **One form per entity, create and edit.** `TripEditSheet` and
  `CanyonEditSheet` are each the same component in both modes: same fields, same
  validation, with only the sheet title and the submit label differing. Two forms
  drift, and the one the user reaches less often is the one that rots.
- **Name a thing OVER the work, not in front of it.** The region download asks
  for a name in a sheet that opens once the jobs are already enqueued and
  running, pre-filled with a default ("Region 3" — see the privacy note in
  `map/regionName.ts`: a default name may not need the network or say where the
  area is). Confirm and dismiss are the same answer, because the default is
  already the label the jobs carry. A naming prompt that gates the start makes
  the user's typing speed part of the download.
- **Work the user pays for in time and disk is priced BEFORE they commit, and the
  price updates as they change the inputs.** The download screen's hero is the
  estimate ("≈ 41 MB · about 12 min"), recomputed on every edge drag and detail
  change, because the whole decision is the tradeoff between area, detail and how
  many maps. Three rules follow:
  - **TWO stats, equal weight, fixed height.** The two things the decision turns
    on are what it costs in disk and what it costs in time, so they are peers
    (`HeroHeader.secondaryValue`) — a time in the small muted `valueSuffix` font
    said it was a footnote to the size. The tile count and the p90 spread were
    the third and fourth stats, they overflowed the line, and neither changes
    what the user does next. The hero's height never changes, because the map
    below it is being dragged while these numbers move.
  - The numbers are derived from MEASURED per-zoom tile sizes
    (`mapRegionEstimate.ts`, calibrated by a committed script over both bush and
    town — a bush-only sample read 40 % under for a real download).
  - **A cap is ONE warning, over the map, not a band in the hero.** The three cap
    reasons (edge, area, tile count) are one message to the user and have the
    same ways out, so they are one semi-transparent chip pinned at the top of the
    map — the same overlay treatment as the hint along its bottom. A warning that
    takes layout space takes it from the map, and one that appears and clears
    resizes the map under a frame the user is dragging. The Save button still
    disables, but never silently: the chip is why.
- **An area selector uses EDGE handles, not corners.** Each edge is a
  one-dimensional drag with nothing to anchor, so any aspect ratio is one gesture
  away — a tall strip for a creek line, a wide one for a plateau — where a corner
  couples two axes and only reaches the shapes a corner reaches. The frame's
  interior stays `pointerEvents="none"` so the map underneath keeps its own pan and
  pinch: the map moves the area, the handles shape it. (Rotation and pitch are
  disabled while framing, because the frame→bbox maths reads axis-aligned bounds.)
- **An affordance that can only refuse is absent, not disabled.** The download
  screen offers the three NSW sources whose licence permits keeping a copy plus our
  own vector basemap; the OSM-family sources aren't listed at all. Compare the
  layers sheet, where they ARE listed and DO grey out offline — there the row is
  still the way to select them when online, so the reason belongs in its subtitle.
- **A server-side cap is a UI rule, not an error to discover.** A canyon takes
  exactly one route (the API answers a second with 409), so the strip stops
  offering "Add" at the limit and says what the limit is. An affordance that
  exists only to fail parks a dead op in the outbox, where the user can't see
  the reason.
- **A picker over an OPTIONAL value keeps an explicit "not recorded" stop.** The
  grade rails in `CanyonEditSheet` lead with `—`. Most imported canyons have gaps,
  and a picker you can't get back out of turns "I don't know" into a wrong answer
  the user can't retract.
- **A cross-entity shortcut hands off to the real form, pre-filled — it never
  reimplements it.** "Log a trip here" on a canyon opens `TripEditSheet` with
  that canyon already linked (`initialCanyons`). Seeding is keyed on the sheet
  OPENING, not on the prop: callers build that array inline, so a new identity
  every render would re-seed the form under the user mid-edit.
- **An edit pushes only the fields that changed.** Diff against the entity you
  seeded from and send the difference (see `save()` in `TripEditSheet`). Sending
  the whole form makes every save a write to every column, which under
  field-scoped LWW clobbers a concurrent edit to a field the user never touched.
- **Where the DEFINITIONS live depends on the account, and one file knows.**
  Field VALUES always queue through the outbox. The definitions are an
  account-level preference blob the web and every device share, so a linked user
  needs a connection to edit them (an offline edit to a shared list would need
  merge rules for a list they could be reordering in a browser at the same
  time) — but a GUEST has no such blob, keeps their own list on the device, and
  can add, rename and delete a field in a canyon with no signal.
  `customFields/fieldDefsStore.ts` owns that branch and
  `capabilities.fieldDefsBlockedReason` owns the reason string; no screen
  re-derives either. Both entity forms (`TripEditSheet`, `CanyonEditSheet`) and
  Settings reach the same editor as a MODE of their own sheet.
- **A destructive action reports the part the user can't see.** Deleting a
  custom field also clears its value from every trip that had one, so the
  confirm counts the affected rows FIRST and puts the number in the dialog
  ("12 trips have a value…"), rather than discovering it afterwards. A guest's
  count and clearing are local, and the clearing still goes through the outbox
  so it survives linking an account.
- **An unavailable cell inside a swipeable grid stays a `Pressable` with a
  no-op press** — never the `disabled` prop, and never a plain `View`. RN's
  touch dispatch looks for a JS touch target under the finger; an inert View
  isn't one, so in a grid where EVERYTHING is unavailable (a month entirely in
  the future) the gesture falls through to the enclosing native ScrollView and
  the grid's pan responder is never consulted at all. It became unswipeable
  exactly when nothing in it was pressable. `accessibilityState` still
  announces it as unavailable.
- **Never open a system window from an open sheet.** Permission requests and
  media pickers both need a window of their own; launched from a `Modal` they
  can't attach one, and `requestCameraPermissionsAsync()` simply never resolves
  — the button looks dead. Close the sheet first and run the job from its
  `onClosed` callback. (A `Keyboard.dismiss()`-style pre-call is not enough:
  the close is asynchronous, so the Modal is still up when the picker launches.)
- **A chart is not an affordance.** `ActivitySpark` is deliberately
  non-interactive because it exposes no filter — same rule as the drag handle,
  read the other way: don't render something that looks tappable unless it is.

## 8. States

- **Empty states are per-filter and actionable.** Name the thing that is
  missing, say why it matters *in the field*, offer the action that fixes it.
  A shared grey "nothing here" is not acceptable; nor is a muted one-liner
  hanging under a section header.
- **That applies to a SCREEN's empty state, not to every empty slot.** A section
  that is merely empty gets a label, not a lesson: "Nothing written down.",
  "No photos yet.", "Attach a .gpx or .kml." The add button next to it already
  says what to do, and repeating the pitch beside every empty strip turns the
  page into a tutorial.
- **A screen that hides content on another screen's behalf says so THERE, and the
  dismissal is the off switch.** The Canyons filter can restrict the map to its
  own result (opt-in — the web forces it). While that is on, the map carries a
  pill counting what's missing ("Showing 5 of 28 canyons"), and clearing the pill
  turns the option off rather than just hiding the warning. A map that silently
  drops pins is a map you stop trusting; a warning you can dismiss without fixing
  the cause is one you learn to ignore. State crossing screens like this lives in
  a small module store (`canyonMapFilter.ts`), not a context — it has to outlive
  the screen that set it.
- **A screen whose every action is a LOCAL write is not disabled offline.** Sync
  issues stays fully live with no signal: reads come from SQLite, Discard and
  Recreate never touch the network, and Retry only flips the op back to `queued`.
  What offline changes is the PROMISE — "Try again" becomes "Queue it again · It
  goes up when you have signal", because the button cannot do what its usual label
  claims. Disable an action when it can't work; reword it when it can, but later.
- **One notice channel per screen** — see §6. Four independent status lines,
  each owning its own corner, is the anti-pattern.
- **The screen that states the answer in words does not also state it in pills.**
  §10's offline and "N waiting to sync" pills exist to carry the sync answer onto
  screens that are about something else. On More that answer IS the subject, in a
  sentence with a tone-coloured glyph — so the pills are dropped there. Repeating
  one fact in two places beside itself is the same anti-pattern as four corners.
- Background fetches report failure **inside the filter that needs the data**
  (with a retry), not as a screen-level error. Never swallow it entirely.
- **A tile the provider never made is not an error.** A third of `six-imagery`'s
  z18 tiles over bush are 404s (measured). The download reports them as
  "3 not available" alongside its progress, keeps the region usable, and never
  retries them — an error tone here would teach the user to distrust a map that is
  as complete as it can be.
- **A layer that draws part of the picture says which part is missing.** The
  canyon-routes layer draws every route file this phone actually has; when some
  aren't cached it says so ("12 drawn · 3 not downloaded yet") rather than quietly
  rendering three quarters of the answer. Same rule as the withheld-pins pill, one
  level down. Where it says so depends on how long it is true: a transient fact gets
  a map badge, a fact that holds for as long as the layer is on gets its row's
  subtitle.
- **Blank beats plausible-but-wrong.** Offline, MapLibre will happily upscale a z8
  tile 256× to fill the screen around a downloaded region — a soft, convincing map
  of ground the phone has no data for. The map instead fills everywhere outside its
  saved regions with the page colour (`offlineMask.ts`), so the edge of what you
  actually have is visible. A map you can't trust the edges of is worse than a map
  with edges.
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

**A primitive's `alignSelf` belongs to the primitive; fix the AXIS at the usage
site.** `StatusPill` sets `alignSelf: "flex-start"` so it never stretches to the
width of the column it usually sits in — correct there, and wrong in a
row-direction trailing group, where the cross axis is vertical and flex-start is
the TOP edge (the "Offline" pill floated above the size text next to it). Wrap
it in a plain `View`, which takes the container's `alignItems`; do not change
the primitive to suit one caller.

**Labels wrap; they do not ellipsise.** `Row`'s title caps at TWO lines (it is
often a user-supplied name, and a pasted paragraph must not become a screen-tall
row) and its subtitle is UNCAPPED, because the subtitle is our own copy and any
fixed cap is a sentence that survives at one text size and is cut off at the
next. Pass `titleNumberOfLines={1}` where a single line is load-bearing. The
same rule sent the map's badges to two lines: a warning that reads "Showing 5 of
2…" is a warning nobody can act on. Drop a trailing pill beside a long subtitle
— the pill's width is what forced the ellipsis in the first place.

**The two map INSTRUMENTS size themselves in text.** The compass tape's label
slot and height, and the scale bar's height, are computed from `textScale`
(`theme.ts`) rather than fixed: their type grows with everyone else's, and a
bearing that reads "24…" is an instrument that can't be used. This is the only
layout code that should reach for `textScale`; everything else is `spacing`.

**One visual, one component.** `Chip` is the single pill primitive behind both
`SegmentedControl` (single-select rail) and `ChipPicker` (multi-select
vocabulary); `MediaStrip` is the single photo surface behind both detail
screens. When a second screen needs something the first already draws, lift it
into the kit rather than copying the styles — two stylesheets for one visual is
the drift itself, not a risk of it.

**A bounded numeric RANGE is a row of numbered pills, not a slider**
(`RangePills` + the pure `nextRange` in `src/ui/rangeSelect.ts`). Three reasons,
in order: a slider's thumbs are smaller than a fingertip; a horizontal drag inside
a `BottomSheet` fights the sheet's own drag-to-dismiss; and a slider needs a
tooltip to say what it's set to, where pills show it. The interaction is one rule
applied from wherever the tap lands — nothing selected takes the tapped value,
tapping outside the range grows it, tapping inside a wider range collapses to that
value, and tapping the only selected value clears. `null` means "any", which is
exactly what the filter treats as inactive, so a cleared axis and an untouched one
are the same value.

Native pickers are not automatically the lazy option. `DatePicker` is a themed
month grid rather than the Android dialog because a trip log needs the same
picker for one date and for both ends of a range: the OS dialog can't be tinted
to the scheme and would put two or three different-looking pickers on one
screen. One themed surface, reused three times, no native dependency.

**A second modal implementation is not a kit component.** `EntityEditForm` — a
field-spec-driven `Modal` edit form, never installed anywhere — was deleted
(2026-08-13) rather than kept "in case": sitting in the barrel, it offered a
future screen author a 50/50 choice between it and the sheet-based forms every
current screen uses, against §6's one-modal-surface rule. `CanyonEditSheet` and
`TripEditSheet` are the worked examples of an entity form.

The kit is presentation only. A shared component that owns permissions, file
IO or outbox writes is a FEATURE component and lives with its feature
(`src/media/MediaStrip.tsx`), even when two screens use it — otherwise `src/ui`
slowly becomes the place everything shared goes.

Current kit: `ActivitySpark` · `BottomSheet` · `Button` · `CapacityBar` ·
`Card` · `Chip` · `ChipPicker` · `DatePicker` ·
`ErrorBanner` · `HeroHeader` · `IconButton` · `RangePills` · `Row` ·
`Screen`/`ScreenScroll` · `ScreenStates` · `SectionHeader` ·
`SegmentedControl` · `StatGrid` · `StatusPill` · `TextField` · `Toast` ·
`Toggle`.

## 10. Offline is a normal state, not an error

Almost everything in this app works with no signal: reads come from the mirror,
writes queue in the outbox. So the offline UI's job is not to apologise — it is
to answer three questions, once each, without cluttering a screen that mostly
still works.

**"Am I offline?"** One `StatusPill` in the hero (`cloud-off`, `muted` tone).
Never a banner, never per-row.

**"Is my work safe?"** The question users actually have, and the one the app
never answered. A second pill counts unflushed outbox rows — "10 waiting to
sync" — and drains as they flush. Pair it with the offline pill rather than
hiding it when online: work can be queued because the server is down, not just
because you are in a canyon.

**"What can't I do right now?"** Network-only actions are **disabled with the
reason in place of their subtitle** ("Needs a connection"), never hidden. Know
which those are:

| Works offline | Needs a connection |
|---|---|
| Reading trips, canyons, notes, fields | An ACCOUNT's custom field DEFINITIONS (a guest's are local) |
| Logging, editing, deleting a trip | Downloading regions, topo overlays, GeoPDFs |
| Adding, editing, deleting a canyon | Sharing a canyon (and reading who it's shared with) |
| Attaching photos, videos, routes, tracks | Full-res media not yet downloaded |
| Viewing anything already cached | RopeWiki / file import (web only) |
| Picking a theme (device copy) | Data export (web only — needs a share sheet) |
| Rendering a saved offline region | Saving a new region (Wi-Fi unless opted in) |
| Canyon routes already cached | Canyon routes never opened on this phone |
| Turning the app lock on/off | Fetching what an auto-download found (Wi-Fi by default) |
| Every Display, Map, Offline and Privacy preference | Notification prefs, an account's field DEFINITIONS |
| — | Username, email, account deletion |

**"Needs an account" outranks "Needs a connection".** The app runs without a
Logjam account at all (guest mode — see `src/auth/capabilities.ts`, which owns
the whole matrix and is the only place either string is spelled). Telling a
guest to find signal is a dead end: they can be on full-strength Wi-Fi and the
feature still won't work. So when both are true, the row says **"Needs an
account"**.

The same disabled-with-the-reason rule applies, with one carve-out: where an
affordance can *only ever* refuse — the Protomaps vector clip on the region
download screen, which no guest can obtain — it is dropped from the list
entirely and a sentence under the rail explains why, following the existing
precedent for the unlicensed OSM basemaps. A chip that exists only to say no is
worse than no chip; a *row* has a subtitle to explain itself, so rows stay.

Never disable the way IN. The Account row and its screen are the one thing a
guest most needs, so they stay live and change wording ("Create an account")
rather than greying out.

**A gated SCREEN gates itself, not only the row that leads to it.** Disabling
the entry row is the affordance; it is not the guard. Friends and the Inbox
fetched on mount with no account check of their own, so any second way in — a
notification deep link, a share shortcut, a restored back stack — was one
guaranteed 401 per open, which is a battery cost and a permanently red sync
health line. A screen whose data needs an account reads `accountState` from
`auth/AccountStateContext` (never the preference: that read wouldn't re-render
when a guest links) and calls `capabilityScreenBlock` from
`auth/capabilities.ts`, which is where the copy is spelled. Blocked, it renders
the hero — the back affordance has to survive, or the gate is a trap — over an
`EmptyState`, and every fetch behind it stays unfired. Only "needs an account"
blocks a whole screen: a linked user offline keeps the screen and its own
offline handling (the inbox has a cache, Friends reports the failure with a
retry).

| Guest can | Needs an account |
|---|---|
| Everything in the "Works offline" column | Sharing, friends, the inbox |
| Recording tracks, importing a local GeoPDF/GPX | LiDAR topo overlays, account GeoPDFs |
| Downloading SIX raster regions (client-direct) | The Protomaps vector region clip |
| Theme, text size, every Map preference, app lock, crash reports, auto-download (device prefs) | Notification prefs |
| Their own custom fields, definitions included (kept on the device, carried up on link) | — |

**Say what is true, not what is optimistic.** A queued upload says "Uploading…"
only when it can actually upload; offline it says "Waiting". A label that
implies progress and never finishes reads as a bug, not as a queue. Same for
pull-to-refresh: offline it says so and reassures, rather than spinning into a
silent failure.

**Work that happens unasked names its own moment, and its own limit.** The two
auto-downloads — finished GeoPDFs and finished LiDAR topo overlays — check on app
start, on return to the foreground, and when a connection is regained: the same
three moments the sync engine uses, and never a background timer, because battery
is a field resource. A background feature whose conditions aren't stated reads as
broken on the day it doesn't fire, so the Settings copy states them.

**Cost and consent are two switches, not one.** "Should this happen at all"
lives with the feature (Settings → Offline and storage, top section) and "may it
happen on my mobile plan" lives in `offline/networkPolicy.ts` (same page, second
section), because a user who wants a GeoPDF the moment it is ready but only on
Wi-Fi has nothing to pick if the two are fused into one three-way control. The
policy asks `isConnectionExpensive` rather than `type === "cellular"` — a metered
hotspot is Wi-Fi by type and mobile data by cost, and the person paying for it is
who the switch is for. Per-job defaults, and they differ on purpose: the two
downloads are Wi-Fi-only (tens of megabytes, and rendering to tiles is the
expensive half), sync is allowed on mobile data (a few kilobytes, and a trip log
that waits for Wi-Fi is a trip log on one phone for the week it matters).

**A policy gates the UNASKED path only.** "Sync now" in the More hero calls
`requestSync` directly and is never gated: tapping it on mobile data IS the user
asking for mobile data, and a button that silently declines is worse than no
button.

**Content that isn't downloaded gets its own state**, not an error — "Not
downloaded to this phone yet. It will appear once you have signal."

## 11. Privacy in the UI

A design constraint, not a checklist item (see `CLAUDE.md`). Rows show generic
labels ("Offline map region"), user-supplied names, sizes and dates — **never
coordinates, bboxes or derived location detail**, however useful it would look.
When a label would have to leak location to be informative, the generic label
wins.

**A coordinate belongs on a detail screen, never in a list.** Canyon detail shows
the position, because that IS the answer to the question the screen exists for and
the user asked for that canyon by name. A list is different: it is what ends up in
a screenshot, and a screen full of name-plus-position pairs is the canyon
database this app exists not to publish.

**A "distance from me" figure is derived location detail.** A nearest-first sort
with per-row distances was designed and REJECTED for the Canyons screen for that
reason: it pairs each name with roughly where it is, in the one view most likely to
be shared, and it buys a convenience the map already provides. Don't re-propose it
without deciding to change this rule first.

**Failure copy is ours, not the error's.** A caught error goes to `console.error`
and the user gets a sentence we wrote ("Couldn't save this trip."). Interpolating
an error message into a toast is how a canyon name reaches a screenshot.

**A calendar day is the user's, not UTC's.** Date-only values are stored as UTC
midnight, but "today" for a picker or a default must come from the LOCAL clock
(`todayDateKey`). Reading it in UTC greys out the current day for the first
hours of every AEST morning — the user cannot log the trip they just got back
from.

**A privacy guard survives being useful.** The Sync issues screen exists to show
you the field values the server refused — and a parked canyon create carries
latitude/longitude. `previewValue` in `src/screens/syncIssueDisplay.ts` refuses to
render those two fields whatever the op holds, and it lives in its own pure module
with its own test for exactly that reason: this is the page most likely to end up
screenshotted into a bug report.

**Nothing is autosaved outside the app's own storage.** The web keeps a
half-written trip in `localStorage`; mobile deliberately has no equivalent —
form state lives in component state and goes out only through the outbox's
authed push. The OS doesn't reclaim a foreground sheet the way a browser evicts
a tab, so the draft would be a persistent copy of canyon names and notes bought
for no benefit.

## 12. Theme: chosen at any time, applied at launch

The four schemes live in `shared/src/themeSchemes.ts` and are picked in
Settings → Display. The mobile app applies a change **at the next launch**, and
says so. The TEXT SIZE multiplier on the same page works the same way and for the
same reason (`fontSize` is snapshotted by the same `StyleSheet.create` calls).

That is a real limitation, chosen deliberately. `theme` is a module constant, and
~45 files snapshot it into `StyleSheet.create` at import time; repainting a running
app means a theme provider plus a style factory in every one of those files, which
is a large diff across every screen already built for the sake of a preference
people set once. The trade was taken with the ceiling documented rather than hidden.

What the implementation must keep true:

- **The device's copy is the one that paints.** `theme.ts` resolves the scheme
  synchronously at module evaluation from `prefsDb` (its own tiny
  `logjam-prefs.db`, opened with `openDatabaseSync` — everything else here is
  async, and this has to answer before the first `await` exists). No network, so
  the app opens in the user's colours in a canyon.
- **The account's copy is what follows the user.** Settings PATCHes
  `themeSchemeId`, and `AppShell` mirrors the account value back onto the device
  whenever they differ — so a scheme picked in the browser is what this phone
  opens in next time.
- **The picker shows the CHOICE, not the paint.** Selection tracks the account
  value; the "applies next time you open Logjam" note appears exactly when the
  choice and `activeThemeSchemeId` disagree. That covers a change made here AND a
  change made in a browser since this app started.
- **Swatches carry a hairline border.** Sandstone's `secondary` IS the card colour
  they sit on, so without an edge that swatch vanishes and the scheme looks like it
  has two colours.
- A device that refuses the write says so (`persistThemeSchemeId` returns false →
  toast). A selection that silently reverts on the next launch is the one failure
  this must not have.
- **The text multiplier is on top of the OS one, and the PAIR is capped.** Android
  already scales every `<Text>` by its own font setting, so ours multiplies it;
  `clampTextScale` gives up its own headroom to keep the combination at or under
  2×, which is where the row layouts stop fitting. Type scales, spacing and radius
  do not — growing the padding with the text pushes a row's content off the edge
  instead of making its words bigger.
