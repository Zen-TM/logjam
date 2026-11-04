// The two ongoing Android notifications Logjam GPS posts itself, and the tap
// on each. Unlike a push they carry no Expo payload: their tap is an
// ACTION_VIEW intent aimed at the app's own activity, and React Native hands
// its URI to `Linking` (cold start through `getInitialURL`, warm through the
// `url` event). The URIs are written in Kotlin, in two places this file cannot
// import from, so `ongoingTap.test.ts` reads those sources and holds them to
// this list.
//
// A scheme of its own, not the app's: the scheme differs between the real and
// the dev build (app.config.ts), and the intent names the activity directly, so
// it needs no intent filter.
//
// Nothing here may carry a name or a coordinate: the URI is visible to every
// app that can read a task's intents.

export const ONGOING_TAP_SCHEME = "logjam-ongoing://";

/** URI host -> what the notification stands for. */
export const ONGOING_TAP_KINDS = ["recording", "downloads"] as const;
export type OngoingTapKind = (typeof ONGOING_TAP_KINDS)[number];

export function ongoingTapKind(
  url: string | null | undefined,
): OngoingTapKind | null {
  if (!url?.startsWith(ONGOING_TAP_SCHEME)) return null;
  const host = url.slice(ONGOING_TAP_SCHEME.length);
  return ONGOING_TAP_KINDS.find((kind) => kind === host) ?? null;
}
