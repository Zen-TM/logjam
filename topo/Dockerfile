# ============================================================
# Dockerfile – pipeline
# Base: Ubuntu 24.04 LTS
# ============================================================
FROM ubuntu:24.04

LABEL maintainer="pipeline"
LABEL description="ELVIS LiDAR → Topo MBTiles for Gaia GPS"

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# ------------------------------------------------------------
# 1. Bootstrap: add UbuntuGIS PPA
#    PDAL is NOT in Ubuntu 24.04's default apt repos.
#    UbuntuGIS also provides a more up-to-date GDAL build.
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
#     Used by the worker to produce vector tiles for contours
#     and OSM features before merging into master PMTiles.
# ------------------------------------------------------------
RUN mkdir -p /tmp/tippecanoe \
    && curl -fsSL https://github.com/felt/tippecanoe/archive/refs/heads/main.tar.gz | tar -xz -C /tmp/tippecanoe --strip-components=1 \
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

# ------------------------------------------------------------
# 4. Application
# ------------------------------------------------------------
WORKDIR /app
COPY worker.py /app/worker.py
COPY pipeline.py /app/pipeline.py
COPY export_worker.py /app/export_worker.py
COPY email_send.py /app/email_send.py
COPY renderers/ /app/renderers/
COPY icons/ /app/icons/

# ------------------------------------------------------------
# 5. Entrypoint
# ------------------------------------------------------------
# Single image, two ECS task definitions:
#   - logjam-topo-worker         → command override ["python3", "/app/worker.py"]
#   - logjam-topo-export-worker  → command override ["python3", "/app/export_worker.py"]
# Required env (topo job):     JOB_ID, S3_BUCKET_TOPO, DB_HOST, DB_NAME, DB_USER, DB_PASSWORD
# Required env (export job):   EXPORT_JOB_ID, S3_BUCKET_TOPO, DB_HOST, DB_NAME, DB_USER, DB_PASSWORD
# (DB_PORT optional, default 5432; DB_USER/DB_PASSWORD are ECS-secrets-injected
#  from the RDS-managed Secrets Manager secret)
# Optional: RESEND_API_KEY, EMAIL_FROM, FRONTEND_URL, AWS_REGION (email is a
#  no-op if RESEND_API_KEY/EMAIL_FROM unset — see email_send.py)
#
# Stage 2 plan called for headless MapLibre Native here. The current export
# worker reuses pipeline' Python tile compositor instead, which avoids
# the Mesa + node20 + libmaplibre-gl-native stack entirely. If we move to
# MapLibre Native later, add the GL deps before this line and keep the same
# entrypoint contract — export_worker.py orchestration stays unchanged.
ENTRYPOINT ["python3", "/app/worker.py"]
