import { View } from "react-native";

import {
  ACCOUNT_FOOTER_LINKS,
  BUG_REPORT_URL,
  type AccountFooterLinkId,
} from "@logjam/shared";

import {
  PRIVACY_POLICY_URL,
  TERMS_URL,
  openLegalDocument,
} from "../legalLinks";
import { spacing, makeStyles } from "../theme";
import { TextLink } from "../ui";

// Typed by id, so a link added to the Account contract has to be given a
// destination here.
const URLS: Record<AccountFooterLinkId, string> = {
  terms: TERMS_URL,
  privacy: PRIVACY_POLICY_URL,
  reportBug: BUG_REPORT_URL,
};

/** Terms, Privacy and Report a bug, as Logjam Web's footer has them. */
export function LegalLinks() {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      {ACCOUNT_FOOTER_LINKS.map(({ id, label }) => (
        <TextLink
          key={id}
          label={label}
          onPress={() => openLegalDocument(URLS[id])}
        />
      ))}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    columnGap: spacing(1),
  },
}));
