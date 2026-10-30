// The two shapes every settings sub-page is made of, and the one place their
// copy rules live. Not in `src/ui`: the kit is a vocabulary of visuals, and
// these are compositions of `Row`, `Toggle` and `ChipRail` that only
// mean anything on a preferences page (DESIGN.md — add a kit file for a new
// SHAPE, not for a recurring arrangement of existing ones).
import { Text } from "react-native";

import { makeStyles, muted } from "../../theme";
import {
  SectionHeader,
  ChipRail,
  type ChipOption,
  type Glyph,
  SwitchRow,
} from "../../ui";

/**
 * A preference switch. `ready` is false until the value is actually known (or
 * while it can't be changed) — a switch rendered in its default position before
 * the account's value has loaded is a lie the user can act on.
 */
export function PreferenceRow({
  icon,
  title,
  subtitle,
  subtitleNumberOfLines,
  value,
  ready,
  onToggle,
}: {
  /**
   * Only for a switch over a THING (the app lock). A list of statements — "A
   * topo is ready" is not an object — takes no glyph, because one there is
   * decoration.
   */
  icon?: Glyph;
  title: string;
  subtitle?: string;
  subtitleNumberOfLines?: number;
  value: boolean;
  ready: boolean;
  onToggle: () => void;
}) {
  return (
    <SwitchRow
      icon={icon}
      title={title}
      description={subtitle}
      descriptionNumberOfLines={subtitleNumberOfLines}
      disabled={!ready}
      checked={value}
      onChange={onToggle}
    />
  );
}

/**
 * A single choice from a small vocabulary: the label above, the chips under it,
 * and — only where it earns its place — a line about the current pick.
 *
 * Two rules for that line: it belongs to the VALUE, not to the group (a
 * sentence describing a setting the user is not on is worse than no sentence),
 * and it exists only where the label and the chip leave a real question
 * (repeating the prompt in every hint teaches the user nothing and buries the
 * hints that inform).
 */
export function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  hint,
  disabledReason,
  onChange,
}: {
  label: string;
  options: ChipOption<T>[];
  value: T;
  hint?: string;
  /**
   * Why the whole choice can't be made right now. Greys every chip and replaces
   * the hint — a picker that governs a switched-off feature governs nothing, and
   * one left live is a setting the user changes and sees no effect from
   * (DESIGN.md: disabled, with the reason, never hidden).
   */
  disabledReason?: string;
  onChange: (next: T) => void;
}) {
  return (
    <>
      <SectionHeader title={label} />
      <ChipRail
        options={
          disabledReason
            ? options.map((option) => ({ ...option, disabled: true }))
            : options
        }
        value={value}
        onChange={onChange}
        scroll
      />
      {disabledReason ? (
        <Hint text={disabledReason} />
      ) : hint ? (
        <Hint text={hint} />
      ) : null}
    </>
  );
}

/** A note under a control. Muted, small, and never a substitute for a clear label. */
export function Hint({ text }: { text: string }) {
  const styles = useStyles();

  return <Text style={styles.hint}>{text}</Text>;
}

const useStyles = makeStyles((theme, textRole) => ({
  hint: { ...muted(theme, textRole.detail) },
}));
