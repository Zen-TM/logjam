import type { Glyph } from "./Icon";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import type { Disablable } from "./disabledReason";
import { useTheme } from "../theme";

/**
 * A list hero's one add. Labelled while the hero is full; in the compact row
 * it is the glyph alone, with its label as the accessible name, so the title
 * that carries the count is not squeezed to an ellipsis at large text sizes.
 */
export function HeroAdd({
  label,
  icon,
  compact,
  onPress,
  disabled,
  disabledReason,
  reasonShown,
}: {
  label: string;
  icon: Glyph;
  compact: boolean;
  onPress: () => void;
} & Disablable) {
  const theme = useTheme();
  // `disabled` and its reason travel as the pair the controls' types ask for.
  const gate = { disabled, disabledReason, reasonShown } as Disablable;
  return compact ? (
    <IconButton
      icon={icon}
      accessibilityLabel={label}
      color={theme.accent}
      filled
      {...gate}
      onPress={onPress}
    />
  ) : (
    <Button label={label} icon={icon} compact {...gate} onPress={onPress} />
  );
}
