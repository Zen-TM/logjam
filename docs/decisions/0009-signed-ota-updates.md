# 0009. OTA updates are code-signed, with the private key outside the repo

- **Date:** 2026-08-16
- **Status:** Accepted
- **Supersedes:** —

## Context

OTA: `expo-updates` is wired (`runtimeVersion` = `appVersion` policy, channel
per profile). JS-only fixes ship with `eas update --branch preview`; anything
native (a new Expo module, a plugin change) needs a fresh build, because the
runtime version moves with `app.json` `version`. Without signing, every launch
would run whatever JS the Expo account served — the app's largest remote-code
path, inside the app lock and on top of the place mirror.

## Decision

**OTA updates are code-signed, and the private key is not in this repo.**
`certs/certificate.pem` IS committed — it ships inside every build and is what
the client checks against. `keys/` is gitignored and holds the RSA private key;
it must also live in an EAS secret (`EXPO_UPDATES_PRIVATE_KEY`) so
`eas update --private-key-path` can sign.

**Publish updates with `npm run update:preview` / `update:production`, not bare
`eas update`.** `--private-key-path` defaults to `private-key.pem` *in the
certificate's directory* — i.e. `certs/`, which is committed. The key lives in
the fully-gitignored `keys/` instead, so the path has to be passed every time;
the scripts do it.

## Consequences

- **Positive:** a client runs only JS signed by the key holder.
- **Negative:** the certificate is embedded at BUILD time, so rotating it needs
  a new build and reinstall, not an update; and **losing the private key means
  no OTA at all until a fresh build ships a new certificate.** Back it up where
  you back up the keystore.
- **Neutral:** Not recorded.

## Alternatives considered

- Keeping the key in `certs/` behind a file-level gitignore exception: rejected
  — a file-level exception inside a committed directory is one typo away from
  publishing a signing key in a public repo.
