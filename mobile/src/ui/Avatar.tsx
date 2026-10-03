// A person's tile: the hue their name hashes to, filled, with their initials in
// the one ink — the leading node on every row in every sharing surface, and the
// same box, hue and two letters as Logjam Web's `Avatar`.
//
// A list of people rendered with the same "user" glyph on every line is a list
// you have to read word by word; initials plus a stable colour make a row
// recognisable before the name is. The hue is hashed from the NAME (DESIGN.md
// §3, open vocabularies) so a person keeps their colour across sessions and
// devices, and a new friend never repaints anyone else. A hue is a fill, never
// letters on a surface, so the initials are `onFill`.
//
// PRIVACY: usernames only. There is no avatar image anywhere in Logjam and this
// is not the place to introduce one.
import { StyleSheet, Text, View } from "react-native";

import { fontSize, fontWeight, radius, theme } from "../theme";
import { avatarInitials, friendAvatarHue } from "@logjam/shared";

export function Avatar({
  username,
  selected = false,
}: {
  username: string;
  /** Ticked in a multi-select: the disc becomes the checkbox. */
  selected?: boolean;
}) {
  const hue = selected ? theme.accent : friendAvatarHue(username);
  return (
    <View style={[styles.disc, { backgroundColor: hue }]}>
      <Text style={styles.initials}>{avatarInitials(username)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  disc: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  initials: {
    color: theme.onFill,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.5,
  },
});
