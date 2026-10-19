// Invite people, one step inside a plan's People view (design §7.6): find
// someone by username and pick their role, or send a link. A link is shown
// only when the clipboard refuses it, as Friends' is: it exists only in the
// reply that made it. Live links are listed, each with Turn off.
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import {
  contractSectionKeys,
  formatDateKey,
  planInviteUrl,
  TRIP_PLAN_INVITE,
  tripPlanInviteMessage,
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
import { searchUsers, type TSearchUser } from "../../placeUtils";
import {
  createInviteLink,
  getInviteLinks,
  inviteMember,
  revokeInviteLink,
} from "../../plansApi";
import classes from "./plans.module.css";

const copy = TRIP_PLAN_INVITE.copy;
/** Shorter than this and the search has nothing useful to match on. */
const SEARCH_MIN_CHARS = 3;

export default function PlanInvitePage({
  plan,
  onBack,
  onInvited,
}: {
  plan: TripPlanView;
  onBack: () => void;
  onInvited: () => void;
}) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TSearchUser[]>([]);
  const [role, setRole] = useState<TripPlanRole>("member");
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [links, setLinks] = useState<TripPlanInviteView[]>([]);
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const already = new Set(plan.members.map((member) => member.user.id));
  const typed = query.trim();
  const searches = typed.length >= SEARCH_MIN_CHARS;
  if (!searches && results.length > 0) setResults([]);

  useEffect(() => {
    if (!searches) return;
    let cancelled = false;
    timer.current = setTimeout(() => {
      searchUsers(typed)
        .then(({ data }) => {
          if (!cancelled) setResults(data);
        })
        .catch((err) => {
          if (cancelled) return;
          console.error(err);
          toast.error(messageFromError(err, copy.searchFailed));
        });
    }, 300);
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [searches, typed, toast]);

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
    setSendingId(user.id);
    try {
      await inviteMember(plan.id, user.username, role);
      toast.success(copy.invited);
      onInvited();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, copy.inviteFailed));
    } finally {
      setSendingId(null);
    }
  }

  /** Make a link, then hand it on: to the share sheet, else the clipboard. */
  async function sendLink(share: boolean) {
    setBusy(true);
    let url: string;
    try {
      const { token } = await createInviteLink(plan.id);
      url = planInviteUrl(window.location.origin, token);
      setShown(null);
      void loadLinks();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, copy.linkMakeFailed));
      setBusy(false);
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
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    try {
      await revokeInviteLink(plan.id, id);
      toast.success(copy.linkRevoked);
      void loadLinks();
    } catch (err) {
      console.error(err);
      toast.error(messageFromError(err, copy.linkRevokeFailed));
    } finally {
      setBusy(false);
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
            autoFocus
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
            options={[
              { value: "member", label: "Member" },
              { value: "editor", label: "Editor" },
              { value: "leader", label: "Leader" },
            ]}
          />
        </div>
        {searches &&
          results.map((user) => (
            <Row
              key={user.id}
              leading={<Avatar username={user.username} />}
              title={user.username}
              trailing={
                already.has(user.id) ? (
                  <StatusPill label={copy.inPlan} tone="muted" />
                ) : (
                  <Button
                    compact
                    variant="outline"
                    busy={sendingId === user.id}
                    disabled={sendingId !== null}
                    disabledReason="Inviting…"
                    onClick={() => void invite(user)}
                  >
                    {copy.inviteSend}
                  </Button>
                )
              }
            />
          ))}
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
              busy={busy}
              onClick={() => void sendLink(false)}
            >
              {copy.linkCopy}
            </Button>
            {"share" in navigator && (
              <Button
                variant="outline"
                icon="shareFriend"
                disabled={busy}
                disabledReason="Working…"
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
            title={`Made ${formatDateKey(link.createdAt)}, works until ${formatDateKey(link.expiresAt)}`}
            leading={undefined}
            trailing={
              <Button
                compact
                disabled={busy}
                disabledReason="Working…"
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
        backLabel="Back to people"
      />
      <div className={classes.list}>
        {contractSectionKeys(TRIP_PLAN_INVITE, "web").map((key) => (
          <Fragment key={key}>{sections[key]}</Fragment>
        ))}
      </div>
    </div>
  );
}
