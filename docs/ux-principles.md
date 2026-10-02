# UX principles

The rules every screen in Logjam follows, on both clients. Logjam GPS is used in
the field, often in a canyon with no signal, cold hands and the sun on the
screen; Logjam Web is used at home, planning and tidying up. They are one
product: a user who learns a rule on one should find it holding on the other.

This file holds what is true whatever the medium. How each client applies a
rule (a sheet or a dialog, a tap or a click, `hitSlop` or a CSS hit area) is in
its own design file: [`frontend/DESIGN.md`](../frontend/DESIGN.md) for Logjam
Web and [`mobile/DESIGN.md`](../mobile/DESIGN.md) for Logjam GPS. A decision
both clients make is declared once in `@logjam/shared` and read by both
(§12); the reasoning is in
[ADR 0020](decisions/0020-share-the-decision-not-the-drawing.md).

Each rule is a sentence you can check a screen against. Where a test enforces
it, the rule names the test.

## 1. The field comes first

- **Readable in full sun.** The Daylight scheme is for direct sunlight: dark
  text on a light page, every text pair at 7:1 or more. The four dark schemes
  are for dusk, night and indoors, and hold the WCAG AA floor: 4.5:1 for text,
  3:1 for a glyph, an edge or a control. Guard: `scripts/wcag-contrast.mjs`
  measures every pair under every scheme, in CI.
- **Pressable by a cold, gloved or wet finger.** On a touch screen every
  pressable thing takes a 48×48 dp hit area, even when it is drawn smaller.
  A mouse may have smaller targets, never under 24px (WCAG 2.5.8).
- **The map is the main thing in the field.** On the map, chrome is the least
  it can be: no permanent labels, no pinned cards, a badge only while what it
  says is true. A running job is a light, not a readout: one glyph that says
  "still going", with the numbers one press away.
- **Offline is normal, not an error.** Almost everything works with no signal.
  The UI answers three questions, each once: am I offline, is my work safe
  (what is waiting to sync), and what can't I do right now (§5).
- **A tired user never meets an ambiguous destructive action.** Anything that
  loses data takes two steps: the verb, then a confirm that says what goes and
  what stays (§9). The confirm's destructive button is the only place the
  warning fill appears.

## 2. A screen answers one question

- **Every screen leads with the question its user opened it to answer, and
  answers it before any list.** Places: "how far through my list am I?";
  Logs: "what have I done?"; the Inbox: "what happened while I was away?". The
  answer is the hero, sized to how much the user came for it: usually one line.
- **A screen with no question to answer has no hero.** Settings is a list. The
  map is the answer, so it has no hero at all.
- **Pin what you work in; scroll only the list.** The hero and the filter rail
  stay put; only the list moves. Never a scroll container inside another
  scroll container unless the inner one is locked at its edges.
- **One pinned filter axis per screen.** More precise filters live one press
  away and announce themselves while active ("3 filters active"), so a list is
  never narrowed by something the user cannot see.
- **A list that grows without limit never shares a scroller with one that
  does not.** The short list is the one that disappears; give each its own tab
  and put the count on the tab.
- **A section header belongs to what follows it**: the space above a heading
  is bigger than the gap between the rows it groups.
- **A heading divides a list from something.** "Yours" earns a line only when
  "Built in" is opposite it.

## 3. Getting around and getting out

- **Every surface has a visible way out, in the same place every time.** A
  screen you were pushed to has a back arrow at its top left. A sheet, dialog
  or popover has a close (×) at its top right. A form has Cancel beside its
  submit. These are learned shapes that feel safe; never leave a user with
  only a gesture, a system button or a guess.
- **The way out goes back one step, not all the way.** A sub-view inside a
  sheet or dialog (a picker, a settings group) backs out to its parent, never
  out of the surface, and the title says which step you are on. Escape, the
  system back gesture and the close button each undo exactly one layer.
- **A page fills a phone.** On a phone-sized screen, a page takes the whole
  screen and is left with its back arrow or the tab bar, on both clients.
  Sheets that rise over the map are for choosing and acting (a pin's verbs, a
  layer), not for pages.
- **Opening a thing brings the map to it.** Opening a place, a way or a topo
  from any list fits the map to it, so the page and the map talk about the
  same ground.
- **One gesture, one meaning.** A press on a pin, a row or a line does the
  same thing whichever screen is up. A tap asks ("what is here?"); a
  press-and-hold commits ("put something here").

## 4. What can be pressed looks pressable

