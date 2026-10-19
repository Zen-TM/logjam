// A plan's People view: people asking to join first (leaders
// only), answered in the row's footer with their answers one press away; then
// who's going, leaders first; then who's invited (leaders only). A leader's ⋯
// on someone going changes their role or removes them.
import { useState } from "react";
import {
  formatBytes,
  planAddVerbLabel,
  planMemberVerbs,
  planRemoveConfirm,
  planTurnDownConfirm,
  PLAN_ROLE_OF_VERB,
  TRIP_PLAN_PAGE,
  TRIP_PLAN_JOIN,
  TRIP_PLANS_LIST,
  tripPlanGoing,
  tripPlanLetInMessage,
  tripPlanRemovedMessage,
  type PlanMemberVerbId,
  type TripPlanMemberView,
  type TripPlanView,
} from "@logjam/shared";
import {
  Avatar,
  Button,
  Checkbox,
  IconButton,
  ListEnd,
  Menu,
  Row,
  SectionHeader,
  StatusPill,
} from "../../ui";
import ConfirmDialog from "../dialogs/ConfirmDialog";
import { useToast } from "../feedback/ToastProvider";
import { messageFromError } from "../../errors/messageFromError";
import { approveMember, removeMember, setMemberRole } from "../../plansApi";
import { menuEntries } from "./planMenu";
import { answeredForm, filesChargedTo } from "./plansModel";
import classes from "./plans.module.css";

const copy = TRIP_PLAN_PAGE.copy;

