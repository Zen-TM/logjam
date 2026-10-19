// A plan's ⋯ on its page. WHICH verbs, in what order and under what words is
// `planVerbs` in `@logjam/shared`, the declaration Logjam Web's menu renders
// from too; this sheet only says how each runs here. Every one of them writes,
// so offline each is drawn disabled with its reason (design §8). Edit is the
// caller's: this sheet closes and the caller opens the form.
import { Fragment } from "react";
import { Alert, StyleSheet, View } from "react-native";
import {
  messageFromError,
  planDeleteConfirm,
  planLeaveConfirm,
  planVerbs,
  tripPlanIsOver,
  tripPlanLeaveState,
  TRIP_PLAN_PAGE,
  type PlanVerbId,
  type TripPlanView,
} from "@logjam/shared";

import { unavailableReasonText } from "../auth/capabilities";
import { makeStyles, spacing, useTheme } from "../theme";
import { BottomSheet, Row, todayDateKey } from "../ui";
import { archivePlan, deletePlan, leavePlan } from "./plansApi";
import { afterPlanWrite } from "./plansCache";

const copy = TRIP_PLAN_PAGE.copy;
const OFFLINE = unavailableReasonText("needs-connection");

export function PlanOptionsSheet({
  plan,
  online,
  onClose,
  onEdit,
  onInfo,
  onError,
  onGone,
}: {
  /** The plan whose verbs these are; null while the sheet is closed. */
  plan: TripPlanView | null;
  online: boolean;
  onClose: () => void;
  onEdit: () => void;
  onInfo: (message: string) => void;
  onError: (message: string) => void;
  /** The caller left or deleted the plan: its page must go, saying so. */
  onGone: (message: string) => void;
}) {
  const theme = useTheme();
  const styles = useStyles();

  const confirm = (
    words: { confirmTitle: string; confirmBody: string; confirmLabel: string },
    action: () => void,
  ) =>
    Alert.alert(words.confirmTitle, words.confirmBody, [
      { text: "Cancel", style: "cancel" },
      { text: words.confirmLabel, style: "destructive", onPress: action },
    ]);

  const run = (id: PlanVerbId, target: TripPlanView) => {
    onClose();
    if (id === "edit") return onEdit();
    if (id === "archive" || id === "unarchive") {
      const archived = id === "archive";
      archivePlan(target.id, archived)
        .then(() => afterPlanWrite(target.id))
        .then(() => onInfo(archived ? copy.archived : copy.unarchived))
        .catch((err: unknown) =>
          onError(messageFromError(err, copy.archiveFailed)),
        );
    } else if (id === "leave") {
      confirm(planLeaveConfirm(target.name), () => {
        leavePlan(target.id)
          .then(() => afterPlanWrite(target.id, true))
          .then(() => onGone(copy.left))
          .catch((err: unknown) =>
            onError(messageFromError(err, copy.leaveFailed)),
          );
      });
    } else if (id === "delete") {
      const counts = {
        places: target.places.length,
        ways: target.routes.length + target.files.length,
        maps: target.geoPdfs.length,
      };
      confirm(planDeleteConfirm(target.name, counts), () => {
        deletePlan(target.id)
          .then(() => afterPlanWrite(target.id, true))
          .then(() => onGone(copy.deleted))
          .catch((err: unknown) =>
            onError(messageFromError(err, copy.deleteFailed)),
          );
      });
    }
  };

  // ponytail: Start a trip log and Print are not drawn here yet. Print is
  // Logjam Web's (`planVerbs` leaves it out); a trip log from a plan needs the
  // trip form to take a prefill, which comes with Add a copy.
  const verbs = plan
    ? planVerbs("gps", plan.myRole, {
        archived: plan.archivedAt != null,
        over: tripPlanIsOver(plan, todayDateKey()),
        ...tripPlanLeaveState(plan),
      }).filter((verb) => verb.id !== "tripLog")
    : [];

  return (
    // Titled with the plan, so a mis-tap can't delete the wrong one.
    <BottomSheet
      visible={plan !== null}
      onClose={onClose}
      title={plan?.name ?? ""}
    >
      {plan ? (
        <View style={styles.body}>
          {verbs.map((verb, index, all) => (
            <Fragment key={verb.id}>
              {verb.separated && index > 0 && !all[index - 1].separated ? (
                <View style={styles.rule} />
              ) : null}
              <Row
                icon={verb.icon}
                hue={verb.danger ? theme.warning : undefined}
                title={verb.label}
                subtitle={online ? verb.disabledReason : OFFLINE}
                disabled={!online || verb.disabledReason != null}
                onPress={() => run(verb.id, plan)}
              />
            </Fragment>
          ))}
        </View>
      ) : null}
    </BottomSheet>
  );
}

const useStyles = makeStyles((theme) => ({
  body: { gap: spacing(1) },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: theme.line },
}));
