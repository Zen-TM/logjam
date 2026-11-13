# ============================================================
# Dockerfile – pipeline
# Base: Ubuntu 24.04 LTS
# ============================================================
# Pinned by digest so a rebuild is reproducible: the `24.04` tag moves on every
# point release, so an unpinned rebuild picks up whatever upstream published
# that hour — silently, with nothing in the diff to bisect.
#
# Trade-off, deliberate: base-image security updates NO LONGER ARRIVE
# AUTOMATICALLY. This digest is now a dependency like any other and must be
# refreshed on purpose, ideally as its own commit:
#     docker buildx imagetools inspect ubuntu:24.04
# Digest below verified against the live registry as `ubuntu:24.04` 2026-08-29.
FROM ubuntu:24.04@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852 AS base

LABEL maintainer="pipeline"
LABEL description="ELVIS LiDAR → Topo MBTiles for Gaia GPS"

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# ------------------------------------------------------------
# Stages. Only the last one is the image: a Fargate task pulls and unpacks every
# byte of it before the worker's first log line, so what is only needed to
# build, or to add the PPA, is done in an earlier stage and left there.
#   base        the pinned Ubuntu above
#   ppa         base + the UbuntuGIS PPA's apt source
#   tippecanoe  the compiler, and tippecanoe built with it
#   (last)      base + runtime packages + the PPA's source + tippecanoe's binary
# ------------------------------------------------------------