- **A card's fill means "press me".** A thing you can open or press sits on
  the card colour; a thing you only read sits on the page, grouped by space, a
  section header or a hairline. So the eye learns one rule: filled is
  interactive. Exempt, because each has its own look: buttons, chips, text
  fields, switches, the surfaces themselves (sheets, dialogs, popovers, toasts)
  and the map's chrome.
- **Things that look alike behave alike.** Two rows drawn the same way open
  the same way; two chips drawn the same way filter the same way. If something
  behaves differently, it looks different. This is why the kit exists: one
  component per look (§12).
- **A pressable thing answers the press at once**, with a pressed (touch) or
  hover (pointer) state. Nothing that is not pressable answers a pointer: a
  chart, a read-only row and a mark beside a title stay still.
- **A control a hover reveals does not exist on a touch screen.** Anything a
  pointer uncovers must be always visible where the pointer is coarse.
- **A thing that does something on press says so on itself**: a copyable
  value carries a copy glyph; a file's row says "Click to download".
- **A chart is not an affordance.** Nothing that looks tappable is
  untappable, and nothing that is tappable looks inert.

## 5. Absent, disabled, or there

- **Absent when it can never apply here.** A verb that the thing cannot have
  (Delete on a place a friend shared, Rename on a built-in field) is not
  drawn. The user does not need to know it exists. Fewer options, less strain.
- **Disabled when it could apply, but not now**, and it says why: "Needs a
  connection", "Needs an account", "Nothing to mark as read". The reason sits
  where the control is (its subtitle, or the line under it), reaches a screen
  reader, and points to the way out of the state. A disabled control looks
  disabled: dimmed, and it does not answer a press.
- **"Needs an account" outranks "Needs a connection".** Telling a guest to
  find signal sends them looking for a fix that will not work.
- **Submit is never disabled for validation.** Pressing it is how the user
  learns what is missing; a greyed Save says something is wrong and not what.
  Disable it only while saving, or for a capability the user lacks.
- **Never disable the way in.** The one thing a blocked user needs (sign in,
  create an account) stays live.
- **A control that is saving disables itself, not its neighbours.** One
  switch in flight does not grey the whole list.
- **A limit the server enforces is a rule the UI shows, not an error to
  discover.** A place holds one route, so the "add" becomes "Replace" once one
  is there, rather than offering a second that will be refused.

## 6. One idea, one icon

- **An icon stands for an idea, and the idea keeps its icon everywhere**, on
  both clients: delete is always the same bin, close is always the same ×,
  shared is always the same people glyph. The ideas and their glyphs are one
  declaration in `@logjam/shared`, and each client draws its own glyph family
  from it.
- **One icon never means two things.** A × that closes a sheet is not also
  the × that removes a chip's filter, unless both are "make this go away".
- **An icon-only control has a name**: its accessible label, which is also its
  tooltip on a pointer. If the glyph needs a sentence to be understood, the
  glyph is wrong.
- **A verb pairs its glyph with words where there is room.** A menu item is a
  glyph and a verb ("Rename"); a bar of bulk verbs may be glyphs alone.

## 7. Colour

- **Colour tokens are named for their role** (page, card, text, accent,
  warning…), never for a hex or a rank. A screen never writes a colour: it
  names a role, and the scheme decides the colour.
- **Words are text-coloured.** Body text is `text`, secondary text is
  `textMuted`. The accent, warning and success colours are fills, edges and
  glyphs, never the colour of words, so a label is legible on every scheme.
- **Anything drawn on a fill uses the one ink, `onFill`.** A filled button's
  label, an active chip's label, the glyph on a tile.
- **A kind's hue is a fill.** The hue that says what a thing is (a GeoPDF, a
  track, a place type) appears as a filled tile, a filled chip, a swatch or a
  mark on the map, never as a glyph or a word on a surface.
- **Colour is never the only signal.** A hue always travels with a glyph, a
  word or a shape. A selected row has an accent edge and a check, not just a
  tint.
- **One hue is reserved for "shared"**, and it means nothing else. A shared
  place is the same mark as your own with a ring around it.
- **A colour drawn on the user's photo is not a theme colour.** Controls over
  a photograph are black and white with a scrim: no scheme can promise
  contrast against an arbitrary picture.

## 8. Identity: a kind has one glyph and one hue

- **Anything with kinds gets a glyph and a hue per kind, from one map, used
  everywhere the kind appears**: its row's tile, its active chip, its map
  mark, its entry in an "add" menu, the notification about it. Recognising a
  thing again where it lives is what makes the app feel like one place.
