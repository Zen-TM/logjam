// Invite people (`TRIP_PLAN_INVITE`): by username, with the role they will
// get, or by a link copied or handed to the system share sheet. The link
// opens Logjam Web, so it works for someone with no Logjam GPS; whoever opens
// it asks to join and a leader lets each one in. The list of live links
// shows when each was made and ends, not the link.
import { Fragment, useEffect, useState } from "react";
import { Clipboard, Share, Text } from "react-native";
import {
  contractSectionKeys,
  messageFromError,
  planInviteUrl,
  tripPlanInviteLinkLine,
  tripPlanInviteMessage,
  tripPlanInviteePill,
  tripPlanRoleWord,
  TRIP_PLAN_INVITE,
  TRIP_PLAN_ROLES_PICK_ORDER,
  type SectionKeysOn,
  type TripPlanInviteView,
  type TripPlanRole,
  type TripPlanView,
} from "@logjam/shared";

import { unavailableReasonText } from "../auth/capabilities";
import { config } from "../config";
import { UserSearch } from "../screens/UserSearch";
import { makeStyles, muted, spacing } from "../theme";
import {
  BottomSheet,
  Button,
  ChipRail,
  ErrorBanner,
  FormStack,
  Row,
  SectionHeader,
  StatusPill,
} from "../ui";
import {
  createInviteLink,
  getInviteLinks,
  inviteMember,
  revokeInviteLink,
} from "./plansApi";
import { afterPlanWrite } from "./plansCache";

const copy = TRIP_PLAN_INVITE.copy;
const OFFLINE = unavailableReasonText("needs-connection");

export function InviteSheet({
  visible,
  plan,
  online,
  onClose,
}: {
  visible: boolean;
  plan: TripPlanView;
  online: boolean;
  onClose: () => void;
}) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={TRIP_PLAN_INVITE.title}
    >
      {/* Mounted on open, so each opening starts a fresh search. */}
      {visible ? <InviteBody plan={plan} online={online} /> : null}
    </BottomSheet>
  );
}

