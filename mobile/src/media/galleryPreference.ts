// "Also save what I shoot in Logjam to the phone's gallery" (Settings →
// Privacy and security).
//
// DEVICE-scoped and OFF by default, and the default is a privacy decision
// rather than a taste one. A photo taken inside Logjam is canyon evidence: it
// lives in app-private storage, excluded from cloud backup, behind the app lock
// (mobile/CLAUDE.md, Privacy). Copying it to the shared gallery hands it to
// every other app on the handset with media access, to the phone's own photo
// backup, and to whoever is handed the phone to look at something else — none
// of which this app can undo. So it is opt-in, per handset, and the switch says
// what it costs.
//
// It is a COPY, not a move: the attachment and its upload are unaffected either
// way, and turning the switch off later leaves anything already saved where it
// is. There is no "un-save" and the copy says so rather than implying one.
//
// Synchronous like every other prefsDb read, so the capture path never waits on
// a store to answer a question it needs before it can act.
import { readPref, writePref } from "../prefsDb";

const GALLERY_SAVE_KEY = "mediaSaveToGallery";

/** Only an explicit "on" is on — an unreadable or absent preference reads as
 *  off, the same fail-closed posture as the app lock. */
export function savesCapturesToGallery(): boolean {
  return readPref(GALLERY_SAVE_KEY) === "on";
}

/** False when the device refused to store it, so the caller can say so. */
export function setSaveCapturesToGallery(enabled: boolean): boolean {
  return writePref(GALLERY_SAVE_KEY, enabled ? "on" : "off");
}
