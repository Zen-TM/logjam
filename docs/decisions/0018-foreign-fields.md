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
- **Update 2026-11-02: a plan's place shows its set-aside values to every member.** A
  place copied into a plan (Plans, #439) has no owner, so it has no definitions but the
  system's, and every other value is parked in its `foreignFields` with its label. Those
  values are the plan's, so every member sees them read-only, with none of the three
  actions; the plan copy also keeps the source type's name and icon (`Place.typeName`,
  `Place.typeIconKey`). A place shared with the adder may be added too, so a sharee can
  put the owner's attribute labels and type name in front of the plan's members: adding
  to a plan is the consent, as the maintainer decided. The owner's own `foreignFields`
  never travel (`OWNER_PRIVATE_PLACE_FIELDS`), and Save a copy out of a plan matches the
  copier's existing type by name and never creates one. Guards:
  `api/src/__tests__/planItems.test.ts` ("lands a place of the adder's own type as a
  Marker, its values parked with labels", "keeps a system type, setting its custom
  attributes aside for every member to see", "adds a place shared with the caller,
  carrying no owner-private field", "saves a copy into the saver's own type of that name,
  never creating one"). Outside plans, a sharee still never passes the owner's labels on.
  Everything else above stands.

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
- Keeping a shared place out of plans, or its labels out of a plan (2026-11-02):
  rejected. A sharee can already Save a copy and add that, so refusing only adds a
  step; and a plan's values without their labels can't be read.
- Freezing the source type and its definitions into the plan, or plan-scoped types
  (2026-11-02): rejected for now. Read-only set-aside values cover a trip group, and
  either would need a schema and an editor on both clients.
