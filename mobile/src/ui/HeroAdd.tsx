import type { Glyph } from "./Icon";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
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
}: {
  label: string;
  icon: Glyph;
  compact: boolean;
  onPress: () => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const theme = useTheme();
  return compact ? (
    <IconButton
      icon={icon}
      accessibilityLabel={label}
      color={theme.accent}
      filled
      disabled={disabled}
      onPress={onPress}
    />
  ) : (
    <Button
      label={label}
      icon={icon}
      compact
      disabled={disabled}
      disabledReason={disabledReason}
      onPress={onPress}
    />
  );
}
