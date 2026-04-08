# ============================================================
# Dockerfile – topo_mbtiles
# Base: Ubuntu 24.04 LTS
# ============================================================
FROM ubuntu:24.04

LABEL maintainer="topo_mbtiles"
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
    git \
    build-essential \
    libsqlite3-dev \
    zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

# ------------------------------------------------------------
# 2b. tippecanoe – GeoJSON → vector MBTiles (MVT format)
#     Used by the worker to produce vector tiles for contours
#     and OSM features before merging into master PMTiles.
# ------------------------------------------------------------
RUN git clone --depth 1 https://github.com/felt/tippecanoe.git /tmp/tippecanoe \
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
COPY topo_mbtiles.py /app/topo_mbtiles.py

# ------------------------------------------------------------
# 5. Entrypoint
# ------------------------------------------------------------
# Job ID and AWS config come from environment variables (set by ECS RunTask).
# Required: JOB_ID, S3_BUCKET_TOPO, DATABASE_URL
# Optional: SQS_QUEUE_URL, SES_FROM_EMAIL, AWS_REGION
ENTRYPOINT ["python3", "/app/worker.py"]
