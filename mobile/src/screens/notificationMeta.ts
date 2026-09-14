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
import type { Feather } from "@expo/vector-icons";
import { notificationKind, type NotificationKind } from "@logjam/shared";

import type { TNotification } from "../api/types";
import { notificationHue } from "../theme";

export type NotificationMeta = {
  kind: NotificationKind;
  icon: React.ComponentProps<typeof Feather>["name"];
  hue: string;
};

const KIND_META: Record<NotificationKind, { icon: NotificationMeta["icon"]; hue: string }> = {
  share: { icon: "share-2", hue: notificationHue.share },
  file: { icon: "file-plus", hue: notificationHue.file },
  people: { icon: "users", hue: notificationHue.people },
  topo: { icon: "layers", hue: notificationHue.topo },
  export: { icon: "download", hue: notificationHue.export },
  geoPdf: { icon: "file-text", hue: notificationHue.geoPdf },
  problem: { icon: "alert-triangle", hue: notificationHue.problem },
};

export function notificationMeta(n: TNotification): NotificationMeta {
  const kind = notificationKind(n);
  return { kind, ...KIND_META[kind] };
}
