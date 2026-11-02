import { useEffect, useState } from "react";
import { USER_SEARCH_MIN_CHARS } from "@logjam/shared";
import { useToast } from "./components/feedback/ToastProvider";
import { messageFromError } from "./errors/messageFromError";
import { searchUsers, type TSearchUser } from "./placeUtils";

/** A username search as the user types: once the query is long enough for
 *  the API, 300 ms after the last key. Too short a query (or `enabled`
 *  false) shows no results; a response that lands after a newer query's is
 *  dropped (type "abel" then "abelin", and "abel"'s answer arrives last). */
export function useUserSearch(
  query: string,
  enabled: boolean,
  failure: string,
) {
  const toast = useToast();
  const [results, setResults] = useState<TSearchUser[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const typed = query.trim();
  const searches = enabled && typed.length >= USER_SEARCH_MIN_CHARS;
  if (!searches && results.length > 0) setResults([]);

  useEffect(() => {
    if (!searches) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchUsers(typed)
        .then(({ data, total: all }) => {
          if (cancelled) return;
          setResults(data);
          setTotal(all);
        })
        .catch((err) => {
          if (cancelled) return;
          console.error(err);
          toast.error(messageFromError(err, failure));
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searches, typed, toast, failure]);

  return { typed, short: typed.length < USER_SEARCH_MIN_CHARS, results, total };
}
