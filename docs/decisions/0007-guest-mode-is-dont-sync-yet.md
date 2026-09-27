# 0007. Guest mode is "don't sync yet", not a separate storage path

- **Date:** 2026-08-05
- **Status:** Accepted
- **Supersedes:** —

## Context

Logjam GPS runs without an account. A fresh install lands on the landing screen
(`screens/LandingScreen.tsx` — sign-in form, with "create an account" and
"continue without an account" subdued beneath it); "continue without an
account" first shows the storage explainer as a state of that screen, and only
"Continue anyway" sets the `prefsDb` flag and mounts the same `AppShell` with
`accountState: "guest"`.

## Decision

**The mechanism is "don't sync yet", not a separate storage path.** Guest
mutations write the mirror and enqueue to the outbox exactly as they always do —
`AppShell` simply never calls `registerSyncTriggers()`, so the mutation handler
is never installed and the queue accumulates. Linking an account starts the
engine and the first cycle drains it. There is no import, no id remapping (ids
are client-minted UUIDv4 already) and no merge code; the delta pull is
`INSERT OR REPLACE`, so linking into an account that already has data merges
rather than replaces. **Never add a guest-specific write path** — that
equivalence is the whole feature.

**Custom fields used to be the one exception to that equivalence. They are not
any more, and nothing else may become one.** Definitions were a USER PREFERENCE
(`User.uiPreferences`), so there was no outbox op to accumulate: a guest's list
lived in `sync_state` and `adoptLocalFieldDefs` carried it up on link. They are
now rows — `custom_field_defs`, a `customFieldDef` push entity — so defining,
renaming and deleting a field is the ordinary write path, unflushed for a guest,
and both the second store and the adoption step are deleted.
`customFields/fieldDefsStore.ts` no longer branches on account state at all;
`useFieldDefs` reads the mirror and nothing else.
- **A definition delete is TWO things and only one of them is local.** The phone
  removes the definition and strips the value off the rows in its own mirror;
  the SERVER strips the value off every row the user owns, in the delete op's
  transaction (`api/src/lib/customFieldDefs.ts`). The phone cannot do the
  second — a row it has not pulled would keep a value that resurfaces under a
  later field with the same slug.
- **A key collision on link is a REJECTED op, not a silent merge.** Two devices
  (or a phone and Logjam Web) that each invent "Water level" offline collide on
  `(owner, entity, key)`; the push answers 409 and the op parks as a sync issue
  the user resolves.

**`auth/capabilities.ts` is the single source of what is gated**, and the only
place "Needs an account" / "Needs a connection" are spelled. Screens read
`accountState` from `auth/AccountStateContext`, never from the preference
directly (that read wouldn't re-render on link). `needs-account` beats
`needs-connection` — see DESIGN.md §10.

Every `useApiQuery` and every effect that talks to the server must be disabled
for a guest, not left to fail. A guaranteed-401 request per screen open is a
battery cost and a permanently red sync health line.

Crash-report consent, which guest mode made necessary, is in
[0004](0004-mobile-sentry-and-scrubber.md).

## Consequences

- **Positive:** no import, no id remapping and no merge code on link.
- **Negative:** Not recorded.
- **Neutral:** a guest's outbox grows until an account is linked.

## Alternatives considered

- Custom field definitions as a user preference carried up by
  `adoptLocalFieldDefs` on link: replaced by rows. `adoptLocalFieldDefs`' old
  account-wins merge is gone with it — accepting silently would leave the phone
  mirroring a duplicate definition under its own id forever.
