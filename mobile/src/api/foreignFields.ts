// What the owner does with a value that arrived on a copy (plan §2.6).
//
// `foreignFields` is a self-describing park — `[{key,label,type,min,max,value}]`
// on the place row — holding values whose definitions the recipient does not
// have. The three actions are the SCHEMA DECISION, made by the user with the
// value in front of them: adopt it as a field of this place's type, discard it,
// or keep it as prose in the notes.
//
// ONLINE-ONLY, and not an outbox op, deliberately: `foreignFields` is not
// client-writable (it is absent from the push allowlist by design), and an
// offline adopt would have to carry a definition create AND a value move
// atomically. The section's actions are disabled with no signal, the same rule
// sharing already follows. Upgrade path, if the field asks for it: a
// `foreignField` push op with those two effects.
//
// PRIVACY: the labels and values here are another user's, carried in on a copy.
// They are owner-private — never on a shared delta row — and nothing here logs
// one.
import { apiFetch } from "./apiFetch";

export type ForeignFieldAction = "adopt" | "discard" | "notes";

export function resolveForeignField(
  placeId: string,
  key: string,
  action: ForeignFieldAction,
): Promise<unknown> {
  return apiFetch(
    `/places/${placeId}/foreign-fields/${encodeURIComponent(key)}`,
    { method: "POST", body: { action } },
  );
}
