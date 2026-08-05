// Whether this install has an account, made available to every screen.
//
// Context rather than props: the gated surfaces (More, Account, Settings,
// Saved, Map, canyon detail) sit at the bottom of five nested navigators, and
// threading one enum through every `Stack.Screen` render callback would be more
// code in more files than a provider, for a value that never changes during a
// screen's life. `linkAccount` rides along because the same screens that
// disable a feature are the ones offering the way out of it.
//
// Deliberately NOT read straight from `guestModePreference`: that read is
// synchronous and would work, but it wouldn't re-render when a guest links an
// account mid-session, leaving every gated row disabled until a restart.
import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { AccountState } from "./capabilities";

type AccountContextValue = {
  accountState: AccountState;
  /** Leave guest mode: routes into the existing sign-in / sign-up flow. */
  linkAccount: () => void;
};

const AccountStateContext = createContext<AccountContextValue | null>(null);

export function AccountStateProvider({
  accountState,
  linkAccount,
  children,
}: AccountContextValue & { children: ReactNode }) {
  const value = useMemo(
    () => ({ accountState, linkAccount }),
    [accountState, linkAccount],
  );
  return (
    <AccountStateContext.Provider value={value}>
      {children}
    </AccountStateContext.Provider>
  );
}

/**
 * Throws outside the provider rather than defaulting to "linked": a screen
 * that silently assumed an account would show a guest live buttons for
 * features they don't have, which is the exact failure this whole feature
 * exists to avoid. Fail loudly.
 */
export function useAccountState(): AccountContextValue {
  const value = useContext(AccountStateContext);
  if (!value) {
    throw new Error("useAccountState must be used inside AccountStateProvider");
  }
  return value;
}

/** Convenience for the many call sites that only need the boolean. */
export function useIsGuest(): boolean {
  return useAccountState().accountState === "guest";
}
