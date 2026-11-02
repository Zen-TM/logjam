import { Text, View } from "react-native";

import {
  PRIVACY_POLICY_URL,
  TERMS_URL,
  openLegalDocument,
} from "../legalLinks";
import { makeStyles, radius, spacing } from "../theme";
import { Toggle } from "../ui";

/**
 * The agreement switch, on the sign-up form and in ConsentGate. Its words carry
 * the two links, so it isn't a `SwitchRow`, whose whole row flips the switch.
 * Same words as Logjam Web's `TermsTick`.
 */
export function TermsSwitch({
  updated = false,
  checked,
  onChange,
}: {
  /** The terms changed since this account agreed to them. */
  updated?: boolean;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  const styles = useStyles();
  const link = (label: string, url: string) => (
    <Text
      accessibilityRole="link"
      onPress={() => openLegalDocument(url)}
      style={styles.link}
    >
      {label}
    </Text>
  );

  return (
    <View style={styles.row}>
      <Text style={styles.words}>
        I agree to the {updated ? "updated " : ""}
        {link(updated ? "Terms" : "Terms of Use", TERMS_URL)} and acknowledge
        the {link("Privacy Policy", PRIVACY_POLICY_URL)}.
      </Text>
      <Toggle
        checked={checked}
        onChange={onChange}
        accessibilityLabel="I agree to the terms"
      />
    </View>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1.5),
    padding: spacing(1.5),
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: radius.lg,
    backgroundColor: theme.card,
  },
  words: { ...textRole.body, color: theme.text, flex: 1 },
  link: { textDecorationLine: "underline" },
}));
