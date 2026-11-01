// A plan's ⋯ on its page. WHICH verbs, in what order and under what words is
// `planVerbs` in `@logjam/shared`, the declaration Logjam Web's menu renders
// from too; this sheet only says how each runs here. Every one but Start a
// trip log writes to the plan, so offline each is drawn disabled with its
// reason (mobile/DESIGN.md §8); a trip log is the caller's own and queues.
// Edit and Start a trip log are the caller's: this sheet closes and the
// caller opens the form.
import { Fragment, useRef, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import {
  ApiError,
  messageFromError,
  planDeleteConfirm,
  planLeaveConfirm,
  planLeaveDeleteAddedLabel,
  planVerbs,
  tripPlanCounts,
  tripPlanIsOver,
  tripPlanLeaveState,
  TRIP_PLAN_OFFLINE,
  TRIP_PLAN_PAGE,
  type PlanVerbId,
  type TripPlanView,
} from "@logjam/shared";

import { unavailableReasonText } from "../auth/capabilities";
import { makeStyles, spacing, useTheme } from "../theme";
import { BottomSheet, Row, todayDateKey } from "../ui";
import { archivePlan, deletePlan, leavePlan } from "./plansApi";
import { LeaveSheet } from "./LeaveSheet";
import { PlanDownloadRows } from "./PlanDownload";
import { afterPlanWrite, type CachedPlan } from "./plansCache";

const copy = TRIP_PLAN_PAGE.copy;
const OFFLINE = unavailableReasonText("needs-connection");

export function PlanOptionsSheet({
  cached,
  online,
  me,
  onDownloadMap,
  onClose,
  onEdit,
  onTripLog,
  onInfo,
  onError,
  onGone,
  onLeaving,
}: {
  /** The plan whose verbs these are; null while the sheet is closed. */
  cached: CachedPlan | null;
  online: boolean;
  /** The caller's user id: what they added is priced in Leave. */
  me: string | null;
  /** The region download, framed on the plan's items. */
  onDownloadMap: (bbox: [number, number, number, number]) => void;
  onClose: () => void;
  onEdit: () => void;
  onTripLog: () => void;
  onInfo: (message: string) => void;
  onError: (message: string) => void;
  /** The caller left or deleted the plan: its page must go, saying so. */
  onGone: (message: string) => void;
  /** A Leave or Delete is under way (true) or failed (false): the page
   *  keeps drawing the plan while it goes. */
  onLeaving: (leaving: boolean) => void;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const plan = cached?.plan ?? null;
  const [leaveFor, setLeaveFor] = useState<TripPlanView | null>(null);
  const added = (target: TripPlanView) => {
    const mine = <T extends { addedBy: { id: string } | null }>(rows: T[]) =>
      rows.filter((row) => row.addedBy?.id === me).length;
    return {
      places: mine(target.places),
      ways: mine(target.routes) + mine(target.files),
    };
  };

  const confirm = (
    words: { confirmTitle: string; confirmBody: string; confirmLabel: string },
    // Leaving a shared plan is not deleting it (shared/DESIGN.md §9).
    destructive: boolean,
    action: () => void,
  ) =>
    Alert.alert(words.confirmTitle, words.confirmBody, [
      { text: "Cancel", style: "cancel" },
      {
        text: words.confirmLabel,
        style: destructive ? "destructive" : "default",
        onPress: action,
      },
    ]);

  // A plan that is gone for the caller (404) is dropped and its page goes;
  // any other refusal refetches, so the page shows the plan as it is.
  const write = (
    target: TripPlanView,
    call: Promise<unknown>,
    gone: boolean,
    done: () => void,
    failed: string,
  ) =>
    call
      .then(() => afterPlanWrite(target.id, gone))
      .then(done)
      .catch(async (err: unknown) => {
        const lost = err instanceof ApiError && err.status === 404;
        if (err instanceof ApiError) await afterPlanWrite(target.id, lost);
        if (lost) return onGone(TRIP_PLAN_OFFLINE.gone);
        if (gone) onLeaving(false);
        onError(messageFromError(err, failed));
      });

  // A verb that opens a form is parked and opened from `onClosed`: a sheet
  // can't open while this one is closing (mobile/DESIGN.md §4).
  const parked = useRef<(() => void) | null>(null);
  const run = (id: PlanVerbId, target: TripPlanView) => {
    if (id === "edit" || id === "tripLog") {
      parked.current = id === "edit" ? onEdit : onTripLog;
      return onClose();
    }
    onClose();
    if (id === "leave") parked.current = () => setLeaveFor(target);
    else if (id === "archive" || id === "unarchive") {
      const archived = id === "archive";
      void write(
        target,
        archivePlan(target.id, archived),
        false,
        () => onInfo(archived ? copy.archived : copy.unarchived),
        copy.archiveFailed,
      );
    } else if (id === "delete") {
      confirm(
        planDeleteConfirm(target.name, tripPlanCounts(target)),
        true,
        () => {
          onLeaving(true);
          void write(
            target,
            deletePlan(target.id),
            true,
            () => onGone(copy.deleted),
            copy.deleteFailed,
          );
        },
      );
    }
  };

  const live = (id: PlanVerbId) => online || id === "tripLog";
  const verbs = plan
    ? planVerbs("gps", plan.myRole, {
        archived: plan.archivedAt != null,
        dated: plan.startDate != null || plan.endDate != null,
        over: tripPlanIsOver(plan, todayDateKey()),
        ...tripPlanLeaveState(plan),
      })
    : [];

  const firstSeparated = verbs.findIndex((verb) => verb.separated);
  // Starting a download is here; its progress stays in the hero.
  const downloads =
    plan && cached ? (
      <PlanDownloadRows
        cached={cached}
        online={online}
        onDownloadMap={onDownloadMap}
        onStarted={onClose}
      />
    ) : null;
  const leaveCounts = leaveFor ? added(leaveFor) : { places: 0, ways: 0 };
  return (
    <>
      {/* Titled with the plan, so a mis-tap can't delete the wrong one. */}
      <BottomSheet
        visible={plan !== null}
        onClose={onClose}
        onClosed={() => {
          const open = parked.current;
          parked.current = null;
          open?.();
        }}
        title={plan?.name ?? ""}
      >
        {plan && cached ? (
          <View style={styles.body}>
            {verbs.map((verb, index, all) => (
              <Fragment key={verb.id}>
                {/* Before the destructive verbs: the last item is Delete. */}
                {index === firstSeparated ? downloads : null}
                {verb.separated && index > 0 && !all[index - 1].separated ? (
                  <View style={styles.rule} />
                ) : null}
                <Row
                  icon={verb.icon}
                  hue={verb.danger ? theme.warning : undefined}
                  title={verb.label}
                  subtitle={live(verb.id) ? verb.disabledReason : OFFLINE}
                  disabled={!live(verb.id) || verb.disabledReason != null}
                  onPress={() => run(verb.id, plan)}
                />
              </Fragment>
            ))}
            {firstSeparated < 0 ? downloads : null}
          </View>
        ) : null}
      </BottomSheet>
      <LeaveSheet
        words={leaveFor ? () => planLeaveConfirm(leaveFor.name) : null}
        choiceLabel={
          leaveCounts.places + leaveCounts.ways > 0
            ? planLeaveDeleteAddedLabel(leaveCounts)
            : null
        }
        onClose={() => setLeaveFor(null)}
        onConfirm={(deleteAdded) => {
          const target = leaveFor;
          setLeaveFor(null);
          if (!target) return;
          onLeaving(true);
          void write(
            target,
            leavePlan(target.id, deleteAdded),
            true,
            () => onGone(copy.left),
            copy.leaveFailed,
          );
        }}
      />
    </>
  );
}

const useStyles = makeStyles((theme) => ({
  body: { gap: spacing(1) },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: theme.line },
}));
