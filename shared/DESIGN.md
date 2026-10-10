# Logjam design

The rules every screen follows on both clients. Read this, then the client's
own file, which holds only what its medium changes:
[`frontend/DESIGN.md`](../frontend/DESIGN.md) for Logjam Web,
[`mobile/DESIGN.md`](../mobile/DESIGN.md) for Logjam GPS.

Logjam GPS is used in the field: no signal, cold hands, sun on the screen.
Logjam Web is used at home, planning and tidying up. A rule learned on one
holds on the other.

**Code outranks this file.** A design decision is declared once in
`shared/src/` and drawn once in each client's kit (`src/ui`); a rule that a
token, a kit prop, a contract or a test can hold lives there and is not
written here. Prose is only for what code cannot hold. Before adding a line,
try to make it code; when you convert a rule to code, delete its line.

| Decision | Declared in |
|---|---|
| Colour roles and schemes, space, radius, type, control sizes | `designTokens.ts`, `themeSchemes.ts` |
| Which glyph stands for an idea | `icons.ts` |
| Which components the kit has, on which client | `KIT_COMPONENTS` in `kit.ts` |
| A shared screen's sections, order, words, verbs and empty states | `contracts/` |

Section numbers are cited from code comments: add sections at the end, never
renumber.

## Every UI change

1. Open the other client's counterpart first. A screen both have is drawn
   from its contract: iterate its sections and read its words; to change what
   the screen holds, change the contract.
2. Compose the kit. A shape it lacks is added to the kit, under the same name
   on both clients when both need it. Never style around it.
3. Name roles, never values: a colour role, a space step, an icon idea.
4. Look at it in all four schemes, on seed data only: at 1440 and 390 wide
   for Logjam Web, on a device or emulator for Logjam GPS.
5. Changing a convention changes its line here, or its client's file, in the
   same commit.

## 1. The field comes first

- **Readable in full sun.** Ghost Gum is the sunlight scheme: every text pair
  at 7:1 or more. The dark schemes hold AA: 4.5:1 for text, 3:1 for a glyph,
  an edge or a control. A new foreground/background pair joins
  `scripts/wcag-contrast.mjs`, measured on the surface it renders on; its
  known-failures list only shrinks.
- **A touch target is 48×48 dp**, even when drawn smaller. A mouse target is
  never under 24px.
- **On the map, chrome is the least it can be**: no permanent labels, no
  pinned cards, a badge only while what it says is true. A running job is one
  glyph, its numbers one press away.
- **Offline is normal, not an error.** The UI answers three questions, once
  each: am I offline, is my work safe, what can't I do right now (§5).
- **Anything that loses data takes two steps**: the verb, then a confirm
  (§9). The confirm's button is the only place the warning fill appears.

## 2. A screen answers one question

- **Lead with the question the user opened the screen to answer, and answer
  it before any list.** The answer is the hero, usually one line. A screen
  with no question (Settings) has no hero; the map is its own answer.
- **Pin the hero and the filter rail; only the list scrolls.** No scroller
  inside a scroller.
- **One pinned filter axis per screen.** Finer filters are one press away and
  say so while active ("3 filters active").
- **A list that grows without limit never shares a scroller with one that
  does not.** Give each a tab, with its count on the tab.
- **The space above a section header is bigger than the gap between the rows
  under it.**
- **A heading needs a second group to divide from.** "Yours" earns a line
  only when "Built in" is opposite it.
- **A pill, badge or notice centres its text in itself**, not only itself on
  the screen.
- **Capitals mark a section heading and nothing else.** A field or control
  label is sentence case, small and muted.
- **A title does not repeat a count the screen already shows.**
- **A pair is drawn on one line** (ascent and descent, highest and lowest);
  a figure with no partner takes the whole line. Pairs: `statPairs.ts`.

## 3. Getting around and getting out

- **Anything that can be closed has a × at its top right**: a sheet, a
  dialog, a popover, a panel beside Logjam Web's map. A pushed screen has a
  back arrow at its top left, and keeps the × if the surface under it can
  close. A form has Cancel beside its submit. A root tab on Logjam GPS has
  neither. Never leave only a gesture, a system button or a second press on a
  nav icon.
- **A tab opens at its root**, not the sub-page the user was last on.
- **The way out undoes one layer.** A sub-view inside a sheet or dialog backs
  out to its parent, and the title names the step. Escape, the back gesture
  and × each undo exactly one layer.
- **A page fills a phone**; it is left by its back arrow or the tab bar. A
  sheet over the map is for choosing and acting, never for a page.
- **Opening a place, a way or a topo fits the map to it**, in the one
  function that opens it, never per caller. So where the map sits beside the
  page (Logjam Web) there is no "Show on map" verb; where the page covers the
  map (Logjam GPS) there is.
- **One gesture, one meaning**, whichever screen is up. On the map a tap asks
  ("what is here?") and a press-and-hold commits ("put something here").

## 4. What can be pressed looks pressable

- **A fill means "you can act here".** A thing you can open or press sits on
  the card colour, as does a row holding its own controls. A thing you only
  read sits on the page, grouped by space, a section header or a hairline.
  Exempt: text fields, switches, the surfaces themselves and the map's chrome.