# ------------------------------------------------------------
# 1. ppa: add the UbuntuGIS PPA
#    PDAL is NOT in Ubuntu 24.04's default apt repos.
#    UbuntuGIS also provides a more up-to-date GDAL build.
#    ubuntugis-*unstable* is not a preference: ubuntugis-stable publishes no
#    `noble` suite at all (its dists/noble 404s, while unstable's carries pdal).
#    The base image cannot move to a newer Ubuntu until the PPA publishes that
#    release's suite: on 26.04 (`resolute`) `apt-get update` fails with a 404 for
#    the PPA's Release file (2026-09-30).
#    add-apt-repository fetches the PPA's signing key from Launchpad's API, which
#    answers 500/503 when Launchpad is down, so that one step retries with a backoff.
#    add-apt-repository and its Python stack (software-properties-common,
#    gpg-agent) stay in this stage: the last stage copies only the source and key
#    files it wrote.
#    Residual reproducibility risk accepted: apt has no digest pin, so a PPA
#    package bump still changes a rebuild even with the pins below. Snapshot the
#    PPA or vendor .debs if a bad upstream build ever needs bisecting.
# ------------------------------------------------------------
FROM base AS ppa
RUN apt-get update && apt-get install -y --no-install-recommends \
        software-properties-common \
        gpg-agent \
        ca-certificates \
    && for i in 1 2 3 4; do add-apt-repository -y ppa:ubuntugis/ubuntugis-unstable && break; [ "$i" -lt 4 ] || exit 1; sleep $((i * 15)); done \
    && rm -rf /var/lib/apt/lists/*

# ------------------------------------------------------------
# 2. tippecanoe – GeoJSON → vector MBTiles (MVT format)
#    Used by the export worker's MBTiles renderer for an old
#    job's contours and features (renderers/mbtiles.py), and by the
#    statewide archive builds (build_coverage.py, build_fire_history.py,
#    build_land_tenure.py).
# ------------------------------------------------------------
#     Pinned to a released tag — `main` HEAD would silently change the
#     vector-tile renderer on every rebuild, with nothing to bisect.
#     The last stage copies the one binary the code runs and links it against
#     libstdc++, libsqlite3 and zlib, which GDAL's own dependencies bring.
FROM base AS tippecanoe
ARG TIPPECANOE_VERSION=2.79.0
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        curl \
        libsqlite3-dev \
        zlib1g-dev \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /tmp/tippecanoe \
    && curl -fsSL https://github.com/felt/tippecanoe/archive/refs/tags/${TIPPECANOE_VERSION}.tar.gz | tar -xz -C /tmp/tippecanoe --strip-components=1 \
    && cd /tmp/tippecanoe \
    && make -j$(nproc) \
    && make install

# ------------------------------------------------------------
# 3. The image: runtime packages only (GDAL + PDAL, via UbuntuGIS)
#    No compiler, no -dev header package, no apt-installed pip: the Python
#    dependencies below are all wheels. Every apt step ends by deleting the
#    package lists, so no layer keeps them.
# ------------------------------------------------------------
FROM base
# apt reaches the PPA over https, so the CA bundle goes in before its source does.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ppa /etc/apt/sources.list.d/ /etc/apt/sources.list.d/
COPY --from=ppa /etc/apt/keyrings/ /etc/apt/keyrings/
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Python (python3-venv bundles the pip the venv below installs with)
    python3 \
    python3-venv \
    # GDAL (CLI tools + pre-built Python bindings)
    gdal-bin \
    python3-gdal \
    # PDAL (the `pdal` command line; the code never imports it)
    pdal \
    # Fonts for tile labels (pipeline.py names DejaVuSans and DejaVuSans-Bold)
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

COPY --from=tippecanoe /usr/local/bin/tippecanoe /usr/local/bin/tippecanoe

# --system-site-packages lets the venv see python3-gdal installed
# by apt above. This avoids compiling GDAL from source (which
# would need g++, SWIG, etc.) — the apt bindings are already
# compiled and version-matched to the system GDAL.
RUN python3 -m venv --system-site-packages /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install pure-Python dependencies only.
# Do NOT pip install GDAL — we use the system package via the venv above.
# --only-binary: the image has no compiler, so a dependency that ships no wheel
# fails the build here instead of compiling.
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir --only-binary=:all: -r /tmp/requirements.txt && \
    rm /tmp/requirements.txt

# Fail the build, not a job, if the venv's NumPy cannot load the apt GDAL
# bindings (a NumPy 2 in the venv does exactly that).
RUN python -c "from osgeo import gdal_array"

# Fail the build, not a job, if a binary the workers run is missing or cannot
# load a shared library.
RUN pdal --version && gdalinfo --version && ogr2ogr --version && tippecanoe --version

# ------------------------------------------------------------
# 4. Application
# ------------------------------------------------------------
WORKDIR /app
# The brain's Postgres certificate: the default for DATABASE_SSL_CA
# (worker_common.py), and what ecs.tf points it at. A build cannot reach outside its context, and
# this image's is topo/, so the certificate is committed twice: at
# infra/brain/brain-ca.pem (what Terraform and the API image read) and here.
# CI fails when the two differ (ci.yml, infra-scripts). The build fails without it.
COPY brain-ca.pem /app/brain-ca.pem
COPY worker.py /app/worker.py
COPY pipeline.py /app/pipeline.py
COPY sharpen.py /app/sharpen.py
COPY export_worker.py /app/export_worker.py
COPY area_export.py /app/area_export.py
COPY email_send.py /app/email_send.py
COPY push_send.py /app/push_send.py
COPY worker_common.py /app/worker_common.py
COPY build_nsw_dem.py /app/build_nsw_dem.py
COPY build_land_tenure.py /app/build_land_tenure.py
COPY build_place_registry.py /app/build_place_registry.py
COPY build_gauges.py /app/build_gauges.py
COPY build_fire_history.py /app/build_fire_history.py
COPY build_coverage.py /app/build_coverage.py
COPY gauges.json /app/gauges.json
COPY renderers/ /app/renderers/
COPY icons/ /app/icons/

# ------------------------------------------------------------
# 5. Entrypoint
# ------------------------------------------------------------
# Single image, six ECS task definitions:
#   - logjam-topo-worker         → the default command below, python3 /app/worker.py
#   - logjam-topo-export-worker  → entryPoint ["python3", "/app/export_worker.py"]
#   - logjam-gauges              → ["python3", "/app/build_gauges.py", "run"], every 2 hours on a schedule; needs S3_BUCKET_TOPO, AWS_REGION and WATERNSW_API_KEY
#   - logjam-place-registry      → ["python3", "/app/build_place_registry.py", "publish"], monthly on a schedule; needs only S3_BUCKET_TOPO and AWS_REGION
#   - logjam-fire-history        → ["python3", "/app/build_fire_history.py", "publish"], monthly on a schedule; needs only S3_BUCKET_TOPO and AWS_REGION
#   - logjam-coverage            → ["python3", "/app/build_coverage.py", "publish"], monthly on a schedule; needs only S3_BUCKET_TOPO and AWS_REGION
# The topo worker's is a CMD, not an ENTRYPOINT, so that a RunTask command
# override can run another script from this image under the same task role: the
# slope archive build (topo/README.md, "The statewide slope archive"). A task
# definition that sets an entryPoint drops this CMD, as the others do.
# tests/test_docker_image_files.py `test_the_image_starts_the_worker_as_a_cmd`
# holds it: with an ENTRYPOINT the slope recipe and `docker compose run topo
# python3 /app/pipeline.py ...` would pass their command to worker.py as arguments.
# Required env (topo job):     JOB_ID, S3_BUCKET_TOPO, DB_HOST, DB_NAME, DB_USER, DB_PASSWORD
# Required env (export job):   EXPORT_JOB_ID, S3_BUCKET_TOPO, DB_HOST, DB_NAME, DB_USER, DB_PASSWORD
# (DB_PORT optional, default 5432; DB_USER/DB_PASSWORD are ECS-secrets-injected
#  from the Secrets Manager secret)
# Optional: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, EMAIL_FROM,
#  FRONTEND_URL, AWS_REGION (email is a no-op if any SMTP setting is unset —
#  see email_send.py)
#
# The export worker reuses the Python tile compositor instead of headless
# MapLibre Native, avoiding the Mesa + node20 + libmaplibre-gl-native stack
# entirely. If moving to MapLibre Native later, add the GL deps before this
# line and keep the same entrypoint contract — export_worker.py orchestration
# stays unchanged.
CMD ["python3", "/app/worker.py"]
