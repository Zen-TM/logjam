// A plan's People (`TRIP_PLAN_PAGE`'s `people`): who's asking to join and
// who's invited (a leader's alone), and who's going. A leader lets a request
// in or turns it down on its row, cancels an invite on its row, and runs a
// person's ⋯ (`planMemberVerbs`): another role, or Remove. Every remove sends
// the status the leader saw, so a stale row removes nobody (409). Every write
// is online-only, so offline each control is disabled with its reason.
import { Fragment, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import {
  ApiError,
  formatBytes,
  messageFromError,
  planAddVerbLabel,
  planMemberVerbs,
  planRemoveConfirm,
  planSelfRoleConfirm,
  tripPlanActionsFor,
  planTurnDownConfirm,
  tripPlanFilesChargedTo,
  tripPlanGoing,
  tripPlanLetInMessage,
  tripPlanRemovedMessage,
  tripPlanRoleWord,
  PLAN_ROLE_OF_VERB,
  TRIP_PLAN_JOIN,
  TRIP_PLAN_PAGE,
  type PlanMemberVerbId,
  type TripPlanMemberView,
  type TripPlanView,
} from "@logjam/shared";

import { unavailableReasonText } from "../auth/capabilities";
import { makeStyles, muted, spacing, useTheme } from "../theme";
import {
  BottomSheet,
  Button,
  IconButton,
  ListEnd,
  Row,
  SectionHeader,
  StatusPill,
} from "../ui";
import { InviteSheet } from "./InviteSheet";
import { approveMember, removeMember, setMemberRole } from "./plansApi";
import { afterPlanWrite } from "./plansCache";

const copy = TRIP_PLAN_PAGE.copy;
const OFFLINE = unavailableReasonText("needs-connection");

/** The first form a person answered, for a leader reading their request. */
const formAnsweredBy = (plan: TripPlanView, userId: string) =>
  plan.forms.find((form) =>
    form.answers.some((answer) => answer.user.id === userId),
  )?.id ?? null;

export function PeopleView({
  plan,
  myId,
  canInvite,
  online,
  onSeeAnswers,
  onInfo,
  onError,
}: {
  plan: TripPlanView;
  /** The caller's user id: whose row is theirs. */
  myId: string | null;
  /** Invite people is the caller's to run (a leader, the plan not archived). */
  canInvite: boolean;
  online: boolean;
  /** A request's answers: the form sheet opens on the form they answered. */
  onSeeAnswers: (formId: string) => void;
  onInfo: (message: string) => void;
  onError: (message: string) => void;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const [menuFor, setMenuFor] = useState<TripPlanMemberView | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  // The person a write is running for: their row's controls wait for it.
  const [busyId, setBusyId] = useState<string | null>(null);

  const archived = plan.archivedAt != null;
  const write = (
    member: TripPlanMemberView,
    call: () => Promise<unknown>,
    done: string | null,
    failed: string,
  ) => {
    setBusyId(member.user.id);
    call()
      .then(() => afterPlanWrite(plan.id))
      .then(() => {
        if (done) onInfo(done);
      })
      .catch((err: unknown) => {
        // A 409 (their status moved on) or a 404: show the plan as it is.
        if (err instanceof ApiError) void afterPlanWrite(plan.id);
        onError(messageFromError(err, failed));
      })
      .finally(() => setBusyId(null));
  };

  const remove = (member: TripPlanMemberView) => {
    const files = tripPlanFilesChargedTo(plan, member.user.id);
    const confirm = planRemoveConfirm(
      member.user.username,
      plan.name,
      files.count > 0
        ? { count: files.count, size: formatBytes(files.bytes) }
        : null,
    );
    const go = (deleteFiles: boolean) =>
      write(
        member,
        () => removeMember(plan.id, member.user.id, member.status, deleteFiles),
        tripPlanRemovedMessage(member.user.username),
        copy.removeFailed,
      );
    Alert.alert(confirm.confirmTitle, confirm.confirmBody, [
      { text: "Cancel", style: "cancel" },
      ...(confirm.deleteFilesLabel
        ? [
            {
              text: confirm.deleteFilesLabel,
              style: "destructive" as const,
              onPress: () => go(true),
            },
          ]
        : []),
      {
        text: confirm.confirmLabel,
        style: "destructive",
        onPress: () => go(false),
      },
    ]);
  };

  const run = (id: PlanMemberVerbId, member: TripPlanMemberView) => {
    setMenuFor(null);
    const role = PLAN_ROLE_OF_VERB[id];
    if (!role) return remove(member);
    const change = () =>
      write(
        member,
        () => setMemberRole(plan.id, member.user.id, role),
        null,
        copy.roleFailed,
      );
    // A leader stepping down can't undo it themselves: confirmed.
    if (
      member.user.id === myId &&
      member.role === "leader" &&
      role !== "leader"
    ) {
      const confirm = planSelfRoleConfirm(
        role,
        going
          .filter((each) => each.role === "leader" && each.user.id !== myId)
          .map((each) => each.user.username),
      );
      return Alert.alert(confirm.confirmTitle, confirm.confirmBody, [
        { text: "Cancel", style: "cancel" },
        { text: confirm.confirmLabel, style: "destructive", onPress: change },
      ]);
    }
    change();
  };

  const turnDown = (member: TripPlanMemberView) => {
    const confirm = planTurnDownConfirm(member.user.username);
    Alert.alert(confirm.confirmTitle, confirm.confirmBody, [
      { text: "Cancel", style: "cancel" },
      {
        text: confirm.confirmLabel,
        onPress: () =>
          write(
            member,
            () => removeMember(plan.id, member.user.id, "requested"),
            copy.turnedDown,
            copy.turnDownFailed,
          ),
      },
    ]);
  };

  const leader = plan.myRole === "leader";
  const going = tripPlanGoing(plan.members);
  const leaders = going.filter((member) => member.role === "leader").length;
  const asking = leader
    ? plan.members.filter((member) => member.status === "requested")
    : [];
  const invited = leader
    ? plan.members.filter((member) => member.status === "invited")
    : [];
  // A heading needs a second group to divide from (shared/DESIGN.md §2).
  const headed =
    [asking.length, going.length, invited.length].filter((n) => n > 0).length >
    1;
  const verbsFor = (member: TripPlanMemberView) =>
    myId
      ? planMemberVerbs(
          plan.myRole,
          { role: member.role, self: member.user.id === myId },
          { archived, leaders },
        )
      : [];

  return (
    <>
      {asking.length > 0 ? (
        <SectionHeader title={copy.peopleAsking} count={asking.length} />
      ) : null}
      {asking.map((member) => (
        <Row
          key={member.user.id}
          icon="account"
          title={member.user.username}
          subtitle={online ? undefined : OFFLINE}
          footer={
            <View style={styles.actions}>
              {/* An archived plan takes no one in; turning down still works. */}
              {archived ? null : (
                <Button
                  label={copy.letIn}
                  icon="accept"
                  compact
                  loading={busyId === member.user.id}
                  disabled={!online || busyId === member.user.id}
                  disabledReason={OFFLINE}
                  onPress={() =>
                    write(
                      member,
                      () => approveMember(plan.id, member.user.id),
                      tripPlanLetInMessage(member.user.username),
                      copy.letInFailed,
                    )
                  }
                />
              )}
              <Button
                label={copy.turnDown}
                icon="ignore"
                compact
                variant="ghost"
                disabled={!online || busyId === member.user.id}
                disabledReason={OFFLINE}
                onPress={() => turnDown(member)}
              />
              {formAnsweredBy(plan, member.user.id) ? (
                <Button
                  label={copy.seeAnswers}
                  compact
                  variant="ghost"
                  onPress={() =>
                    onSeeAnswers(formAnsweredBy(plan, member.user.id)!)
                  }
                />
              ) : null}
            </View>
          }
        />
      ))}
      {headed && going.length > 0 ? (
        <SectionHeader title={copy.peopleGoing} count={going.length} />
      ) : null}
      {going.map((member) => {
        const verbs = verbsFor(member);
        return (
          <Row
            key={member.user.id}
            icon="account"
            title={member.user.username}
            right={
              <View style={styles.right}>
                {member.role === "member" ? null : (
                  <StatusPill
                    label={tripPlanRoleWord(member.role)}
                    tone="outline"
                  />
                )}
                {verbs.length > 0 ? (
                  <IconButton
                    icon="overflow"
                    accessibilityLabel={tripPlanActionsFor(
                      member.user.username,
                    )}
                    color={theme.textMuted}
                    disabled={busyId === member.user.id}
                    onPress={() => setMenuFor(member)}
                  />
                ) : null}
              </View>
            }
          />
        );
      })}
      {invited.length > 0 ? (
        <SectionHeader title={copy.peopleInvited} count={invited.length} />
      ) : null}
      {invited.map((member) => (
        <Row
          key={member.user.id}
          icon="account"
          title={member.user.username}
          subtitle={
            !online
              ? OFFLINE
              : member.invitedBy
                ? `${TRIP_PLAN_JOIN.copy.invitedBy} ${member.invitedBy.username}`
                : undefined
          }
          right={
            archived ? undefined : (
              <Button
                label={copy.cancelInvite}
                compact
                variant="ghost"
                loading={busyId === member.user.id}
                disabled={!online}
                disabledReason={OFFLINE}
                onPress={() =>
                  write(
                    member,
                    () => removeMember(plan.id, member.user.id, "invited"),
                    copy.inviteCancelled,
                    copy.cancelInviteFailed,
                  )
                }
              />
            )
          }
        />
      ))}

      {canInvite ? (
        <ListEnd>
          <Button
            label={planAddVerbLabel("invite")}
            icon="addFriend"
            variant="outlineAccent"
            disabled={!online}
            disabledReason={OFFLINE}
            onPress={() => setInviteOpen(true)}
          />
          {/* The button only dims: the words go under it (ui/Button.tsx). */}
          {online ? null : <Text style={styles.note}>{OFFLINE}</Text>}
        </ListEnd>
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

const useStyles = makeStyles((theme, textRole) => ({
  right: { flexDirection: "row", alignItems: "center", gap: spacing(1) },
  actions: { flexDirection: "row", gap: spacing(1) },
  verbs: { gap: spacing(1) },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: theme.line },
  note: { ...muted(theme, textRole.detail), textAlign: "center" },
}));
