import { useState } from "react";
import { TextInput, View } from "react-native";

import {
  controlSize,
  makeStyles,
  opacity,
  placeholderColor,
  spacing,
  radius,
  useTheme,
  withAlpha,
} from "../theme";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";

/**
 * A search box over a list: a pill with the glyph inside, the twin of Logjam
 * Web's `SearchField`. `label` is its accessible name and its placeholder. A
 * form's fields are `TextField`; this is not one, so it draws no label above.
 */
export function SearchField({
  label,
  value,
  onChangeText,
  editable = true,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  editable?: boolean;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const [focused, setFocused] = useState(false);

  return (
    <View
      style={[
        styles.pill,
        focused && styles.focused,
        !editable && styles.disabled,
      ]}
    >
      <Icon idea="search" size={16} color={theme.textMuted} />
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={label}
        placeholderTextColor={placeholderColor(theme)}
        accessibilityLabel={label}
        accessibilityState={{ disabled: !editable }}
        editable={editable}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {value !== "" && editable ? (
        <IconButton
          icon="close"
          size={16}
          accessibilityLabel="Clear search"
          onPress={() => onChangeText("")}
        />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  // A fixed height, so the clear button appearing cannot move the list.
  pill: {
    height: controlSize.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1),
    paddingLeft: spacing(1.5),
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(theme.accent, 0.45),
    backgroundColor: theme.field,
  },
  focused: { borderColor: theme.accent },
  disabled: { opacity: opacity.disabled },
  input: { ...textRole.body, flex: 1, paddingVertical: 0, color: theme.text },
}));
