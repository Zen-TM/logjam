// What an imported file is CALLED once it lands in Saved.
//
// Its own RN-free module so the rule has a test: `vectorImports.ts` pulls in
// `expo-file-system`, which vitest cannot parse — the same split, and the same
// reason, as `notifications/tapTarget.ts`.
//
// Two names compete, and they are genuinely different things:
//   - the FILE name  — what the file is called on disk (`Ridge approach.gpx`),
//     chosen by whoever exported or saved it;
//   - the CONTENT name — what the file calls itself inside (`<trk><name>` in a
//     GPX, `<name>` in a KML), written by the tool that produced it, and often
//     something like "Track 001" or "ACTIVE LOG" that no human picked.
//
// Normally the content name wins: it is usually the more meaningful of the two,
// and a picked file's name is frequently an export timestamp.

/** `Ridge approach.gpx` → `Ridge approach`. Leaves an extensionless name be. */
export function fileNameWithoutExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

/**
 * A RECEIVED COPY IS THE EXCEPTION, and it is the notification that decides.
 *
 * The recipient was told "bob sent you Ridge approach.gpx". If the item that
 * appears in Saved is called "Track 001" — because that is what the GPX says
 * about itself — then as far as they can tell the thing they accepted is not
 * the thing they got. The inbox made a promise about a name, so that name wins;
 * anywhere else there was no promise to keep.
 *
 * `sentBy` is exactly the "arrived through Send a copy" signal and the only
 * import path with a notification to match. (The GeoPDF path already names from
 * the file — `geopdf/importPipeline.ts` — so it has always agreed.)
 */
export function importDisplayName(args: {
  /** The name inside the file, if it has one. */
  contentName: string | null;
  /** The file's own name, extension included. */
  filename: string;
  /** Friend it arrived from, when it came in through "Send a copy". */
  sentBy: string | null;
}): string {
  const fromFile = fileNameWithoutExtension(args.filename);
  if (args.sentBy != null) return fromFile;
  return args.contentName ?? fromFile;
}