- **A hub menu is not a set of kinds.** Inbox, Friends and Settings are
  destinations, so they share one look; inventing a palette for a menu is
  decoration.
- **Open vocabularies hash their hue from the label**, so a user's own trip
  type keeps its colour across sessions, devices and reorderings.
- **A kind names what a thing IS; where it lives is a property of its row.**
  A rail that mixes the two ("Tracks", "Imports", "On a place") is a category
  invented for a gap.
- **Show the thing, not a glyph standing in for it**, where the thing can be
  shown: a basemap's row is a preview of that basemap.

## 9. Lists, rows and verbs

- **The body opens; the ⋯ acts.** Pressing a row opens the thing; its verbs
  are behind its ⋯. A row with nothing to open is not pressable at all, and
  so (§4) has no card fill.
- **A thing offers the same verbs wherever it appears**: its row, its page,
  its pin on the map. The lists differ by at most one verb (Open, absent on
  the page you are already on). The verbs and their confirm copy are declared
  once per kind.
- **A property is changed in place; a verb is in the menu.** A colour or a
  linked place is a control on the page; Edit, Share, Export and Delete are
  menu items.
- **Destructive verbs confirm, and the confirm says what goes and what
  stays**: "Their photos and tracks go too. Trips that link to them stay in
  your logbook, unlinked." Removing your access to something shared is not
  deleting it, and never wears the destructive look.
- **Selection is a state of the row**, an accent edge and a check, never a
  tint that drops a subtitle's contrast. Selecting starts from the row
  (press-and-hold on touch, the tile on a pointer); the bulk bar takes the
  filter rail's place at the same height, so the list never jumps.
- **A list of things that happened runs newest first** and never re-sorts
  itself because the user acted on a row: marking a notification read must
  not move it.
- **A tally answers "what would I get"**: a chip's count applies every filter
  but its own. A chip the other filters have emptied stays, disabled.
- **A list the server cut short says so**, and so does anything counted from
  it.
- **A list with no sort control still has an order: newest first.** A row
  with no date sorts last, never given an invented one.
- **What a row's press does follows from what the thing is.** A thing with a
  page opens it; a thing with nowhere to open does its one obvious job (a
  file downloads, a template makes a map), and that job is also the first
  item in its ⋯, so the press is never the only way to it.
- **A list you act on in bulk lets you pick**, never only "do it to all".
- **One intent is one verb.** Keeping a friend's route and dropping their
  share is "Save to my Ways and remove", ordered so a failure halfway leaves
  the user with both, never neither.
- **Visibility belongs to the layer**, not to a switch on each thing's page.
- **A row's subtitle says something the user cannot already see**: never the
  filter they are standing in, the heading above, or the pill beside it. A
  navigation row's subtitle is live state ("3 unread"), never a description.
- **Two facts get two looks.** "Shared with you" (a permission someone can
  take back) and "you shared this with 3" (a count you control) must not be
  one word apart in the same slot.
- **Labels wrap; they do not ellipsise**, except a user-supplied title, which
  stops at two lines.
- **An inventory row is one thing the user asked for**, not one file the app
  wrote: a saved area of three basemaps is one row, with its files inside.

## 10. Surfaces

- **A dialog (on Logjam GPS, a sheet) is for making and changing; a page is
  for looking.** Creating or editing is a task that ends in Save or Cancel.
  Reading a place or a trip is not a task, so it is a page you can leave open
  and follow links from. A dialog is never the only way to read something.
- **One modal at a time.** A confirm may stand over the form it acts for;
  nothing else opens a modal from a modal. A second view of the same task
  replaces the body in place and backs out to it (§3).
- **A form names a thing once, when it is created.** Editing keeps the name.
  Abandoning a new thing loses it ("Discard this route?"); abandoning an edit
  loses only the changes ("Discard your edits?"); an edit that changed nothing
  asks nothing.
