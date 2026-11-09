# The Postgres that prod runs, and local dev too (docker-compose.yml), so a
# config mistake shows up on a laptop first. Pinned to the minor RDS runs; no
# arch-specific steps, it builds for linux/amd64 and linux/arm64 as is.
FROM postgres:16.13-bookworm

# The base image already configures the PGDG apt repository.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl pgbackrest postgresql-16-pgaudit \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /etc/pgbackrest /etc/postgresql

COPY postgresql.conf pg_hba.prod.conf pg_hba.dev.conf /etc/postgresql/
COPY brain-lib.sh pgbackrest-conf.sh /usr/local/lib/brain/
COPY brain-entrypoint.sh /usr/local/bin/
COPY initdb/ /docker-entrypoint-initdb.d/

ENTRYPOINT ["brain-entrypoint.sh"]
CMD ["postgres"]
