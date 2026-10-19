// Invite people, one step inside a plan's People view: find
// someone by username and pick their role, or send a link. A link is shown
// only when the clipboard refuses it, as Friends' is: it exists only in the
// reply that made it. Live links are listed, each with Turn off.
import { Fragment, useEffect, useState, type ReactNode } from "react";
import {
  contractSectionKeys,
  FRIENDS,
  planInviteUrl,
  TRIP_PLAN_INVITE,
  TRIP_PLAN_ROLES,
  tripPlanInviteLinkLine,
  tripPlanInviteePill,
  tripPlanInviteMessage,
  tripPlanRoleWord,
  type SectionKeysOn,
  type TripPlanInviteView,
  type TripPlanRole,
  type TripPlanView,
} from "@logjam/shared";
import {
  Avatar,
  Button,
  ChipRail,
  Hero,
  Row,
  SearchField,
  SectionHeader,
  StatusPill,
} from "../../ui";
import { useToast } from "../feedback/ToastProvider";
import { messageFromError } from "../../errors/messageFromError";
import type { TSearchUser } from "../../placeUtils";
import { useUserSearch } from "../../useUserSearch";
import {
  createInviteLink,
  getInviteLinks,
  inviteMember,
  revokeInviteLink,
} from "../../plansApi";
import classes from "./plans.module.css";

const copy = TRIP_PLAN_INVITE.copy;

export default function PlanInvitePage({
  plan,
  onBack,
  onInvited,
}: {
  plan: TripPlanView;
  onBack: () => void;
  /** Fetch the plan again; `quiet` after a write whose failure was just said. */
  onInvited: (options?: { quiet: boolean }) => void;
}) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const { short, results } = useUserSearch(query, true, copy.searchFailed);
  const [role, setRole] = useState<TripPlanRole>("member");
  const [links, setLinks] = useState<TripPlanInviteView[]>([]);
  const [shown, setShown] = useState<string | null>(null);
  // The control that is working: "copy", "share", a link's or a person's id.
  // It disables itself, never its neighbours.
  const [busyId, setBusyId] = useState<string | null>(null);

  const statusOf = new Map(
    plan.members.map((member) => [member.user.id, member.status]),
  );

  const loadLinks = () =>
    getInviteLinks(plan.id)
      .then(setLinks)
      // The list is a courtesy; the buttons work without it.
      .catch((err) => console.error(err));
  useEffect(() => {
    void loadLinks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id]);

  async function invite(user: TSearchUser) {
    setBusyId(user.id);
    try {
      await inviteMember(plan.id, user.username, role);
      toast.success(copy.invited);
      onInvited();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, copy.inviteFailed));
      // Someone else may have invited them first: the row then says so.
      onInvited({ quiet: true });
    } finally {
      setBusyId(null);
    }
  }

  /** Make a link, then hand it on: to the share sheet, else the clipboard. */
  async function sendLink(share: boolean) {
    setBusyId(share ? "share" : "copy");
    let url: string;
    try {
      const { token } = await createInviteLink(plan.id);
      url = planInviteUrl(window.location.origin, token);
      setShown(null);
      void loadLinks();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, copy.linkMakeFailed));
      setBusyId(null);
      return;
    }
    try {
      if (share) {
        await navigator.share({ text: tripPlanInviteMessage(plan.name, url) });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success(copy.linkCopied);
      }
    } catch (err) {
      // A dismissed share sheet is not a failure, but the link was made, so
      // it is put where it can still be taken.
      console.error(err);
      setShown(url);
      if (!share) toast.error(copy.linkCopyFailed);
    } finally {
      setBusyId(null);
    }
  }

  async function revoke(id: string) {
    setBusyId(id);
    // A link shown because the clipboard refused it may be this one.
    setShown(null);
    try {
      await revokeInviteLink(plan.id, id);
      toast.success(copy.linkRevoked);
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, copy.linkRevokeFailed));
    } finally {
      setBusyId(null);
      // After a failure too: another leader may have turned it off first.
      void loadLinks();
    }
  }

  const sections: Record<
    SectionKeysOn<typeof TRIP_PLAN_INVITE, "web">,
    ReactNode
  > = {
    search: (
      <>
        {/* The field grows along a line; in this column it would grow tall. */}
        <div>
          <SearchField
            label={copy.searchField}
            placeholder={copy.searchField}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className={classes.question}>
          <span className={classes.questionLabel} aria-hidden>
            {copy.role}
          </span>
          <ChipRail
            label={copy.role}
            value={role}
            onChange={setRole}
            options={[...TRIP_PLAN_ROLES].reverse().map((value) => ({
              value,
              label: tripPlanRoleWord(value),
            }))}
          />
        </div>
        {query.trim() !== "" && short ? (
          <p className={classes.note}>{FRIENDS.copy.searchHint}</p>
        ) : !short && results.length === 0 ? (
          <p className={classes.note}>{FRIENDS.copy.searchEmpty}</p>
        ) : (
          results.map((user) => {
            const pill = tripPlanInviteePill(statusOf.get(user.id));
            return (
              <Row
                key={user.id}
                leading={<Avatar username={user.username} />}
                title={user.username}
                trailing={
                  pill ? (
                    <StatusPill label={pill} tone="muted" />
                  ) : (
                    <Button
                      compact
                      variant="outline"
                      busy={busyId === user.id}
                      onClick={() => void invite(user)}
                    >
                      {copy.inviteSend}
                    </Button>
                  )
                }
              />
            );
          })
        )}
      </>
    ),
    link: (
      <>
        <div className={classes.block}>
          <p className={classes.note}>{copy.linkHint}</p>
          <div className={classes.suggestions}>
            <Button
              variant="outline"
              icon="link"
              busy={busyId === "copy"}
              onClick={() => void sendLink(false)}
            >
              {copy.linkCopy}
            </Button>
            {"share" in navigator && (
              <Button
                variant="outline"
                icon="shareFriend"
                busy={busyId === "share"}
                onClick={() => void sendLink(true)}
              >
                {copy.linkShare}
              </Button>
            )}
          </div>
          {shown && <p className={classes.body}>{shown}</p>}
        </div>
        {links.length > 0 && (
          <SectionHeader title={copy.linksLive} count={links.length} />
        )}
        {links.map((link) => (
          <Row
            key={link.id}
            title={tripPlanInviteLinkLine(link)}
            trailing={
              <Button
                compact
                busy={busyId === link.id}
                onClick={() => void revoke(link.id)}
              >
                {copy.linkRevoke}
              </Button>
            }
          />
        ))}
      </>
    ),
  };

  return (
    <div className={classes.root}>
      <Hero
        title={TRIP_PLAN_INVITE.title}
        onBack={onBack}
        backLabel={copy.back}
      />
      <div className={classes.list}>
        {contractSectionKeys(TRIP_PLAN_INVITE, "web").map((key) => (
          <Fragment key={key}>{sections[key]}</Fragment>
        ))}
      </div>
    </div>
  );
}
