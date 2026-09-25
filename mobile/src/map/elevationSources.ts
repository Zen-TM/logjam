// Which off-device elevation sources a lookup may use.
//
// Its own module, free of React Native imports, so it can be unit-tested:
// `useElevationProfile` pulls in apiFetch and the account context, which drag
// in the whole RN runtime.
//
// The tiles saved on the device are always read and are deliberately NOT in
// here — this decides only what may leave the phone.
/**
 * Which off-device sources this lookup may use.
 *
 * Pure so the rule has a test: the combination that matters is a guest in
 * offline-only mode, where getting it wrong either leaks a request the user
 * asked us not to make or silently drops the only source they have.
 */
export function planElevationSources({
  allowNetwork,
  isGuest,
}: {
  allowNetwork: boolean;
  isGuest: boolean;
}): { api: boolean; tiles: boolean } {
  if (!allowNetwork) return { api: false, tiles: false };
  // A guest cannot authenticate the API call, so the public tiles are their
  // only network source.
  return { api: !isGuest, tiles: true };
}

