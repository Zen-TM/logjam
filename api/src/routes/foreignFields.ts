// What the owner does with a value that arrived on a copy (plan §2.6).
//
// `foreignFields` is a self-describing park: `[{key,label,type,min,max,value}]`
// on the place row, rendered read-only in its own section, in no form and on no
// other place. It exists because the alternatives all lose: auto-creating the
// definition mutates a per-user schema from a per-place action, dumping it into
// notes is a one-way door, co-ownership needs conflict resolution, and a
// typeless "Copied" tab grows a null branch in every screen.
//
// THREE ACTIONS, and the point of all three is that the SCHEMA DECISION IS THE
// USER'S, made when they choose to make it and with the value in front of them:
//
//   adopt   — create the definition on this place's type with the sender's
//             label/type/bounds, move the value into `fieldValues`.
//   discard — drop it. The one destructive action here, and it is per item.
//   notes   — append "Label: value" to the place's notes and drop the entry,
//             for a value worth keeping as prose rather than as a field.
//
// ONE endpoint rather than three, because the three share every precondition
// (owner only, the place exists, the key is actually parked) and differ only in
// what they do at the end. Splitting them would mean three copies of the same
// four guards.
//
// ONLINE-ONLY, deliberately. ponytail: `foreignFields` is not client-writable
// (it is absent from the push allowlist by design — §2.6 scope discipline), so
// an offline adopt would need its own op vocabulary carrying a def create AND a
// value move atomically. Upgrade path if the field asks for it: a `foreignField`
// push op with those two effects. Until then the section's actions are disabled
// with no signal, which is the same rule sharing already follows.
import { Router, Response } from "express";

import {
  asFieldValues,
  asForeignFields,
  isReservedFieldKey,
  setFieldValues,
  type ForeignFieldValue,
  type TripLogCustomFieldDef,
} from "@logjam/shared";
import { Prisma } from "@prisma/client";

import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { createFieldDef } from "../lib/customFieldDefs";
import { getParam } from "../lib/getParam";
import { resolveUser } from "../lib/resolveUser";
import prisma from "../services/prisma";

const router = Router();

const ACTIONS = ["adopt", "discard", "notes"] as const;
type ForeignFieldAction = (typeof ACTIONS)[number];

function parseAction(value: unknown): ForeignFieldAction {
  if (typeof value === "string" && (ACTIONS as readonly string[]).includes(value)) {
    return value as ForeignFieldAction;
  }
  throw new AppError(400, `action must be one of: ${ACTIONS.join(", ")}`);
}

/** "Label: value", the one rendering used by the notes action. Kept here rather
 *  than at the call site so the appended line has one shape — a value the user
 *  later greps for is only findable if every append looked the same. */
function asNoteLine(item: ForeignFieldValue): string {
  const value =
    item.value === null || item.value === undefined
      ? ""
      : typeof item.value === "object"
        ? JSON.stringify(item.value)
        : String(item.value);
  return `${item.label}: ${value}`;
}

// ── POST /places/:id/foreign-fields/:key ────────────────────────────────────
// Body: { action: "adopt" | "discard" | "notes" }
router.post(
  "/:id/foreign-fields/:key",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const placeId = getParam(req.params.id);
    const key = getParam(req.params.key);
    const action = parseAction(req.body?.action);

    const place = await prisma.place.findUnique({ where: { id: placeId } });
    // OWNER ONLY, and a non-owner gets the 404 every place-id surface gives —
    // `foreignFields` is owner-private, so a sharee must not even learn that
    // this place has any (404-not-403, root CLAUDE.md).
    if (!place || place.ownerId !== user.id) {
      throw new AppError(404, "Place not found");
    }

    const parked = asForeignFields(place.foreignFields);
    const item = parked.find((entry) => entry.key === key);
    if (!item) throw new AppError(404, "Field not found");
    const remaining = parked.filter((entry) => entry.key !== key);

    let fieldValues = asFieldValues(place.fieldValues);
    let notes = place.notes;

    if (action === "adopt") {
      // A reserved key cannot be adopted: the system definitions own those, and
      // creating a user def over one would give the place two writers for one
      // key. It can still be discarded or appended, which is why this is here
      // and not in the guard above.
      if (isReservedFieldKey(key)) {
        throw new AppError(409, `"${item.label}" is a built-in field name.`);
      }
      const def: TripLogCustomFieldDef = {
        key: item.key,
        label: item.label,
        type: item.type as TripLogCustomFieldDef["type"],
        ...(item.min != null ? { min: item.min } : {}),
        ...(item.max != null ? { max: item.max } : {}),
      };
      // Scoped to THIS place's type, not to all: the user adopted a field on a
      // campsite, so it belongs on campsites. `appliesToAllTypes` is a
      // deliberate choice made in the field editor, never inferred here.
      await createFieldDef(user.id, "place", {
        def,
        placeTypeIds: [place.placeTypeId],
      });
      fieldValues = setFieldValues(fieldValues, { [key]: item.value });
    }

    if (action === "notes") {
      // Place notes are deliberately uncapped (routes/places.ts: a trip beta
      // can be long, and the 1 MB body limit is the real bound), so appending
      // one line needs no length rule of its own — inventing one here would be
      // a second, quieter policy on the same field.
      const line = asNoteLine(item);
      notes = notes && notes.trim().length > 0 ? `${notes}\n${line}` : line;
    }

    const updated = await prisma.place.update({
      where: { id: placeId },
      data: {
        fieldValues: fieldValues as Prisma.InputJsonValue,
        foreignFields:
          remaining.length > 0
            ? (remaining as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
        ...(action === "notes" ? { notes } : {}),
      },
    });

    res.json(updated);
  },
);

export default router;
