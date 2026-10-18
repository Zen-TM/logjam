# 0033. The API writes the sentence a user reads when it refuses a request

- **Date:** 2026-10-13
- **Status:** Accepted
- **Supersedes:** —

## Context

When the API refuses a request it throws `AppError(status, message)`, and
`api/src/middleware/errorHandler.ts` sends the message as the response's
`error`. A rejected op in a sync push carries the same text
(`api/src/routes/sync.ts`). On both clients `messageFromError`
(`shared/src/apiErrors.ts`) shows that text first and falls back to the
caller's own words only when the server sent none.

Nothing said who the message was for. Of 357 `AppError` sites, about 140 were
notes to whoever calls the API ("placeTypeId is required", "placeIds contains
duplicates", "ops[3].opId is required") and they reached toasts and error
banners on Logjam Web and Logjam GPS as written.

In October 2026 the Sync issues screen on Logjam GPS was changed to stop
showing them: it dropped the server's text and chose a sentence of its own
from the op's entity, its status code and the fields it had sent
(`rejectionLine` in `mobile/src/screens/syncIssueDisplay.ts`). The phone was
then guessing. A trip refused for listing the same place twice read "This trip
names a place that no longer exists". Two other guesses of the same kind were
already in the clients: Logjam GPS searched a region-clip refusal for the
words "too large", and Logjam Web showed any GeoPDF 429 or 503 as "You already
have GeoPDFs generating", which is false for a credit or capacity refusal.

## Decision

Any text the API sends that a client may show is user copy, written once, in
the API. A client shows it as it is.

- `AppError` takes only a `UserSentence` (`shared/src/userSentence.ts`), a
  branded string that only the tag `` say`…` `` makes. A hole in a sentence
  takes a number, another sentence, or `quote(theirWords)`.
- A sentence says what is wrong and what to do. It carries no field key and no
  id, and names neither client, because the server cannot know which is
  asking. A thing hidden from the caller is worded exactly as a thing that
  does not exist.
- A request only a broken client or a hand-made request can send is
  `malformed(detail)` (`api/src/lib/appError.ts`): the user gets
  `MALFORMED_REQUEST_SENTENCE`, and the developer's detail is logged and
  returned in the response's `detail`, which no client renders. A state of
  ours that should be impossible is `fault(detail)`: `SERVER_FAULT_SENTENCE`,
  with the detail logged only.
- A developer detail is logged, so it never holds a place's name, a
  coordinate, a tag, or a field's value or label. Words a sentence quotes from
  the user are removed before the sentence is logged (`withoutQuoted`).
- A client never rewords, searches or picks by status the text the server
  sent. Its own fallback is for a response that carries no sentence.
- Text the API stores for a client to show later, such as a job's
  `errorMessage`, follows the same rule.

Guards:

- The type: a plain string passed to `AppError` fails the build
  (`_AppErrorTakesOnlySentences` in `api/src/lib/appError.ts`).
- `api/src/userCopy.unit.test.ts` holds every `say` literal in `api/src` and
  `shared/src` to `COPY_RULES` and `API_SENTENCE_RULES`
  (`shared/src/copyRules.ts`), and fails on a cast to `UserSentence`, on
  `say(…)` called as a function, on `res.json({ error })` outside the error
  handler and on a literal `errorMessage:`.
- `serverSentenceParses` (`shared/src/copyRules.ts`), run by
  `frontend/src/copyRules.test.ts` and `mobile/src/copyRules.test.ts`, fails
  when a client searches the server's text.

## Consequences

- **Positive:** A refusal reads the same on both clients and is always the
  true reason. A new refusal needs no client release to be worded.
- **Positive:** The field-value refusal used to put the field's label in the
  API log; the quoting rule closed that.
- **Negative:** The words live in the API, away from the screen that shows
  them, so a sentence cannot name the client, point at a control or change
  with what the user was doing. A caller that wants its own words for one case
  has no supported way to get them.
- **Negative:** The response has no machine-readable reason. A client that
  must behave differently for one refusal can branch only on the status code
  (a credit refusal also carries `used`, `quota` and `resetAt`), and translating the app would mean translating in the API or adding codes
  then.
- **Negative:** Rewording a sentence is an API deploy, and a Logjam GPS build
  already in the field shows whatever the server it reaches sends.
- **Neutral (updated 2026-10-18):** the "too large" words that older Logjam GPS
  builds searched a region-clip refusal for were kept in `AREA_TOO_LARGE` and
  `CLIP_TOO_LARGE` (`api/src/lib/regionClip.ts`) until the endpoint was removed
  ([0036](0036-the-phone-cuts-its-own-offline-clips.md)). No API refusal
  carries them now.
- **Neutral:** An op parked on a phone before this holds a developer's
  message. `mobile/src/sync/parkedError.ts` reads only the new `sentence`, so
  such a row shows the client's fallback line.

## Alternatives considered

- **A reason code beside the status, with each client writing the sentence.**
  The usual shape, and the one translation would want. Rejected because it is
  two lists of sentences that must agree, one per client, plus a list of codes
  that must agree with both, and a build in the field shows its fallback for
  every code added after it shipped. The clients' three guesses came from
  wanting words the server had not supplied; codes would make every refusal
  work that way.
- **Each client writes its own sentence from what it already knows** (the
  status, the entity, the fields it sent). Built for the Sync issues screen in
  October 2026 and removed in the change that carries this ADR: the client
  cannot tell two refusals with one status apart, so it named the wrong cause.
- **Leave the messages as they were and show only the client's fallback.**
  Never wrong, but "Couldn't save this trip." tells the user nothing they can
  act on when the server knows the trip lists a deleted place.
