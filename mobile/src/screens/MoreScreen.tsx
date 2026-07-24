// More tab — hub for the lower-frequency surfaces folded off the tab bar:
// Inbox, Account, Friends, Sync issues, Settings. Each is a Row that pushes
// its screen within the More stack.
import { Feather } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";

import { spacing, theme } from "../theme";
import { Row, ScreenScroll, StatusPill } from "../ui";

type MoreItem = {
  key: string;
  title: string;
  subtitle: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  onPress: () => void;
  badge?: number | null;
};

function Trailing({ badge }: { badge?: number | null }) {
  return (
    <View style={styles.trailing}>
      {badge ? <StatusPill label={String(badge)} tone="accent" /> : null}
      <Feather name="chevron-right" size={20} color={theme.textMuted} />
    </View>
  );
}

export function MoreScreen({
  unreadCount,
  onOpenInbox,
  onOpenAccount,
  onOpenFriends,
  onOpenSyncIssues,
  onOpenSettings,
}: {
  unreadCount: number | null;
  onOpenInbox: () => void;
  onOpenAccount: () => void;
  onOpenFriends: () => void;
  onOpenSyncIssues: () => void;
  onOpenSettings: () => void;
}) {
  const items: MoreItem[] = [
    {
      key: "inbox",
      title: "Inbox",
      subtitle: "Notifications, shares and requests",
      icon: "inbox",
      onPress: onOpenInbox,
      badge: unreadCount,
    },
    {
      key: "account",
      title: "Account",
      subtitle: "Profile and sign out",
      icon: "user",
      onPress: onOpenAccount,
    },
    {
      key: "friends",
      title: "Friends",
      subtitle: "People you share canyons with",
      icon: "users",
      onPress: onOpenFriends,
    },
    {
      key: "sync",
      title: "Sync issues",
      subtitle: "Conflicts that need your attention",
      icon: "alert-triangle",
      onPress: onOpenSyncIssues,
    },
    {
      key: "settings",
      title: "Settings",
      subtitle: "Theme, notifications, downloads",
      icon: "settings",
      onPress: onOpenSettings,
    },
  ];

  return (
    <ScreenScroll>
      {items.map((item) => (
        <Row
          key={item.key}
          title={item.title}
          subtitle={item.subtitle}
          onPress={item.onPress}
          leading={<Feather name={item.icon} size={20} color={theme.accent} />}
          right={<Trailing badge={item.badge} />}
        />
      ))}
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  trailing: { flexDirection: "row", alignItems: "center", gap: spacing(1) },
});
