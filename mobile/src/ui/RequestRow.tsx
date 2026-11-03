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
 * The pair that answers a request: Accept and Decline inside the card, as the
 * footer of a `Row`. A row that sometimes carries other footers (the Inbox)
 * uses this directly; a row that is always a question uses `RequestRow`.
 */
export function RequestAnswers({
  answers,
  disabled,
  hint,
}: {
  answers: RequestAnswer[];
  /** Inert, not hidden: the pair stays so the row cannot change height. */
  disabled?: boolean;
  /** Why they are inert, under the pair: on the thing that is dimmed. */
  hint?: string;
}) {
  const styles = useStyles();
  return (
    <>
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
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </>
  );
}

/**
 * A row that is a question (a friend request, someone asking to join a plan),
 * answered in the row: Accept and Decline inside the card, whichever list it
 * sits in, so Friends and People cannot draw it two ways. Guard:
 * `requestRow.test.ts`.
 */
export function RequestRow({
  answers,
  disabled,
  hint,
  ...row
}: Omit<ComponentProps<typeof Row>, "footer"> & {
  answers: RequestAnswer[];
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <Row
      {...row}
      footer={
        <RequestAnswers answers={answers} disabled={disabled} hint={hint} />
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