export default function PlanPeople({
  plan,
  myUserId,
  onChanged,
  onInvite,
  onSeeAnswers,
}: {
  plan: TripPlanView;
  myUserId: string | null;
  /** Fetch the plan again; `quiet` after a write whose failure was just said. */
  onChanged: (options?: { quiet: boolean }) => void;
  onInvite: () => void;
  /** Open a form a request answered (leaders see its answers). */
  onSeeAnswers: (formId: string) => void;
}) {
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<TripPlanMemberView | null>(null);
  const [turningDown, setTurningDown] = useState<TripPlanMemberView | null>(
    null,
  );
  const [deleteFiles, setDeleteFiles] = useState(false);
  const leader = plan.myRole === "leader";
  const archived = plan.archivedAt != null;

  async function run(
    id: string,
    action: () => Promise<unknown>,
    failure: string,
    success?: string,
  ) {
    setBusyId(id);
    try {
      await action();
      if (success) toast.success(success);
      onChanged();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, failure));
      onChanged({ quiet: true });
    } finally {
      setBusyId(null);
    }
  }

  const byStatus = (status: TripPlanMemberView["status"]) =>
    plan.members.filter((member) => member.status === status);
  const asking = byStatus("requested");
  const invited = byStatus("invited");
  const going = tripPlanGoing(plan.members);
  const leaders = going.filter((member) => member.role === "leader").length;
  const asked = leader && asking.length > 0;
  const invitedShown = leader && invited.length > 0;
  // A heading needs a second group to divide from.
  const headed = asked || invitedShown;

  const runVerb = (member: TripPlanMemberView, id: PlanMemberVerbId) => {
    const role = PLAN_ROLE_OF_VERB[id];
    if (role)
      void run(
        member.user.id,
        () => setMemberRole(plan.id, member.user.id, role),
        copy.roleFailed,
      );
    else {
      setDeleteFiles(false);
      setRemoving(member);
    }
  };

  const roleWord = (member: TripPlanMemberView) =>
    member.role === "leader"
      ? TRIP_PLANS_LIST.copy.pillLeader
      : member.role === "editor"
        ? TRIP_PLANS_LIST.copy.pillEditor
        : null;

  const removingFiles = removing
    ? filesChargedTo(plan, removing.user.id)
    : null;
  const removeCopy = removing
    ? planRemoveConfirm(
        removing.user.username,
        plan.name,
        removingFiles && removingFiles.count > 0
          ? {
              count: removingFiles.count,
              size: formatBytes(removingFiles.bytes),
            }
          : null,
      )
    : null;
  const turnDownCopy = turningDown
    ? planTurnDownConfirm(turningDown.user.username)
    : null;

  return (
    <div className={classes.list}>
      {asked && (
        <>
          <SectionHeader title={copy.peopleAsking} count={asking.length} />
          {asking.map((member) => {
            const answered = answeredForm(plan, member.user.id);
            return (
              <Row
                key={member.user.id}
                title={member.user.username}
                leading={<Avatar username={member.user.username} />}
                footer={
                  !archived && (
                    <>
                      <Button
                        compact
                        variant="filled"
                        icon="accept"
                        busy={busyId === member.user.id}
                        onClick={() =>
                          void run(
                            member.user.id,
                            () => approveMember(plan.id, member.user.id),
                            copy.letInFailed,
                            tripPlanLetInMessage(member.user.username),
                          )
                        }
                      >
                        {copy.letIn}
                      </Button>
                      <Button
                        compact
                        variant="outline"
                        icon="ignore"
                        onClick={() => setTurningDown(member)}
                      >
                        {copy.turnDown}
                      </Button>
                      {answered && (
                        <Button
                          compact
                          variant="outline"
                          onClick={() => onSeeAnswers(answered)}
                        >
                          {copy.seeAnswers}
                        </Button>
                      )}
                    </>
                  )
                }
              />
            );
          })}
        </>
      )}
      {headed && <SectionHeader title={copy.peopleGoing} />}
      {going.map((member) => {
        const verbs = planMemberVerbs(
          plan.myRole,
          { role: member.role, self: member.user.id === myUserId },
          { archived, leaders },
        );
        const word = roleWord(member);
        return (
          <Row
            key={member.user.id}
            title={member.user.username}
            leading={<Avatar username={member.user.username} />}
            trailing={
              <>
                {word && <StatusPill label={word} tone="outline" />}
                {verbs.length > 0 && (
                  <Menu
                    label={`Actions for ${member.user.username}`}
                    title={member.user.username}
                    placement="right-start"
                    entries={menuEntries(verbs, (id) => runVerb(member, id))}
                    trigger={(props) => (
                      <IconButton
                        {...props}
                        icon="overflow"
                        label={`Actions for ${member.user.username}`}
                      />
                    )}
                  />
                )}
              </>
            }
          />
        );
      })}
      {invitedShown && (
        <>
          <SectionHeader title={copy.peopleInvited} count={invited.length} />
          {invited.map((member) => (
            <Row
              key={member.user.id}
              title={member.user.username}
              subtitle={
                member.invitedBy
                  ? `${TRIP_PLAN_JOIN.copy.invitedBy} ${member.invitedBy.username}`
                  : undefined
              }
              leading={<Avatar username={member.user.username} />}
              trailing={
                !archived && (
                  <IconButton
                    icon="close"
                    label={`${copy.cancelInvite}: ${member.user.username}`}
                    onClick={() =>
                      void run(
                        member.user.id,
                        () => removeMember(plan.id, member.user.id, "invited"),
                        copy.cancelInviteFailed,
                        copy.inviteCancelled,
                      )
                    }
                  />
                )
              }
            />
          ))}
        </>
      )}
      {leader && !archived && (
        <ListEnd>
          <Button
            variant="filled"
            icon="addFriend"
            data-invite-people
            onClick={onInvite}
          >
            {planAddVerbLabel("invite")}
          </Button>
        </ListEnd>
      )}

      <ConfirmDialog
        open={removeCopy != null}
        title={removeCopy?.confirmTitle}
        message={
          <>
            <p>{removeCopy?.confirmBody}</p>
            {removeCopy?.deleteFilesLabel && (
              <Checkbox
                label={removeCopy.deleteFilesLabel}
                checked={deleteFiles}
                onChange={setDeleteFiles}
              />
            )}
          </>
        }
        confirmLabel={removeCopy?.confirmLabel}
        busy={busyId === removing?.user.id}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (!removing) return;
          const who = removing;
          void run(
            who.user.id,
            () => removeMember(plan.id, who.user.id, "active", deleteFiles),
            copy.removeFailed,
            tripPlanRemovedMessage(who.user.username),
          ).then(() => setRemoving(null));
        }}
      />
      <ConfirmDialog
        open={turnDownCopy != null}
        title={turnDownCopy?.confirmTitle}
        message={turnDownCopy?.confirmBody}
        confirmLabel={turnDownCopy?.confirmLabel}
        confirmColor="primary"
        busy={busyId === turningDown?.user.id}
        onClose={() => setTurningDown(null)}
        onConfirm={() => {
          if (!turningDown) return;
          const who = turningDown;
          void run(
            who.user.id,
            () => removeMember(plan.id, who.user.id, "requested"),
            copy.turnDownFailed,
            copy.turnedDown,
          ).then(() => setTurningDown(null));
        }}
      />
    </div>
  );
}
