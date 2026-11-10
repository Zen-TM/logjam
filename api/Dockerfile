FROM node:26-slim AS builder

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

FROM node:26-slim AS production

RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    openssl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

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

# The brain's Postgres certificate, the only one the image carries. node-postgres
# (Prisma 7 driver adapter) does not negotiate TLS by default;
# lib/dbConnection.ts verifies against this file by default and refuses to
# start in production without it, and DATABASE_SSL_CA (infra/brain/api.env)
# points here too. The connection is verified by name. The build fails when the
# file is missing, so an image that cannot reach the brain is never published.
COPY infra/brain/brain-ca.pem /app/brain-ca.pem

EXPOSE 8080

# The commit this image was built from, reported by GET /meta. Baked into the
# image, not set as a host-level variable, so rolling the brain back to an
# older release reports the older sha, which the rollback smoke test checks.
# Last, so a new sha rebuilds no earlier layer. The deploy workflow passes it;
# a local build without it bakes in "" and /meta reports null.
ARG GIT_SHA=""
ENV GIT_SHA=$GIT_SHA

CMD ["node", "dist/boot.js"]
