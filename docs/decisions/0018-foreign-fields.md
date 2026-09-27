# 0018. foreignFields for values whose definition the recipient lacks

- **Date:** 2026-09-06
- **Status:** Accepted
- **Supersedes:** —

## Context

When a place is copied from another user or changed to a different place type, it may
carry field values keyed by definitions the recipient (or the target type) does not
have:
- Dumping foreign values into notes was considered, but killed by a propagation
  objection: B copies A's place, shares it with C, and C reads A's field labels.

## Decision

- **`foreignFields` is the park for a value whose definition the recipient does not
  have, and it has exactly two writers.**
- A copied place carries values keyed by the SENDER's definitions; they land in
  `Place.foreignFields` as `[{key,label,type,min,max,value}]`, rendered read-only in
  their own section with three per-item actions (adopt as a field of my type / append to
  notes / discard).
- Copy and place-type-change are the only writers — never a user edit, and it is absent
  from the `PLACE_FIELDS` push allowlist so a client cannot write one (guards:
  `api/src/routes/placeFields.unit.test.ts`, `api/src/__tests__/placeCopy.test.ts`,
  §7.13).
- It is OWNER-PRIVATE and never appears on a delta row where `syncRole === "shared"`; a
  sharee gets `fieldDefsSnapshot` instead, derived live from the OWNER's current
  definitions.
- Without that rule the design inherits the propagation objection that killed dumping
  the values into notes: B copies A's place, shares it with C, and C reads A's field
  labels.

## Consequences

- **Positive:** foreign values are safely preserved and manageable without leaking
  sender field labels across copies to downstream share recipients.
- **Negative:** Not recorded.
- **Neutral:** Not recorded.

## Alternatives considered

- Dumping values into notes: killed by the propagation objection where B copies A's
  place, shares it with C, and C reads A's field labels.
- Client writes to foreign fields: rejected; absent from the `PLACE_FIELDS` push
  allowlist so a client cannot write one.
