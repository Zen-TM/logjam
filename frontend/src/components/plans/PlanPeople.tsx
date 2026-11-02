// A plan's People view: people asking to join first (leaders
// only), let in or turned down on their row; then
// who's going, leaders first; then who's invited (leaders only). A leader's ⋯
// on someone going changes their role or removes them.
import { useState } from "react";
import {
  formatBytes,
  planAddVerbLabel,
  tripPlanPerson,
  todayDateKey,
  tripPlanRoleWord,
  planRemoveConfirm,
  planSelfRoleConfirm,
  planTurnDownConfirm,
  PLAN_ROLE_OF_VERB,
  TRIP_PLAN_PAGE,
  TRIP_PLAN_JOIN,
  tripPlanFilesChargedTo,
  tripPlanGoing,
  tripPlanLetInMessage,
  tripPlanRemovedMessage,
  type PlanPersonActionId,
  type TripPlanMemberView,
  type TripPlanView,
} from "@logjam/shared";
import {
  Avatar,
  Button,
  Checkbox,
  Dialog,
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
import { useBusyIds } from "../../useBusyIds";
import { menuEntries } from "./planMenu";
import classes from "./plans.module.css";

const copy = TRIP_PLAN_PAGE.copy;

export default function PlanPeople({
  plan,
  myUserId,
  onChanged,
  onInvite,
}: {
  plan: TripPlanView;
  myUserId: string | null;
  /** Fetch the plan again; `quiet` after a write whose failure was just said. */
  onChanged: (options?: { quiet: boolean }) => void;
  onInvite: () => void;
}) {
  const toast = useToast();
  const busy = useBusyIds();
  const [removing, setRemoving] = useState<TripPlanMemberView | null>(null);
  // Leading no more, chosen on the caller's own row: confirmed first.
  const [stepping, setStepping] = useState<"editor" | "member" | null>(null);
  const [turningDown, setTurningDown] = useState<TripPlanMemberView | null>(
    null,
  );
  const [deleteFiles, setDeleteFiles] = useState(false);
  // Whose sheet is open, by id, so a write that removes them closes it.
  const [personId, setPersonId] = useState<string | null>(null);
  const leader = plan.myRole === "leader";
  const archived = plan.archivedAt != null;

  async function run(
    id: string,
    action: () => Promise<unknown>,
    failure: string,
    success?: string,
  ) {
    busy.start(id);
    try {
      await action();
      if (success) toast.success(success);
      onChanged();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, failure));
      onChanged({ quiet: true });
    } finally {
      busy.stop(id);
    }
  }

  const byStatus = (status: TripPlanMemberView["status"]) =>
    plan.members.filter((member) => member.status === status);
  const asking = byStatus("requested");
  const invited = byStatus("invited");
  const going = tripPlanGoing(plan.members);
  const today = todayDateKey();
  const asked = leader && asking.length > 0;
  const invitedShown = leader && invited.length > 0;
  // A heading needs a second group to divide from.
  const headed = asked || invitedShown;

  const act = (member: TripPlanMemberView, id: PlanPersonActionId) => {
    setPersonId(null);
    if (id === "letIn") return letIn(member);
    if (id === "turnDown") return setTurningDown(member);
    if (id === "cancelInvite") return cancelInvite(member);
    const role = PLAN_ROLE_OF_VERB[id];
    if (role && role !== "leader" && member.user.id === myUserId)
      setStepping(role);
    else if (role)
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

  const letIn = (member: TripPlanMemberView) =>
    void run(
      member.user.id,
      () => approveMember(plan.id, member.user.id),
      copy.letInFailed,
      tripPlanLetInMessage(member.user.username),
    );
  const cancelInvite = (member: TripPlanMemberView) =>
    void run(
      member.user.id,
      () => removeMember(plan.id, member.user.id, "invited"),
      copy.cancelInviteFailed,
      copy.inviteCancelled,
    );

  const roleWord = (member: TripPlanMemberView) =>
    member.role === "member" ? null : tripPlanRoleWord(member.role);

  const removingFiles = removing
    ? tripPlanFilesChargedTo(plan, removing.user.id)
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
  const steppingCopy = stepping
    ? planSelfRoleConfirm(
        stepping,
        going
          .filter(
            (member) => member.role === "leader" && member.user.id !== myUserId,
          )
          .map((member) => member.user.username),
      )
    : null;
  const turnDownCopy = turningDown
    ? planTurnDownConfirm(turningDown.user.username)
    : null;

  const person = plan.members.find((each) => each.user.id === personId);
  const personView = person
    ? tripPlanPerson(plan, person, myUserId, today)
    : null;

  return (
    <div className={classes.list}>
      {asked && (
        <>
          <SectionHeader title={copy.peopleAsking} count={asking.length} />
          {asking.map((member) => (
            <Row
              key={member.user.id}
              title={member.user.username}
              onOpen={() => setPersonId(member.user.id)}
              leading={<Avatar username={member.user.username} />}
              trailing={
                !archived && (
                  <>
                    <IconButton
                      icon="accept"
                      tone="filled"
                      label={copy.letIn}
                      disabled={busy.isBusy(member.user.id)}
                      disabledReason="Replying…"
                      onClick={() => letIn(member)}
                    />
                    <IconButton
                      icon="ignore"
                      label={copy.turnDown}
                      disabled={busy.isBusy(member.user.id)}
                      disabledReason="Replying…"
                      onClick={() => setTurningDown(member)}
                    />
                  </>
                )
              }
            />
          ))}
        </>
      )}
      {headed && (
        <SectionHeader title={copy.peopleGoing} count={going.length} />
      )}
      {going.map((member) => {
        const verbs = tripPlanPerson(plan, member, myUserId, today).actions;
        const word = roleWord(member);
        return (
          <Row
            key={member.user.id}
            title={member.user.username}
            onOpen={() => setPersonId(member.user.id)}
            leading={<Avatar username={member.user.username} />}
            trailing={
              <>
                {word && <StatusPill label={word} tone="outline" />}
                {verbs.length > 0 && (
                  <Menu
                    label={`Actions for ${member.user.username}`}
                    title={member.user.username}
                    placement="right-start"
                    entries={menuEntries(verbs, (id) => act(member, id))}
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
              onOpen={() => setPersonId(member.user.id)}
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
                    onClick={() => cancelInvite(member)}
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

      <Dialog
        open={personView != null}
        title={personView?.name}
        onClose={() => setPersonId(null)}
      >
        {person && personView && (
          <div className={classes.list}>
            <p className={classes.note}>
              {[personView.status, personView.role, personView.invitedBy]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {personView.unanswered && personView.unanswered.length > 0 && (
              <>
                <SectionHeader title={copy.personUnanswered} />
                <ul>
                  {personView.unanswered.map((title) => (
                    <li key={title}>{title}</li>
                  ))}
                </ul>
              </>
            )}
            {personView.actions.map((action) => (
              <Button
                key={action.id}
                variant={action.danger ? "danger" : "outline"}
                icon={action.icon}
                disabled={busy.isBusy(person.user.id)}
                disabledReason="Replying…"
                onClick={() => act(person, action.id)}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </Dialog>
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
        busy={busy.isBusy(removing?.user.id)}
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
        open={steppingCopy != null}
        title={steppingCopy?.confirmTitle}
        message={steppingCopy?.confirmBody}
        confirmLabel={steppingCopy?.confirmLabel}
        busy={busy.isBusy(myUserId)}
        onClose={() => setStepping(null)}
        onConfirm={() => {
          if (!stepping || !myUserId) return;
          const role = stepping;
          void run(
            myUserId,
            () => setMemberRole(plan.id, myUserId, role),
            copy.roleFailed,
          ).then(() => setStepping(null));
        }}
      />
      <ConfirmDialog
        open={turnDownCopy != null}
        title={turnDownCopy?.confirmTitle}
        message={turnDownCopy?.confirmBody}
        confirmLabel={turnDownCopy?.confirmLabel}
        confirmColor="primary"
        busy={busy.isBusy(turningDown?.user.id)}
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
