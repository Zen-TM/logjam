# The Postgres that prod runs, and local dev too (docker-compose.yml), so a
# config mistake shows up on a laptop first. Pinned to a 16 minor, on
# the Debian release stock `postgres:16` uses, so a dev volume made by the stock
# image has the same glibc (a different one changes the collation version).
# No arch-specific steps: it builds for linux/amd64 and linux/arm64 as is.
FROM postgres:18.6-trixie

# The base image already configures the PGDG apt repository.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl jq openssl pgbackrest postgresql-16-pgaudit \
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
COPY task-lib.sh drill.sh /usr/local/lib/brain/

ENTRYPOINT ["brain-entrypoint.sh"]
CMD ["postgres"]
