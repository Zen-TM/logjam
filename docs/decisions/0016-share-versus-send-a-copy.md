# 0016. Share and Send a copy are two verbs, answered in one panel and the inbox

- **Date:** 2026-08-22
- **Status:** Accepted
- **Supersedes:** —

## Context

**TWO VERBS, and they are not variants of each other.** The wording is the
feature — a user who thinks a sent file can be taken back has been misled by the
UI, not by the API.

- **Share** — a LIVE, revocable view of a server-backed row the sender still
  owns: places, routes, LiDAR topo jobs and GeoPDF jobs. The recipient can view
  and export, never edit. `POST /shares` (places keep their own
  `/places/:id/share`).
- **Send a copy** — a FILE handed over. Once accepted it is the recipient's own,
  editable, permanent, and there is NO revocation: imports, recorded tracks
  (serialised to GPX at send time) and GeoPDF imports. `POST /file-sends/*`,
  three-phase like media upload, expiring after `FILE_SEND_TTL_DAYS`.

## Decision

### Which verb, and where it is drawn

**Which kind gets which verb lives in `saved/assetActions.ts` and nowhere
else**, and the matrix has an executable check (`assetActions.test.ts`, "the
share / send-a-copy verb matrix"). A descriptor withholds a verb rather than a
screen hiding it — `share` is absent on a row shared WITH you, `sendCopy` is
absent on an import with no retained original and on an empty recording.

**Every surface renders ONE panel** — `useSharePanel` in `src/sharing/
SharePanel.tsx`, for both verbs and every kind, places included. It returns
`{ title, body, footer }` (plus the `sharing` state the place screen's
at-a-glance section reads) and the caller spreads those onto the sheet it
already owns, because a sheet's primary action belongs in `BottomSheet`'s pinned
`footer` (DESIGN.md §6) and nothing may open a second sheet. Which verb it shows
follows `target`: `entity`/`place` grant a live view (tap acts immediately — it
is revocable), `copy` ticks a box and waits for the footer button (a send cannot
be undone). The promise banner states which one it is — accent + eye for Share,
warning + triangle for Send a copy — above an always-present search field and
the friend rows. Do not hand-roll a picker.

**The promise is NOT a prop.** Both sentences (`SHARE_BLURB`, and the place's
own, which names notes and photos and says trip logs stay private) live in
SharePanel.tsx and are chosen by target kind, as is the revoke confirm. A place
is shared from TWO components — its detail page and
`places/PlaceOptionsSheet.tsx` (a sub-mode of the per-place sheet, which the
Places list AND a tapped map pin both render) — and a wording argument at each
call site is how those drift. The verb ROWS carry no subtitle for the same
reason: the panel states the promise where the user is about to act on it,
rather than twice in two voices.

**`useSharing`'s `calls` must be memoised on the item's ids**, and the panel is
what does it. The hook reloads when they change, so a `calls` rebuilt per render
would reload forever — and the previous shape (capture the first render's calls,
never look again) was invisible only while every caller mounted the hook
alongside its item. The panel mounts ABOVE the item, at screen level, so it
started on a placeholder and answered every open with "no share target".
Object-literal `target` props are keyed the same way (`targetKey`): using the
object itself reset the copy-mode selection on every render, so a tap on a
friend appeared to do nothing.

**A share verb is DIMMED offline, never hidden** — `useShareRowProps(online)`
(SharePanel.tsx) is what every Share / Send a copy row spreads, so all six say
"Needs a connection" (or "Needs an account") in a subtitle and refuse the tap,
instead of the row disappearing. Sharing is the first thing most saved items
offer that needs the network at all, so it is the row a user is most likely to
go looking for and not find. Consequence for LiDAR topos: the verb is withheld
only on `syncRole === "shared"` — a job we KNOW is someone else's — because an
overlay rebuilt from a downloaded artifact carries no `syncRole` at all
(`map/topoOverlays.ts`), and treating unknown as "not yours" is what made the
verb vanish offline.

**A verb whose panel needs space is rendered INSIDE the sheet that owns the
verb, never handed to the caller as a callback.** A callback is only as good as
the caller that remembers to pass it: the Share verb shipped invisible once
because it was wired into `SavedScreen`'s inline sheet while routes actually
open `routes/RouteOptionsSheet.tsx`. The render sites are listed in
`assetActions.ts`'s header — check all of them when adding a verb.

### What is sent, and what it is called

**Imports keep their ORIGINAL BYTES** (`vector_import.sourcePath`) alongside the
derived GeoJSON, and a send ships the original. GPX → GeoJSON is lossy —
`ImportedFeature.properties` keeps only `name` and `coordTimes`, so `<desc>`,
`<sym>`, `<extensions>`, `<metadata>`, the `rte`/`trk` distinction and
multi-`trkseg` grouping are all discarded — so a round trip through the
derivation would hand a friend less than the sender has. A KMZ is stored as the
KML extracted from it (`writeAsStringAsync` is UTF-8 and would corrupt a zip).

**The Saved category is `import`, labelled "Imports"** — renamed from `vector` /
"GPX & KML" because the tab holds whole FILES that may contain points and
polygons, and naming it for lines promised something the type does not
guarantee. **"Way" is the umbrella term for route-or-track** in prose and labels
only; the `Route` and `Track` types stay distinct everywhere. It names one panel:
`places/AddWaySheet.tsx`, every way of filling a place's single route slot,
opened from the empty slot and from the replace row alike.

**A received copy is labelled `Copy` with "from <sender>" in its subtitle, never
the `Shared` pill.** On a route that word means live/revocable/read-only; a
received copy is the recipient's own, editable and permanent, and reusing the
word for opposite promises is exactly the confusion the two verbs exist to
prevent.

### Lifecycle of a send

**`accepted` means the download URL was ISSUED, not that the file arrived.** The
row flips when accept returns, so a recipient who accepts on a flaky connection
is `accepted` with no file. Accepted rows stay downloadable until the TTL and
the notification keeps offering "Download again"; that is the mitigation.

**A lapsed send is REPORTED to whoever missed it, and to nobody else.** At
expiry the reaper deletes the notification of every recipient who already saved
the copy (nothing to tell them) and keeps it for everyone who did not, stamped
with the filename. From then on a `file_sent` notification with no send row
means exactly one thing — expired unsaved — because every other way a recipient
row disappears deletes the notification in the same transaction (decline in
`routes/fileSends.ts`, unfriending in `lib/shareAccess.ts`, account deletion in
`routes/users.ts`). The inbox renders it with no buttons and the line "This file
expired. Ask bob to send it again." Guards: `lib/fileSendReaper.unit.test.ts`,
`__tests__/fileSends.test.ts`.

**An offer to download is WITHDRAWN, never left to fail.** Two guards, in that
order. The S3 lifecycle rule on `file-sends/` is deliberately one day longer than
`FILE_SEND_TTL_DAYS` (`infra/terraform/envs/prod/s3.tf` — raising the TTL means
raising the rule FIRST), so at day 7 the row expires and `inboxWhere` drops the
notification, its buttons and all, while the bytes are still there. Belt to that
braces: `POST /file-sends/:id/accept` HEADs the object before signing a URL for
it, and a definitively missing one (`isMissingObjectError` —
404/NotFound/NoSuchKey, never a throttle or a permission fault) sets
`expiresAt = now`. That one true fact retires the send for EVERY recipient
through the filters that already exist, and hands the sender's quota back. The
client then sees a 404, which `isResolvedElsewhereError` already treats as dead
rather than retryable, so the row clears instead of offering a button that
cannot work.

### Answered in the inbox

**A received file is answered in the INBOX, not on a page of its own.** A send
is one accept/decline pair and an accepted file becomes an ordinary Saved
import, so it never needed a screen. Two rules hold the replacement together.
- **Which actions a notification carries, and every word of their copy, is
  `notificationActions.ts` in `@logjam/shared`** — a pure module with its own
  test, exactly like `notifications/tapTarget.ts`. It covers BOTH actionable
  kinds (`friend_request` and `file_sent`); `NotificationsScreen` renders what it
  returns and knows nothing about friendships or sends. A third actionable kind
  is a branch there, not a screen.
- **Every decline confirms in a dialog, the friend request included** — even
  though Logjam Web and `FriendsScreen` do not ask. On those surfaces decline
  sits behind an overflow sheet, which IS the "no is never a mis-tap away from
  yes" guard; side by side in a list row there is no sheet left to be it.

The accept pipeline itself is `imports/acceptReceivedFile.ts` (download to
scratch → `runGeoPdfImport` for a PDF, `importVectorSource` otherwise → delete
the scratch file), unchanged by the move and deliberately not the screen's
business.

**The recipient sees the FILENAME on the notification**, resolved at read time
in `api/src/routes/notifications.ts` from the live send — never denormalised
into the stored payload, with ONE audited exception: when a send expires
unsaved, `lib/fileSendReaper.ts` stamps the filename into that recipient's
payload before deleting the last copy of it, so the row can still say *which*
file lapsed. Scoped as tightly as the exception allows — only recipients who
never took the copy (the ones who did have their notification deleted instead),
only at expiry, only that one field. Nothing else writes it. It is there because
nobody can answer "keep this?" without knowing what is on offer. That resolve
step and `GET /file-sends/inbox` share ONE filter, `inboxWhere` in
`api/src/lib/fileSendAccess.ts`: anything the notification admits that the
inbox would not is a live Accept button whose endpoint answers 404. Guard:
`api/src/__tests__/fileSends.test.ts`, "the actionable notification".

## Consequences

- **Positive:** a sender cannot be misled into thinking a sent file can be
  taken back; a recipient never gets a button whose endpoint cannot work.
- **Negative:** `accepted` does not prove the file arrived; closing the gap
  properly would need an S3 access-log read or a client confirm callback.
- **Neutral:** raising `FILE_SEND_TTL_DAYS` means raising the S3 lifecycle rule
  first.

## Alternatives considered

- A received-files screen: `screens/ReceivedFilesScreen.tsx` and its More row
  are deleted (2026-08-30).
- Wording as a prop at each call site: rejected; that is how the two place
  share surfaces drift.
- Handing the verb to the caller as a callback: rejected after the Share verb
  shipped invisible on routes.
- Naming the Saved category `vector` / "GPX & KML": renamed, see above.
