// The username search Friends' Add and a plan's Invite people both run: the
// field, its spinner, "keep typing", "no one by that name", each result with
// the caller's own action, and the line a cut-short list ends with
// (shared/DESIGN.md §9). Only the row's action and the failure words differ.
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import {
  friendSearchHint,
  messageFromError,
  FRIENDS,
  USER_SEARCH_MIN_CHARS,
} from "@logjam/shared";

import { searchUsers, type UserSearchResult } from "../api/friends";
import { makeStyles, muted, spacing, useTheme } from "../theme";
import { Row, TextField } from "../ui";

const copy = FRIENDS.copy;

export function UserSearch({
  label,
  failed,
  offline,
  onChange,
  right,
}: {
  label: string;
  /** The field's error when a search fails. */
  failed: string;
  /** Searching needs a connection: said under the field instead. */
  offline?: string;
  /** The query changed: a row's failure no longer applies. */
  onChange?: () => void;
  right: (user: UserSearchResult) => ReactNode;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = query.trim();
  const long = trimmed.length >= USER_SEARCH_MIN_CHARS;
  const changeQuery = (next: string) => {
    setQuery(next);
    setError(null);
    onChange?.();
    const searchable = next.trim().length >= USER_SEARCH_MIN_CHARS;
    // A cancelled search never clears its own spinner: this does.
    setSearching(searchable && !offline);
    if (!searchable) {
      setResults([]);
      setTotal(null);
    }
  };

  useEffect(() => {
    if (!long || offline) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchUsers(trimmed)
        .then(({ data, total: all }) => {
          if (cancelled) return;
          setResults(data);
          setTotal(all);
        })
        .catch((err: unknown) => {
          console.error(err);
          if (!cancelled) setError(messageFromError(err, failed));
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, long, offline, failed]);

  const cutShort = friendSearchHint(results.length, total);
  return (
    <View style={styles.body}>
      <TextField
        label={label}
        value={query}
        onChangeText={changeQuery}
        autoCapitalize="none"
        error={error}
        hint={offline}
      />
      {searching ? (
        <ActivityIndicator color={theme.accent} style={styles.spinner} />
      ) : null}
      {trimmed.length > 0 && !long ? (
        <Text style={styles.hint}>{copy.searchHint}</Text>
      ) : null}
      {long && !searching && !error && !offline && results.length === 0 ? (
        <Text style={styles.hint}>{copy.searchEmpty}</Text>
      ) : null}
      {results.map((user) => (
        <Row
          key={user.id}
          icon="account"
          title={user.username}
          right={right(user)}
        />
      ))}
      {cutShort ? <Text style={styles.hint}>{cutShort}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  body: { gap: spacing(1) },
  spinner: { alignSelf: "flex-start" },
  hint: { ...muted(theme, textRole.detail) },
}));