- **Small things follow it.** A button wears the card fill; a surface's one
  primary action wears the accent. A status pill is read, so it has no fill:
  words with a dot or a glyph. A selected chip looks like neither. A badge on
  something pressable (an unread count, a chip's tally) keeps its fill.
- **A pill is never narrower than it is tall.**
- **Things that look alike behave alike**; a thing that behaves differently
  looks different.
- **A pressable thing answers the press at once** (pressed or hover state),
  and nothing else answers a pointer: a chart or a read-only row stays still.
- **A control a hover reveals is always visible on a coarse pointer.**
- **A press with a non-obvious effect says so on the thing**: a copyable
  value carries a copy glyph; a file's row says "Click to download".

## 5. Absent, disabled, or there

- **Absent when it can never apply here** (Delete on a place a friend
  shared).
- **Disabled when it could apply but not now, and it says why** where the
  control is: "Needs a connection", "Needs an account", "Nothing to mark as
  read". The reason reaches a screen reader.
- **"Needs an account" outranks "Needs a connection".**
- **Submit is never disabled for validation**: pressing it is how the user
  learns what is missing. Disable it only while saving, for a capability the
  user lacks, or for type-to-confirm.
- **Never disable the way in** (sign in, create an account).
- **A control that is saving disables itself, not its neighbours.**
- **A limit the server enforces is shown, not discovered**: a place holds one
  route, so "Add" becomes "Replace" once one is there.

## 6. One idea, one icon

- **An idea keeps its glyph everywhere, and a glyph never means two ideas.**
  Draw `<Icon idea=…>`; a new idea joins `icons.ts`.
- **An icon-only control has a label**, which is its accessible name and its
  tooltip. If the glyph needs a sentence, the glyph is wrong.
- **A menu item is a glyph and a verb.** A bulk bar may be glyphs alone.

## 7. Colour

- **A screen names a role, never a colour**; the scheme decides the colour.
- **Words are `text` or `textMuted`.** Accent, warning and success are fills,
  edges and glyphs, never the colour of words.
- **Anything drawn on a fill uses `onFill`.**
- **A kind's hue is a fill**: a tile, a chip, a swatch, a map mark. Never a
  glyph or a word on a surface.
- **Colour is never the only signal**: a hue travels with a glyph, a word or
  a shape. Selected is an accent edge and a check, not a tint.
- **One hue means "shared" and nothing else**: a shared place is your own
  mark with a ring.
- **Controls over a photo are black and white on a scrim**, not theme
  colours.

## 8. Identity: a kind has one glyph and one hue

- **Anything with kinds takes a glyph and a hue per kind from one map**, used
  wherever the kind appears: row tile, active chip, map mark, "add" menu,
  notification. A notification borrows the hue of the thing it is about.
- **A menu of destinations is not a set of kinds**: Inbox, Friends and
  Settings share one look.
- **An open vocabulary hashes its hue from the label**, so it survives
  sessions and reordering.
- **A kind names what a thing is; where it lives is a property of its row.**
  Never a rail mixing the two.
- **Show the thing where it can be shown**: a basemap's row is a preview of
  that basemap.

## 9. Lists, rows and verbs

- **`Row` is the only list row.** The body opens; the ⋯ acts. Trailing
  order: metric, status, ⋯. A row that asks a question (accept or decline)
  answers it in its footer.
- **What a press does follows from what the thing is.** A thing with a page
  opens it. A thing whose only home is the map (a way, a GeoPDF, a saved map,
  a LiDAR topo) opens on the map. A thing with nowhere to open does its one
  job (a file downloads), which is also first in its ⋯. A row with nothing to
  do is not pressable and has no fill.
- **A thing offers the same verbs on its row, its page and its pin**, minus
  Open on the page. Verbs and their confirm copy are declared once per kind;
  a verb the API refuses is absent from the declaration.
- **A property is changed in place; a verb is in the menu.** Colour and the
  linked place are controls on the page; Edit, Share, Export, Delete are menu
  items.
- **A destructive confirm says what goes and what stays, and counts it**:
  "Their photos and tracks go too. Trips that link to them stay, unlinked."
  Removing your access to something shared is not deleting it and never wears
  the destructive look.
- **Selection is an accent edge and a check on the row**, never a tint. The
  bulk bar takes the filter rail's place at the same height, and carries only
  verbs that are better in bulk. A list you act on in bulk lets you pick,
  never only "do it to all".
- **Things that happened run newest first**, as does any list with no sort
  control; a row with no date sorts last. Acting on a row never re-sorts the
  list.
- **A chip's tally answers "what would I get"**: it applies every filter but
  its own. A chip the other filters emptied stays, disabled.
- **A list the server cut short says so**, as does anything counted from it.
- **A list ends with the button its empty state offers** ("Import a GeoPDF").
- **One intent is one verb**, ordered so a failure halfway leaves the user
  with both, never neither ("Save a copy and remove").
- **Visibility belongs to the layer**, not a switch on each thing's page.
- **A subtitle says something the user cannot already see**: not the active
  filter, the heading or the pill beside it. A navigation row's subtitle is
  live state ("3 unread"), never a description.
- **Two facts get two looks**: "shared with you" and "you shared this with 3"
  are never one word apart in the same slot.
- **Labels wrap, never ellipsise**; a user's own title stops at two lines.
- **An inventory row is one thing the user asked for**, not one file the app
  wrote.

## 10. Surfaces

- **A dialog (a sheet on Logjam GPS) is for making and changing; a page is
  for looking.** Never the only way to read something.
- **One modal at a time.** A confirm may stand over the form it acts for;
  otherwise a second view replaces the body in place and backs out to it.
- **One form per thing, for creating and editing**, differing only in title
  and submit label. A shortcut ("Log a trip here") opens the real form,
  pre-filled.
- **Abandoning a new thing confirms losing it; abandoning an edit confirms
  losing the changes; an untouched form asks nothing.**
- **Rename in a form, never in a live field on the row.**
- **A long errand done once elsewhere is a sub-view one press away**
  ("Haven't got one?"), not instructions above the form.
- **A step that asks nothing is skipped.**
- **A colour is picked from a floating palette opened from its swatch**
  (`ColourField`).
- **An optional value's picker keeps a "not recorded" stop ("—").**
- **Lowering a guard costs an authentication; raising it is free.**
- **An edit sends only what changed.**

## 11. States and feedback

- **Loading is not empty, and failed is neither.** A first load says it is
  loading; a failed one says so, with Try again.
- **An empty screen says what would be here and offers the way in.** A
  filtered-empty list offers Clear filters.
- **An error has one place**: under its field; above the submit of a form
  still open; a toast once the form has closed or the failure was in the
  background. The words are ours ("Couldn't save this trip."), never an
  error's message, which can carry a place name.
- **A requirement shows on submit; a limit shows live.** An error clears when
  its field is edited.
- **A toast reports an outcome and goes on its own**; errors stay longer.
- **Say what is true, not what is hopeful**: a queued upload offline is
  "Waiting", not "Uploading…".
- **A preview shows the result as it will be made**: framing a map's area
  shows the basemap it will be printed from.
- **Work that costs time or storage is priced before the user commits.**
- **Progress stays in view while it is watched.**
- **A list the server expires says so** ("Kept for 7 days").
- **A count is a number, not a sentence; a zero is left out.**
- **A value is never cut**: no coordinate shown as "150.3".
- **Two numbers on one surface mean the same thing in the same unit.**
- **Blank beats plausible-but-wrong**: no map data, no blurred guess.
- **One place on a screen talks to the user.** Notices stack in one column.
- **Anything that moves has a still version** for reduced motion.

## 12. Copy and helper text

- **Name the surface: Logjam Web or Logjam GPS**, never "the app".
- **Sentence case; a button is a verb** ("Make a map", not "Map").
- **Helper text is the exception.** Where a label and an icon are not enough:
  one plain sentence saying what the setting means, an example over a rule
  ("315° is what most maps use"). A label that says it gets no hint.
- **A screen used daily spends no prose.** A screen visited once when
  confused may explain itself, if every line changes what the user does next.
- **"Try again", never "Retry"**, and only where trying again can help.
- **Counts pluralise**: "1 place", "37 places".
- **No internal words**: "map", "map data", "Logjam", not "basemap", "tiles",
  "the server".
- **A verb names what the user wants, not the calls behind it** ("Merge into
  another type").
- **Name what failed** ("Download didn't finish").
- **A sentence about what someone else can see or do is checked against the
  API** before it ships.

## 13. Privacy in the UI

- **A coordinate belongs on a thing's own page, never in a list**: lists end
  up in screenshots. An area is its size ("18 × 11 km"), never its corners.
  No "distance from me" column.
- **Search matches places locally.** Asking a public geocoder is a separate,
  explicit choice.
- **Failure copy never carries a place name, coordinate, tag or field.**
- Root `AGENTS.md` → Privacy holds the rest.

## 14. Keeping the system

- **A feature on one client exists on the other, with the same verbs and
  words**, unless the contract records why not: the medium cannot do it, or
  the job it serves only happens on the other client (a GeoPDF is made to be
  printed, so it is made on Logjam Web). "Not built yet" is a gap to log, not
  a reason.
- **One look, one component.** Extend a kit component with a prop before
  adding a file; the kit does looks, a screen does layout.
- **The kit is presentation only.** A component that owns permissions, file
  IO or writes lives with its feature.

## 15. The map

- **Two edges, two jobs.** The action edge: layers, tools, locate. The
  instrument edge: compass and scale, nothing that changes the app.
- **Tools share one button whose tray opens sideways**; arming one closes
  it. A tool a client lacks is absent, not disabled. A tool's own settings
  live with the tool, not in Layers.
- **Notices sit in one stack** and say only what is true right now.
- **Overlays divide by what a thing is** (Places, Ways, LiDAR topos). Whose
  it is lives on the thing: the shared ring, the shared row mark.
- **Colours drawn on the map are `MAP_INK`**: they belong to the basemap,
  not the scheme.
- **Offline, the map is blank outside saved regions.**