- **A long errand belongs in a sub-view, not above the task.** Instructions
  for something done once in another app open one press away ("Haven't got
  one?"), not in the form's best space.
- **One form per thing, for creating and editing**, differing only in its
  title and submit label. Two forms drift.
- **Rename in a form, never in a live field on the row.** A field that saves
  on blur gives no way to abandon the rename.
- **A step that asks nothing is skipped, never shown empty.**
- **A shortcut into a form hands off to the real form, pre-filled.** "Log a
  trip here" opens the trip form with the place already linked.
- **An edit sends only what changed.**
- **An optional value's picker keeps a "not recorded" stop** ("—"), or "I
  don't know" becomes a wrong answer.
- **Lowering a guard costs an authentication; raising it is free.** Turning
  the app lock off asks for the device's unlock; turning it on does not.

## 11. States and feedback

- **Loading is not empty.** A list whose first load has not landed says it is
  loading; it never flashes the first-run empty state. A load that failed is
  neither: it says it failed, with Try again.
- **An empty screen says what would be here and offers the way in.** A
  filtered-empty list says nothing matches and offers Clear filters. An empty
  slot inside a page gets a short label, not a lesson.
- **An error is shown in one of three places**, by what failed: under the
  field it belongs to; above the submit button of a form that is still open;
  or in a toast once the form has closed or the failure was in the
  background. The words are ours ("Couldn't save this trip."), never an
  error's message.
- **A toast reports the outcome of an action.** It goes on its own, after
  long enough to read, pauses while hovered or focused, and errors stay longer
  than confirmations.
- **Say what is true, not what is hopeful.** A queued upload offline says
  "Waiting", not "Uploading…". A layer that draws part of the picture says
  which part is missing.
- **Work the user pays for in time or storage is priced before they commit**,
  and the price updates as they change it.
- **Progress stays in view while it is watched**: a job being made is pinned
  where its page shows it, not at the top of a list that scrolls away.
- **A list the server expires says so where it is listed** ("Kept for 7 days
  after they're made").
- **A count is a number, not a sentence**, and a zero is left out rather
  than printed as "0 skipped".
- **A value is never cut.** A dense tool may be cramped on a small screen; it
  may not show a coordinate as "150.3".
- **Two numbers on one surface mean the same thing**, in the same unit, or
  one of them is wrong.
- **Blank beats plausible-but-wrong.** Outside the map data you have, the map
  shows nothing rather than a blurred guess.
- **One place on a screen talks to the user.** Notices stack in one column;
  four status lines in four corners is the anti-pattern.
- **Motion respects reduced motion.** Anything that slides, fades or pulses
  has a still version.

## 12. Copy and helper text

- **Name the surface: Logjam Web or Logjam GPS**, never "the app" where
  either could be meant.
- **Sentence case** for buttons, titles, labels and menu items; uppercase only
  for section headers. A button is a verb: "Make a map", not "Map".
- **Helper text is the exception, not the default.** A label and an icon
  should be enough. Where they are not, the hint is one sentence in plain
  words that says what the setting MEANS, never what the control does, and an
  example beats a rule: "315° is what most maps use", "A4 is 210 by 297". A
  setting whose label says it gets no hint at all.
- **A screen used daily spends no prose; a screen visited once when confused
  may explain itself** (resolving sync problems), and even there every line
  must change what the user does next.
- **A caveat true of the whole app lives in the Terms**, not on one screen.
- **"Try again", never "Retry", and only where trying again can help.**
- **Counts are pluralised by rule**: "1 place", "37 places".
- **No internal words**: not "basemap", "tiles", "the server" or "sync
  conflict shelf" where the user's word is "map", "map data" or "Logjam".
- **A verb names what the user wants, not the calls behind it**: "Merge into
  another type", not "Move places".
- **A sentence about what someone else can or cannot do is a claim about the
  API**, and is checked against the API before it ships.
- **Name the thing that failed**: "Download didn't finish", never "That
  didn't work".

## 13. Privacy in the UI

- **A coordinate belongs on a thing's own page, never in a list.** A list is
  what ends up in a screenshot. An area is summarised by its size ("18 × 11
  km"), never its corners. No "distance from me" column.
- **Nothing a user types about their places leaves the device by default.**
  Search matches places locally; asking a public geocoder is a separate,
  explicit choice.
- **Failure copy is ours**, so an error message can never carry a place name
  into a screenshot or a report.
- **No telemetry, no analytics, and no third-party request keyed to user
  data.** Root `AGENTS.md` → Privacy has the full rule.

## 14. How the system is kept

- **A decision both clients make is declared once in `@logjam/shared`**, with
  a test, and both clients read it: colour and scale tokens
  (`designTokens.ts`, `themeSchemes.ts`), the icon for each idea, the kit's
  component list, each shared screen's contract (its sections, order, copy and
  empty states), and the words, verbs and predicates behind them.
- **The kit is the only way to draw a shared shape.** A screen composes its
  client's kit; a screen that needs a shape the kit lacks adds it to the kit,
  on both clients when both need it, under the same name.
- **A new colour pair is measured before it ships** (`scripts/wcag-contrast.mjs`).
  Its list of known failures only shrinks.
