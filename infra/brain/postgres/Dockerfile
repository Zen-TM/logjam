# The Postgres that prod runs, and local dev too (docker-compose.yml), so a
# config mistake shows up on a laptop first. Pinned to a minor at or above RDS's 16.13 (prod's data arrives by dump and
# restore, so any 16.x at or above it is fine), on
# the Debian release stock `postgres:16` uses, so a dev volume made by the stock
# image has the same glibc (a different one changes the collation version).
# No arch-specific steps: it builds for linux/amd64 and linux/arm64 as is.
FROM postgres:16.15-trixie

# The base image already configures the PGDG apt repository.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates openssl pgbackrest postgresql-16-pgaudit \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /etc/pgbackrest /etc/postgresql \
 && chown postgres:postgres /etc/pgbackrest

COPY postgresql.conf pg_hba.prod.conf pg_hba.dev.conf pg_ident.conf /etc/postgresql/
COPY brain-lib.sh pgbackrest-conf.sh /usr/local/lib/brain/
COPY brain-entrypoint.sh /usr/local/bin/
COPY initdb/ /docker-entrypoint-initdb.d/

ENTRYPOINT ["brain-entrypoint.sh"]
CMD ["postgres"]
