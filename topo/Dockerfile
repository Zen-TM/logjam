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
FROM ubuntu:24.04@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852

LABEL maintainer="pipeline"
LABEL description="ELVIS LiDAR → Topo MBTiles for Gaia GPS"

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# ------------------------------------------------------------
# 1. Bootstrap: add UbuntuGIS PPA
#    PDAL is NOT in Ubuntu 24.04's default apt repos.
#    UbuntuGIS also provides a more up-to-date GDAL build.
#    ubuntugis-*unstable* is not a preference: ubuntugis-stable publishes no
#    `noble` suite at all (its dists/noble 404s, while unstable's carries pdal).
#    The base image cannot move to a newer Ubuntu until the PPA publishes that
#    release's suite: on 26.04 (`resolute`) `apt-get update` fails with a 404 for
#    the PPA's Release file (2026-09-30).
#    Residual reproducibility risk accepted: apt has no digest pin, so a PPA
#    package bump still changes a rebuild even with the pins below. Snapshot the
#    PPA or vendor .debs if a bad upstream build ever needs bisecting.
# ------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
        software-properties-common \
        gpg-agent \
        ca-certificates \
    && add-apt-repository -y ppa:ubuntugis/ubuntugis-unstable \
    && apt-get update \
    && rm -rf /var/lib/apt/lists/*

# ------------------------------------------------------------
# 2. System packages (GDAL + PDAL now available via UbuntuGIS)
# ------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Python
    python3 \
    python3-pip \
    python3-dev \
    python3-venv \
    # GDAL (CLI tools + dev headers + pre-built Python bindings)
    gdal-bin \
    libgdal-dev \
    python3-gdal \
    # PDAL
    pdal \
    libpdal-dev \
    # Fonts for tile labels
    fonts-dejavu-core \
    fonts-dejavu-extra \
    # Utilities
    curl \
    wget \
    unzip \
    # Build tools (needed for tippecanoe)
    build-essential \
    libsqlite3-dev \
    zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

# ------------------------------------------------------------
# 2b. tippecanoe – GeoJSON → vector MBTiles (MVT format)
#     Used by the export worker's MBTiles renderer for an old
#     job's contours and features (renderers/mbtiles.py).
# ------------------------------------------------------------
#     Pinned to a released tag — `main` HEAD would silently change the
#     vector-tile renderer on every rebuild, with nothing to bisect.
ARG TIPPECANOE_VERSION=2.79.0
RUN mkdir -p /tmp/tippecanoe \
    && curl -fsSL https://github.com/felt/tippecanoe/archive/refs/tags/${TIPPECANOE_VERSION}.tar.gz | tar -xz -C /tmp/tippecanoe --strip-components=1 \
    && cd /tmp/tippecanoe \
    && make -j$(nproc) \
    && make install \
    && rm -rf /tmp/tippecanoe

# ------------------------------------------------------------
# 3. Python environment
# ------------------------------------------------------------
# --system-site-packages lets the venv see python3-gdal installed
# by apt above. This avoids compiling GDAL from source (which
# would need g++, SWIG, etc.) — the apt bindings are already
# compiled and version-matched to the system GDAL.
RUN python3 -m venv --system-site-packages /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install pure-Python dependencies only.
# Do NOT pip install GDAL — we use the system package via the venv above.
COPY requirements.txt /tmp/requirements.txt
RUN pip install --upgrade pip && \
    pip install -r /tmp/requirements.txt

# Fail the build, not a job, if the venv's NumPy cannot load the apt GDAL
# bindings (a NumPy 2 in the venv does exactly that).
RUN python -c "from osgeo import gdal_array"

# ------------------------------------------------------------
# 4. Application
# ------------------------------------------------------------
WORKDIR /app
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
COPY gauges.json /app/gauges.json
COPY renderers/ /app/renderers/
COPY icons/ /app/icons/

# ------------------------------------------------------------
# 5. Entrypoint
# ------------------------------------------------------------
# Single image, four ECS task definitions:
#   - logjam-topo-worker         → the default command below, python3 /app/worker.py
#   - logjam-topo-export-worker  → entryPoint ["python3", "/app/export_worker.py"]
#   - logjam-gauges              → ["python3", "/app/build_gauges.py", "run"], every 2 hours on a schedule; needs S3_BUCKET_TOPO, AWS_REGION and WATERNSW_API_KEY
#   - logjam-place-registry      → ["python3", "/app/build_place_registry.py", "publish"], monthly on a schedule; needs only S3_BUCKET_TOPO and AWS_REGION
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
#  from the RDS-managed Secrets Manager secret)
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
