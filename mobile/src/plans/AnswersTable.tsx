// A form's answers as a table, the model Logjam Web draws too
// (`tripPlanAnswerTable`): a column per question, a row per person. The name
// column stays put while the questions scroll sideways; on a 360dp phone (a 328dp sheet body)
// that leaves 232dp: two 108dp columns and a 16dp sliver of the third, so the
// sliver says there is more. A cell and a header are cut at two lines at
// fixed heights (the two halves must stay aligned), and pressing one says it
// whole.
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { TRIP_PLAN_FORMS, type tripPlanAnswerTable } from "@logjam/shared";

import { makeStyles, muted, spacing } from "../theme";

type Table = ReturnType<typeof tripPlanAnswerTable>;

export const NAME_WIDTH = 96;
export const COLUMN_WIDTH = 108;
const CELL_HEIGHT = 56;

export function AnswersTable({
  columns,
  rows,
}: {
  columns: Table["columns"];
  rows: Table["going"];
}) {
  const styles = useStyles();
  const say = (title: string, body: string) => Alert.alert(title, body);
  return (
    <View style={styles.table}>
      <View style={styles.names}>
        <Text style={[styles.cell, styles.head]}>
          {TRIP_PLAN_FORMS.copy.member}
        </Text>
        {rows.map(({ user }) => (
          <Text
            key={user.id}
            style={[styles.cell, styles.name]}
            numberOfLines={2}
          >
            {user.username}
          </Text>
        ))}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        style={styles.scroll}
      >
        <View>
          <View style={styles.line}>
            {columns.map((column) => (
              <Pressable
                key={column.id}
                accessibilityRole="button"
                accessibilityLabel={column.label}
                onPress={() => Alert.alert(column.label)}
                style={styles.column}
              >
                <Text style={[styles.cell, styles.head]} numberOfLines={2}>
                  {column.label}
                </Text>
              </Pressable>
            ))}
          </View>
          {rows.map(({ user, answered, cells }) => (
            <View key={user.id} style={styles.line}>
              {cells.map((cell, index) => {
                const text =
                  !answered && index === 0
                    ? TRIP_PLAN_FORMS.copy.noAnswerYet
                    : cell;
                return (
                  <Pressable
                    key={columns[index].id}
                    accessibilityRole="button"
                    accessibilityLabel={`${user.username}, ${columns[index].label}: ${text}`}
                    onPress={() =>
                      say(`${user.username} · ${columns[index].label}`, text)
                    }
                    style={styles.column}
                  >
                    <Text
                      style={[styles.cell, !answered && styles.missing]}
                      numberOfLines={2}
                    >
                      {text}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  table: { flexDirection: "row" },
  names: {
    width: NAME_WIDTH,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: theme.line,
  },
  scroll: { flex: 1 },
  line: { flexDirection: "row" },
  column: { width: COLUMN_WIDTH },
  cell: {
    ...textRole.detail,
    color: theme.text,
    height: CELL_HEIGHT,
    paddingHorizontal: spacing(1),
    paddingVertical: spacing(1),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.line,
  },
  head: { ...muted(theme, textRole.control) },
  name: { ...textRole.control, color: theme.text },
  missing: { ...muted(theme, textRole.detail) },
}));
