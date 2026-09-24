# Dialogs — Logjam

Every dialog here is built on the kit `Dialog` (`frontend/DESIGN.md` §6). MUI
was uninstalled on 2026-09-19 (Phase C), and the Shell / DialogTitle /
DialogContent / Buttons / Form-inputs sections this file used to carry described
its furniture — they are cut rather than left to mislead, along with the
`csvImport/dialogStyles.ts`, `csvImport/SectionLabel.tsx` and
`styles/shared.module.css` they named, all three deleted. DESIGN.md is where a
dialog's shape, its footer verbs and its sub-views are decided now.

## Touch targets

A compact control (an icon button, a small text button, a checkbox) grows its
HIT AREA to 44x44 through a centred pseudo-element while its rendered box stays
put, so the target meets HIG/Material/WCAG without changing the form's vertical
rhythm. The kit does this for you — `IconButton`, `Checkbox` and `Button compact`
all carry it.

Don't "fix" this by forcing a visual 44px onto every control instead: measured on
the Log Trip form at 390x844, that adds **77px** of scroll and pushes the whole
attribute stack under the soft keyboard, for controls whose mis-tap cost is zero
(a 342px-wide text field). The pseudo-element expands into the row's dead gap
only — it never overlaps the neighbouring input's target.

A dialog's FOOTER buttons are the exception that gets a real height: they are the
primary actions and sit outside the scrolling body, so the pixels are free.

## Multiline notes

A notes field is the kit's `TextArea`, which grows with what is typed and stops at `maxRows` (12 by default, in `ui/TextField.tsx`) — never a fixed height, which nests a scrollbar inside an already-scrolling dialog. `minRows` is the per-dialog choice; the cap is the kit's.

## Conventions log (additive)

- **Attaching media before an entity exists (TripLogDialog):** lazy-draft pattern — first upload creates a draft row to link files to; Save PATCHes it; Cancel/close DELETEs it (cascade removes media). Avoids orphan rows when user cancels without uploading.
- **A form that shows a SUBSET of the definitions must write that subset.** `PlaceDialog` renders `defsForType(defs, placeTypeId)` but saved by iterating EVERY definition — and an unrendered field reads as empty, which `setFieldValues` stores as "remove this key". Saving a canyon therefore deleted whatever was recorded under a campsite-scoped field. Write only what the form asked, over the stored object; the same rule makes the validation loop scoped too, or Save blocks on an error the user cannot see to fix. `TripLogDialog` has the harder version of this — see `tripFieldDefs` and its union clause in root CLAUDE.md. (Places rework, 2026-09-10)
- **A control the browser generates on the spot is a `<button>`, not an `<a href="#">`.** The per-type CSV template is built in the page and handed to the user, so there is nothing to navigate to: an anchor there lies to a screen reader and to a middle-click, and `jsx-a11y/anchor-is-valid` fails the lint gate. Style the button as a link when it sits inline beside a real one (`UnifiedImportDialog`). (2026-09-10)
