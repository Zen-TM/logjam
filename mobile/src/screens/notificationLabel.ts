import type { Feather } from "@expo/vector-icons";
import type { TNotification } from "../api/types";
import { notificationHue } from "../theme";
import {
  type NotificationKind,
  type NotificationLabel,
  type NotificationDay,
  notificationLabel,
  notificationHaystack,
  notificationKind,
  notificationPlaceId,
  groupNotificationsByDay,
} from "@logjam/shared";

export {
  type NotificationKind,
  type NotificationLabel,
  type NotificationDay,
  notificationLabel,
  notificationHaystack,
  notificationKind,
  notificationPlaceId,
  groupNotificationsByDay,
};

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
