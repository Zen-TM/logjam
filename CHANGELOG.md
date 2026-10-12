# Changelog

Releases of **Logjam GPS**, the Android app in `mobile/`. Logjam Web and the
API deploy on every merge to `main` and are not versioned here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/). Each release
is a `mobile-vX.Y.Z` tag whose version matches `mobile/package.json`; the
release workflow refuses a tag without its section here. How a release is
cut: [docs/operations/mobile-release.md](docs/operations/mobile-release.md).

## [Unreleased]

### Added

- Friends: share an invite link from Add a friend, so someone can become a
  friend without being searched for by username.

## [0.1.0]

The first release. Before it, Logjam GPS was installed only as test builds.

### Added

- Places of any place type, with their attributes, notes, photos and links,
  kept on the phone and synced with Logjam Web.
- Trips and a recorded GPS track, with a choice of fix rate.
- Maps: topo and vector basemaps, topo overlays, offline regions downloaded
  for use without signal, GeoPDF, GPX, KML and GeoJSON import.
- A compass with a declination-corrected heading, and a warning when the
  compass is unreliable.
- Sharing a place with a friend, sending a copy, and an inbox for what others
  send you.
- Guest mode: use the app without an account, with everything kept on the
  phone.
- An optional app lock, and a wipe of everything on the phone at sign-out.
