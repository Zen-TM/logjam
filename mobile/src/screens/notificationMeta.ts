// Inbox identity on Logjam GPS: glyph + hue per KIND of notification.
//
// Notifications are a genuine open-ended vocabulary of kinds, so they get the
// §3 treatment. Which kind a notification is comes from `notificationKind` in
// @logjam/shared, so both clients agree on it; the glyph family and the hue
// tokens are this client's own. The hues are borrowed, not invented: a
// notification about a topo overlay wears the same eucalypt the overlay wears
// in Saved, and a place-share wears the same heath a shared place wears on the
// Places screen. The inbox is where you first hear about a thing — recognising
// it again where it lives is the point.
import { notificationKind, type NotificationKind } from "@logjam/shared";

import type { TNotification } from "../api/types";
import { notificationHue } from "../theme";
import { type Glyph } from "../ui";

export type NotificationMeta = {
  kind: NotificationKind;
  icon: Glyph;
  hue: string;
};

const KIND_META: Record<
  NotificationKind,
  { icon: NotificationMeta["icon"]; hue: string }
> = {
  share: { icon: "shareFriend", hue: notificationHue.share },
  file: { icon: "importedFile", hue: notificationHue.file },
  people: { icon: "friends", hue: notificationHue.people },
  topo: { icon: "lidar", hue: notificationHue.topo },
  export: { icon: "export", hue: notificationHue.export },
  geoPdf: { icon: "geoPdf", hue: notificationHue.geoPdf },
  problem: { icon: "warning", hue: notificationHue.problem },
};

export function notificationMeta(n: TNotification): NotificationMeta {
  const kind = notificationKind(n);
  return { kind, ...KIND_META[kind] };
}