function InviteBody({ plan, online }: { plan: TripPlanView; online: boolean }) {
  const styles = useStyles();
  const [role, setRole] = useState<TripPlanRole>("member");
  const [invitedIds, setInvitedIds] = useState<string[]>([]);
  // A row's or a link button's failure: not the search field's, so a banner.
  const [error, setError] = useState<string | null>(null);
  const [links, setLinks] = useState<TripPlanInviteView[]>([]);
  const [making, setMaking] = useState<"copy" | "share" | null>(null);
  const [copied, setCopied] = useState(false);
  // The user or link a write is running for: only its button waits.
  const [busyId, setBusyId] = useState<string | null>(null);

  const refreshLinks = () =>
    getInviteLinks(plan.id)
      .then(({ invites }) => setLinks(invites))
      // The list is a courtesy; inviting works without it.
      .catch(console.error);
  useEffect(() => {
    void refreshLinks();
    // Once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id]);

  const invite = (userId: string, username: string) => {
    setError(null);
    setBusyId(userId);
    inviteMember(plan.id, username, role)
      .then(() => {
        setInvitedIds((ids) => [...ids, userId]);
        return afterPlanWrite(plan.id);
      })
      .catch((err: unknown) =>
        setError(messageFromError(err, copy.inviteFailed)),
      )
      .finally(() => setBusyId(null));
  };

  // Each press mints a new link: the token is never kept to hand out twice.
  // The mint, the hand-off and the list each fail on their own: a link made
  // is never reported as not made.
  const makeLink = async (how: "copy" | "share") => {
    if (making) return;
    setError(null);
    setCopied(false);
    setMaking(how);
    try {
      let token: string;
      try {
        ({ token } = await createInviteLink(plan.id));
      } catch (err) {
        setError(messageFromError(err, copy.linkMakeFailed));
        return;
      }
      void refreshLinks();
      const url = planInviteUrl(config.webUrl, token);
      if (how === "share") {
        const message = tripPlanInviteMessage(plan.name, url);
        // A share sheet that won't open leaves the link listed, to turn off.
        await Share.share({ message }).catch(console.error);
      } else {
        // RN core Clipboard, as the place page's copy: no native module.
        // The bare link, as Logjam Web copies it; Share carries the sentence.
        Clipboard.setString(url);
        setCopied(true);
      }
    } finally {
      setMaking(null);
    }
  };

  const revoke = (link: TripPlanInviteView) => {
    setError(null);
    setBusyId(link.id);
    revokeInviteLink(plan.id, link.id)
      .then(() => setLinks((was) => was.filter((each) => each.id !== link.id)))
      .catch((err: unknown) =>
        setError(messageFromError(err, copy.linkRevokeFailed)),
      )
      .finally(() => setBusyId(null));
  };

  const statusOf = new Map(
    plan.members.map((member) => [member.user.id, member.status]),
  );
  const sections: Record<
    SectionKeysOn<typeof TRIP_PLAN_INVITE, "gps">,
    React.ReactNode
  > = {
    search: (
      <>
        <Text style={styles.label}>{copy.role}</Text>
        <ChipRail
          options={TRIP_PLAN_ROLES_PICK_ORDER.map((value) => ({
            value,
            label: tripPlanRoleWord(value),
          }))}
          value={role}
          onChange={setRole}
        />
        <UserSearch
          label={copy.searchField}
          failed={copy.searchFailed}
          offline={online ? undefined : OFFLINE}
          onChange={() => setError(null)}
          right={(user) => {
            const pill = invitedIds.includes(user.id)
              ? copy.invited
              : tripPlanInviteePill(statusOf.get(user.id));
            return pill ? (
              <StatusPill label={pill} tone="outline" />
            ) : (
              <Button
                label={copy.inviteSend}
                compact
                loading={busyId === user.id}
                disabled={!online}
                disabledReason={OFFLINE}
                onPress={() => invite(user.id, user.username)}
              />
            );
          }}
        />
      </>
    ),
    link: (
      <>
        <Text style={styles.hint}>{copy.linkHint}</Text>
        <Button
          label={copy.linkCopy}
          icon="link"
          variant="outlineAccent"
          loading={making === "copy"}
          disabled={!online}
          disabledReason={OFFLINE}
          onPress={() => void makeLink("copy")}
        />
        <Button
          label={copy.linkShare}
          icon="shareFriend"
          variant="outlineAccent"
          loading={making === "share"}
          disabled={!online}
          disabledReason={OFFLINE}
          onPress={() => void makeLink("share")}
        />
        {/* The buttons only dim: the words go under them (ui/Button.tsx). */}
        {online ? null : <Text style={styles.hint}>{OFFLINE}</Text>}
        {copied ? <Text style={styles.hint}>{copy.linkCopied}</Text> : null}
        {links.length > 0 ? (
          <SectionHeader title={copy.linksLive} count={links.length} />
        ) : null}
        {links.map((link) => (
          <Row
            key={link.id}
            icon="date"
            title={tripPlanInviteLinkLine(link)}
            subtitle={online ? undefined : OFFLINE}
            right={
              <Button
                label={copy.linkRevoke}
                compact
                variant="ghost"
                loading={busyId === link.id}
                disabled={!online}
                disabledReason={OFFLINE}
                onPress={() => revoke(link)}
              />
            }
          />
        ))}
      </>
    ),
  };

  return (
    <FormStack>
      {contractSectionKeys(TRIP_PLAN_INVITE, "gps").map((key) => (
        <Fragment key={key}>{sections[key]}</Fragment>
      ))}
      {error ? <ErrorBanner message={error} /> : null}
    </FormStack>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  label: { ...muted(theme, textRole.detail) },
  hint: { ...muted(theme, textRole.detail), marginTop: spacing(1) },
}));
