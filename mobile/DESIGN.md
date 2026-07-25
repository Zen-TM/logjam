# Mobile design conventions

The house style for the Logjam RN app. **Reference implementation:
`src/saved/SavedScreen.tsx`** — when a rule here is ambiguous, read that screen.

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
- Logs → "what have I done?"

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

A rail cues its own scrollability: **either** edge dissolves into the page
colour when there is content past it (`SegmentedControl`'s `EdgeFade`, an
`expo-linear-gradient` fade to `theme.primary`, `spacing(6)` wide). Both sides,
driven by scroll offset — a fade on only one end still leaves a hard-sliced chip
at the other, and a fade shown at rest dims a chip with nothing behind it. Use a
real gradient for any fade; stacked alpha steps band visibly.

Current kit: `Button` · `CapacityBar` · `Card` · `HeroHeader` · `IconButton` ·
`Row` · `Screen`/`ScreenScroll` · `ScreenStates` · `SectionHeader` ·
`SegmentedControl` · `StatGrid` · `StatusPill` · `TextField` · `Toast` ·
`Toggle` · `BottomSheet` · `EntityEditForm` · `ErrorBanner`.

## 10. Privacy in the UI

A design constraint, not a checklist item (see `CLAUDE.md`). Rows show generic
labels ("Offline map region"), user-supplied names, sizes and dates — **never
coordinates, bboxes or derived location detail**, however useful it would look.
When a label would have to leak location to be informative, the generic label
wins.
