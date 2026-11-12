# The Postgres that prod runs, and local dev too (docker-compose.yml), so a
# config mistake shows up on a laptop first. Pinned to an 18 minor, on
# the Debian release stock `postgres:18` uses, so a dev volume made by the stock
# image has the same glibc (a different one changes the collation version).
# No arch-specific steps: it builds for linux/amd64 and linux/arm64 as is.
# A new major needs more than this line: docs/operations/brain.md ("Upgrading
# Postgres to a new major"). Guard: infra/scripts/rollback-compat-mirrors-ci.py.
FROM postgres:18.6-trixie

# The data stays where every mount in this repository puts it. 18's own default,
# /var/lib/postgresql/18/docker under a VOLUME at /var/lib/postgresql, is made for
# `pg_upgrade --link` inside one mount; major-upgrade.sh copies between two
# directories of the host's data volume instead, so nothing here moves. Because
# PGDATA is set, the official entrypoint skips its refusal to start when it finds
# a database at the old path. brain-entrypoint.sh reads the same variable.
ENV PGDATA=/var/lib/postgresql/data

# The base image already configures the PGDG apt repository.
# postgresql-16 and its pgaudit are here only so major-upgrade.sh has the 16
# binaries to read a 16 data directory with; they go once prod is on 18.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl jq openssl pgbackrest postgresql-18-pgaudit postgresql-16 postgresql-16-pgaudit \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /etc/pgbackrest /etc/postgresql \
 && chown postgres:postgres /etc/pgbackrest

# The host's Docker Compose plugin (no AL2023 package): user data copies it out
# of this image, so a replacement instance boots with only AWS reachable.
# Not used inside the container.
COPY --from=docker/compose-bin:v2.40.3@sha256:e39da8206cc48c6e2c99ce371935eef9d7eff7db600a993fd357de8b75621edf /docker-compose /usr/local/lib/brain/docker-compose

COPY postgresql.conf pg_hba.prod.conf pg_hba.dev.conf pg_ident.conf /etc/postgresql/
COPY brain-lib.sh pgbackrest-conf.sh /usr/local/lib/brain/
COPY brain-entrypoint.sh /usr/local/bin/
COPY initdb/ /docker-entrypoint-initdb.d/
COPY task-lib.sh drill.sh major-upgrade.sh /usr/local/lib/brain/

ENTRYPOINT ["brain-entrypoint.sh"]
CMD ["postgres"]
