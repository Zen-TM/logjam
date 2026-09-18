// A friend's initials in a tinted disc — the leading node on every row in
// every sharing surface.
//
// A list of people rendered with the same "user" glyph on every line is a list
// you have to read word by word; initials plus a stable colour make a row
// recognisable before the name is. The hue is hashed from the NAME (DESIGN.md
// §3, open vocabularies) so a person keeps their colour across sessions and
// devices, and a new friend never repaints anyone else.
//
// PRIVACY: usernames only. There is no avatar image anywhere in this app and
// this is not the place to introduce one.
import { StyleSheet, Text, View } from "react-native";

import { fontSize, fontWeight, radius, theme, withAlpha } from "../theme";
import { avatarInitials, friendAvatarHue } from "@logjam/shared";

export function FriendAvatar({
  username,
  selected = false,
}: {
  username: string;
  /** Ticked in a multi-select: the disc becomes the checkbox. */
  selected?: boolean;
}) {
  const hue = selected ? theme.accent : friendAvatarHue(username);
  return (
    <View
      style={[
        styles.disc,
        { backgroundColor: withAlpha(hue, selected ? 0.28 : 0.18), borderColor: hue },
      ]}
    >
      <Text style={[styles.initials, { color: hue }]}>{avatarInitials(username)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  disc: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  initials: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.5,
  },
});
