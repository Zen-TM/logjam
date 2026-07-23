FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    python3 \
    pkg-config \
    openssl \
  && rm -rf /var/lib/apt/lists/*

# Build shared package first (API depends on it via file: reference)
COPY shared/package*.json /shared/
COPY shared/tsconfig.json /shared/
COPY shared/src /shared/src/
RUN cd /shared && npm ci && npm run build

WORKDIR /app

COPY api/package*.json ./
COPY api/prisma.config.ts ./
COPY api/prisma ./prisma/

RUN npm ci
RUN npx prisma generate

COPY api/tsconfig.json ./
COPY api/src ./src/

RUN npm run build

FROM node:20-slim AS production

RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    openssl \
    ca-certificates \
    curl \
  && rm -rf /var/lib/apt/lists/*

# go-pmtiles for the Stage 4a region-clip endpoint (POST /basemap/region-clip
# runs `pmtiles extract` against PROTOMAPS_ARCHIVE_URI). Pinned release +
# sha256 (no upstream checksums file — hash recorded from the fetched
# artifact at pin time).
RUN curl -fsSL -o /tmp/go-pmtiles.tar.gz \
      https://github.com/protomaps/go-pmtiles/releases/download/v1.31.2/go-pmtiles_1.31.2_Linux_x86_64.tar.gz \
  && echo "3ed7dbf4ec2e6dfe5e25b6f70d1ffc932729f93c86db353bf514dd71010a312f  /tmp/go-pmtiles.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/go-pmtiles.tar.gz -C /usr/local/bin pmtiles \
  && rm /tmp/go-pmtiles.tar.gz \
  && pmtiles version

# Shared package (production deps only)
COPY shared/package*.json /shared/
RUN cd /shared && npm ci --only=production
COPY --from=builder /shared/dist /shared/dist/

WORKDIR /app

COPY api/package*.json ./
COPY api/prisma.config.ts ./
COPY api/prisma ./prisma/

RUN npm ci --only=production
RUN npx prisma generate

COPY --from=builder /app/dist ./dist

# Static assets read at runtime (e.g. topo point-feature icons for GeoPDF).
COPY api/assets ./assets/

# RDS CA bundle for verified TLS to Postgres. node-postgres (Prisma 7 driver
# adapter) does not negotiate TLS by default; services/prisma.ts enables
# verified TLS whenever this file exists. Covers all AWS regions.
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/rds-ca.pem

EXPOSE 8080

CMD ["node", "dist/boot.js"]
