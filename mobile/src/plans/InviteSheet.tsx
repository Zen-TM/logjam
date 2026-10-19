// Invite people (`TRIP_PLAN_INVITE`): by username, with the role they will
// get, or by a link handed to the system share sheet. The link opens Logjam
// Web, so it works for someone with no Logjam GPS; whoever opens it asks to
// join and a leader lets each one in. The token is in the mint's answer and
// the shared message, nowhere else: the list shows when each link ends.
import { Fragment, useEffect, useState } from "react";
import { ActivityIndicator, Clipboard, Share, Text } from "react-native";
import {
  contractSectionKeys,
  formatDateKey,
  FRIENDS,
  messageFromError,
  planInviteUrl,
  tripPlanInviteMessage,
  TRIP_PLAN_INVITE,
  TRIP_PLAN_ROLE_LABELS,
  TRIP_PLAN_ROLES,
  type SectionKeysOn,
  type TripPlanRole,
  type TripPlanView,
} from "@logjam/shared";

import { searchUsers, type UserSearchResult } from "../api/friends";
import { unavailableReasonText } from "../auth/capabilities";
import { config } from "../config";
import { makeStyles, muted, spacing, useTheme } from "../theme";
import {
  BottomSheet,
  Button,
  ChipRail,
  ErrorBanner,
  FormStack,
  Row,
  SectionHeader,
  StatusPill,
  TextField,
} from "../ui";
import {
  createInviteLink,
  getInviteLinks,
  inviteMember,
  revokeInviteLink,
  type PlanInviteLink,
} from "./plansApi";
import { afterPlanWrite } from "./plansCache";

const copy = TRIP_PLAN_INVITE.copy;
const SEARCH_MIN_CHARS = 3;
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
    <BottomSheet visible={visible} onClose={onClose} title={copy.title}>
      {/* Mounted on open, so each opening starts a fresh search. */}
      {visible ? <InviteBody plan={plan} online={online} /> : null}
    </BottomSheet>
  );
}

function InviteBody({ plan, online }: { plan: TripPlanView; online: boolean }) {
  const theme = useTheme();
  const styles = useStyles();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [role, setRole] = useState<TripPlanRole>("member");
  const [invitedIds, setInvitedIds] = useState<string[]>([]);
  // A row's or a link button's failure: not the search field's, so a banner.
  const [error, setError] = useState<string | null>(null);
  const [links, setLinks] = useState<PlanInviteLink[]>([]);
  const [making, setMaking] = useState<"copy" | "share" | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getInviteLinks(plan.id)
      .then(({ invites }) => {
        if (!cancelled) setLinks(invites);
      })
      // The list is a courtesy; sharing works without it.
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [plan.id]);

  const changeQuery = (next: string) => {
    setQuery(next);
    setError(null);
    setSearchError(null);
    if (next.trim().length < SEARCH_MIN_CHARS) setResults([]);
    else setSearching(true);
  };

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < SEARCH_MIN_CHARS) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchUsers(trimmed)
        .then(({ data }) => {
          if (!cancelled) setResults(data);
        })
        .catch((err: unknown) => {
          if (!cancelled)
            setSearchError(messageFromError(err, copy.searchFailed));
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const invite = (user: UserSearchResult) => {
    setError(null);
    inviteMember(plan.id, user.username, role)
      .then(() => {
        setInvitedIds((ids) => [...ids, user.id]);
        return afterPlanWrite(plan.id);
      })
      .catch((err: unknown) =>
        setError(messageFromError(err, copy.inviteFailed)),
      );
  };

  // Each press mints a new link: the token is never kept to hand out twice.
  const makeLink = async (how: "copy" | "share") => {
    setError(null);
    setCopied(false);
    setMaking(how);
    try {
      const { token } = await createInviteLink(plan.id);
      const message = tripPlanInviteMessage(
        plan.name,
        planInviteUrl(config.webUrl, token),
      );
      if (how === "share") await Share.share({ message });
      else {
        // RN core Clipboard, as the place page's copy: no native module.
        Clipboard.setString(message);
        setCopied(true);
      }
      const { invites } = await getInviteLinks(plan.id);
      setLinks(invites);
    } catch (err) {
      setError(messageFromError(err, copy.linkMakeFailed));
    } finally {
      setMaking(null);
    }
  };

  const revoke = (link: PlanInviteLink) => {
    setError(null);
    revokeInviteLink(plan.id, link.id)
      .then(() => setLinks((was) => was.filter((each) => each.id !== link.id)))
      .catch((err: unknown) =>
        setError(messageFromError(err, copy.linkRevokeFailed)),
      );
  };

  const inPlan = new Set(plan.members.map((member) => member.user.id));
  const trimmed = query.trim();
  const sections: Record<
    SectionKeysOn<typeof TRIP_PLAN_INVITE, "gps">,
    React.ReactNode
  > = {
    search: (
      <>
        <TextField
          label={copy.searchField}
          value={query}
          onChangeText={changeQuery}
          autoCapitalize="none"
          error={searchError}
        />
        <Text style={styles.label}>{copy.role}</Text>
        <ChipRail
          options={TRIP_PLAN_ROLES.map((value) => ({
            value,
            label: TRIP_PLAN_ROLE_LABELS[value],
          }))}
          value={role}
          onChange={setRole}
        />
        {searching ? <ActivityIndicator color={theme.accent} /> : null}
        {trimmed.length > 0 && trimmed.length < SEARCH_MIN_CHARS ? (
          <Text style={styles.hint}>{FRIENDS.copy.searchHint}</Text>
        ) : null}
        {results.map((user) => (
          <Row
            key={user.id}
            icon="account"
            title={user.username}
            right={
              inPlan.has(user.id) ? (
                <StatusPill label={copy.inPlan} tone="muted" />
              ) : invitedIds.includes(user.id) ? (
                <StatusPill label={copy.invited} tone="outline" />
              ) : (
                <Button
                  label={copy.inviteSend}
                  compact
                  disabled={!online}
                  disabledReason={OFFLINE}
                  onPress={() => invite(user)}
                />
              )
            }
          />
        ))}
      </>
    ),
    link: (
      <>
        <Text style={styles.hint}>{copy.linkHint}</Text>
        <Button
          label={copy.linkCopy}
          icon="copy"
          variant="outlineAccent"
          loading={making === "copy"}
          disabled={!online || making !== null}
          disabledReason={OFFLINE}
          onPress={() => void makeLink("copy")}
        />
        <Button
          label={copy.linkShare}
          icon="link"
          variant="outlineAccent"
          loading={making === "share"}
          disabled={!online || making !== null}
          disabledReason={OFFLINE}
          onPress={() => void makeLink("share")}
        />
        {copied ? <Text style={styles.hint}>{copy.linkCopied}</Text> : null}
        {links.length > 0 ? (
          <SectionHeader title={copy.linksLive} count={links.length} />
        ) : null}
        {links.map((link) => (
          <Row
            key={link.id}
            icon="date"
            title={`Works until ${formatDateKey(link.expiresAt)}`}
            subtitle={`Made by ${link.createdBy.username}`}
            right={
              <Button
                label={copy.linkRevoke}
                compact
                variant="ghost"
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
