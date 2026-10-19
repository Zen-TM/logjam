// A plan's People (`TRIP_PLAN_PAGE`'s `people`): who's asking to join and
// who's invited (a leader's alone, design O-13), and who's going. A leader
// lets a request in or turns it down on its row, and runs a person's ⋯
// (`planMemberVerbs`): another role, Remove, or Cancel invite. Every write is
// online-only, so offline each control is disabled with its reason.
import { Fragment, useEffect, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import {
  messageFromError,
  planAddVerbLabel,
  planMemberRemoveConfirm,
  planMemberVerbRole,
  planMemberVerbs,
  tripPlanGoing,
  TRIP_PLAN_PAGE,
  TRIP_PLAN_PEOPLE_COPY,
  TRIP_PLAN_ROLE_LABELS,
  type PlanMemberVerbId,
  type TripPlanMemberView,
  type TripPlanView,
} from "@logjam/shared";

import { unavailableReasonText } from "../auth/capabilities";
import { getSyncStateValue } from "../sync/syncDb";
import { makeStyles, spacing, useTheme } from "../theme";
import {
  BottomSheet,
  Button,
  IconButton,
  Row,
  SectionHeader,
  StatusPill,
} from "../ui";
import { InviteSheet } from "./InviteSheet";
import { approveMember, removeMember, setMemberRole } from "./plansApi";
import { afterPlanWrite } from "./plansCache";

const copy = TRIP_PLAN_PAGE.copy;
const people = TRIP_PLAN_PEOPLE_COPY;
const OFFLINE = unavailableReasonText("needs-connection");

export function PeopleView({
  plan,
  canInvite,
  online,
  onInfo,
  onError,
}: {
  plan: TripPlanView;
  /** Invite people is the caller's to run (a leader, the plan not archived). */
  canInvite: boolean;
  online: boolean;
  onInfo: (message: string) => void;
  onError: (message: string) => void;
}) {
  const theme = useTheme();
  const styles = useStyles();
  // The mirror's own account: whose row has no ⋯.
  const [myId, setMyId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<TripPlanMemberView | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  useEffect(() => {
    void getSyncStateValue("userId").then(setMyId).catch(console.error);
  }, []);

  const write = (
    call: Promise<unknown>,
    done: string,
    failed: string,
  ): Promise<void> =>
    call
      .then(() => afterPlanWrite(plan.id))
      .then(() => onInfo(done))
      .catch((err: unknown) => onError(messageFromError(err, failed)));

  const run = (id: PlanMemberVerbId, member: TripPlanMemberView) => {
    setMenuFor(null);
    const role = planMemberVerbRole(id);
    if (role)
      return void write(
        setMemberRole(plan.id, member.user.id, role),
        `${member.user.username} is now ${TRIP_PLAN_ROLE_LABELS[role].toLowerCase()}.`,
        people.roleFailed,
      );
    if (id === "cancelInvite")
      return void write(
        removeMember(plan.id, member.user.id),
        people.inviteCancelled,
        people.inviteCancelFailed,
      );
    const confirm = planMemberRemoveConfirm(member.user.username);
    Alert.alert(confirm.confirmTitle, confirm.confirmBody, [
      { text: "Cancel", style: "cancel" },
      {
        text: confirm.confirmLabel,
        style: "destructive",
        onPress: () =>
          void write(
            removeMember(plan.id, member.user.id),
            people.removed,
            people.removeFailed,
          ),
      },
    ]);
  };

  const leader = plan.myRole === "leader";
  const going = tripPlanGoing(plan.members);
  const asking = plan.members.filter((member) => member.status === "requested");
  const invited = plan.members.filter((member) => member.status === "invited");
  const verbsFor = (member: TripPlanMemberView) =>
    myId ? planMemberVerbs(plan.myRole, myId, member) : [];

  const personRow = (member: TripPlanMemberView, pill?: string) => {
    const verbs = verbsFor(member);
    return (
      <Row
        key={member.user.id}
        icon="account"
        title={member.user.username}
        subtitle={
          member.invitedBy && member.status === "invited"
            ? `From ${member.invitedBy.username}`
            : undefined
        }
        right={
          <View style={styles.right}>
            {pill ? <StatusPill label={pill} tone="outline" /> : null}
            {verbs.length > 0 ? (
              <IconButton
                icon="overflow"
                accessibilityLabel={`Actions for ${member.user.username}`}
                color={theme.textMuted}
                onPress={() => setMenuFor(member)}
              />
            ) : null}
          </View>
        }
      />
    );
  };

  return (
    <>
      {canInvite ? (
        <Button
          label={planAddVerbLabel("invite")}
          icon="addFriend"
          variant="outlineAccent"
          disabled={!online}
          disabledReason={OFFLINE}
          onPress={() => setInviteOpen(true)}
        />
      ) : null}
      {leader && asking.length > 0 ? (
        <>
          <SectionHeader title={copy.peopleAsking} count={asking.length} />
          {asking.map((member) => (
            <Row
              key={member.user.id}
              icon="account"
              title={member.user.username}
              subtitle={online ? undefined : OFFLINE}
              footer={
                <View style={styles.actions}>
                  <Button
                    label={copy.letIn}
                    icon="accept"
                    compact
                    disabled={!online}
                    disabledReason={OFFLINE}
                    onPress={() =>
                      void write(
                        approveMember(plan.id, member.user.id),
                        people.letIn,
                        people.letInFailed,
                      )
                    }
                  />
                  <Button
                    label={copy.turnDown}
                    icon="ignore"
                    compact
                    variant="ghost"
                    disabled={!online}
                    disabledReason={OFFLINE}
                    onPress={() =>
                      void write(
                        removeMember(plan.id, member.user.id),
                        people.turnedDown,
                        people.turnDownFailed,
                      )
                    }
                  />
                </View>
              }
            />
          ))}
        </>
      ) : null}
      <SectionHeader title={copy.peopleGoing} count={going.length} />
      {going.map((member) =>
        personRow(
          member,
          member.role === "member"
            ? undefined
            : TRIP_PLAN_ROLE_LABELS[member.role],
        ),
      )}
      {leader && invited.length > 0 ? (
        <>
          <SectionHeader title={copy.peopleInvited} count={invited.length} />
          {invited.map((member) => personRow(member))}
        </>
      ) : null}

      <BottomSheet
        visible={menuFor !== null}
        onClose={() => setMenuFor(null)}
        title={menuFor?.user.username ?? ""}
      >
        {menuFor ? (
          <View style={styles.verbs}>
            {verbsFor(menuFor).map((verb, index, all) => (
              <Fragment key={verb.id}>
                {verb.separated && index > 0 && !all[index - 1].separated ? (
                  <View style={styles.rule} />
                ) : null}
                <Row
                  icon={verb.icon}
                  hue={verb.danger ? theme.warning : undefined}
                  title={verb.label}
                  subtitle={online ? undefined : OFFLINE}
                  disabled={!online}
                  onPress={() => run(verb.id, menuFor)}
                />
              </Fragment>
            ))}
          </View>
        ) : null}
      </BottomSheet>
      <InviteSheet
        visible={inviteOpen}
        plan={plan}
        online={online}
        onClose={() => setInviteOpen(false)}
      />
    </>
  );
}

const useStyles = makeStyles((theme) => ({
  right: { flexDirection: "row", alignItems: "center", gap: spacing(1) },
  actions: { flexDirection: "row", gap: spacing(1) },
  verbs: { gap: spacing(1) },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: theme.line },
}));
