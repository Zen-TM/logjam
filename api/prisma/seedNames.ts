// Names of seeded rows that tests and Playwright specs look up on screen. One
// declaration, imported by the seed (to write the row) and by the specs (to
// find it), so renaming a row is this one edit, and a name a spec uses that is
// not here is an undefined key. No imports: the specs load this file too.
// Guard: src/lib/seedNames.unit.test.ts.
export const SEED_NAMES = {
  /** Alice's canyon; the exact-name button in every list. */
  claustral: "Claustral Canyon",
  /** Alice's place with no way (route) attached. */
  hiddenSlot: "Hidden Slot",
  /** Alice's drawn route that is on no place. */
  duFaurApproach: "Du Faur Head approach",
  /** Alice leads this plan; bob is in it and carol has asked to join. */
  planWollangambe: "Wollangambe weekend",
  /** Carol's plan, which she has invited alice to. */
  planKanangra: "Kanangra Walls loop",
  /** The one form on the Wollangambe plan; alice has not answered it. */
  formSafetyContacts: "Safety contacts",
  /** The place the Wollangambe plan owns. */
  planMeetingPoint: "Wollangambe meeting point",
  /** The announcement in alice's inbox. */
  announcement: "Logjam is moving to a new server",
} as const;
