import type { ComponentProps } from "react";
import { Text } from "react-native";

import { makeStyles, muted, spacing } from "../theme";
import { Button } from "./Button";
import { CardActions } from "./CardActions";
import { Row } from "./Row";

export type RequestAnswer = {
  key: string;
  label: string;
  /** The "no": drawn as the outline, so it never looks like the thing to press. */
  decline?: boolean;
  loading?: boolean;
  onPress: () => void;
};

/**
 * A row that asks a question (a friend request, a file offered, someone
 * asking to join a plan) and answers it in the row: Accept and Decline inside
 * the card, whichever list it sits in. One component, so the Inbox, Friends
 * and People cannot draw the same question three ways. Guard:
 * `requestRow.test.ts`.
 */
export function RequestRow({
  answers,
  disabled,
  hint,
  footer,
  ...row
}: Omit<ComponentProps<typeof Row>, "footer"> & {
  answers: RequestAnswer[];
  /** Inert, not hidden: the pair stays so the row cannot change height. */
  disabled?: boolean;
  /** Why they are inert, under the pair: on the thing that is dimmed. */
  hint?: string;
  /** A quieter alternative drawn under the pair, or in its place. */
  footer?: React.ReactNode;
}) {
  const styles = useStyles();
  return (
    <Row
      {...row}
      footer={
        <>
          {answers.length > 0 ? (
            <CardActions>
              {answers.map((answer) => (
                <Button
                  key={answer.key}
                  label={answer.label}
                  variant={answer.decline ? "outlineAccent" : undefined}
                  disabled={disabled}
                  loading={answer.loading}
                  onPress={answer.onPress}
                />
              ))}
            </CardActions>
          ) : null}
          {answers.length > 0 && hint ? (
            <Text style={styles.hint}>{hint}</Text>
          ) : null}
          {footer}
        </>
      }
    />
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  hint: {
    ...muted(theme, textRole.meta),
    textAlign: "center",
    paddingTop: spacing(0.5),
  },
}));
