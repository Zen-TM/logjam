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

# Static assets read at runtime (e.g. topo point-feature icons for GeoPDF).
COPY api/assets ./assets/

# RDS CA bundle for verified TLS to Postgres. node-postgres (Prisma 7 driver
# adapter) does not negotiate TLS by default; services/prisma.ts enables
# verified TLS whenever this file exists. Covers all AWS regions.
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/rds-ca.pem

EXPOSE 8080

CMD ["node", "dist/boot.js"]
