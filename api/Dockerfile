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
COPY api/prisma ./prisma/

RUN npm ci

COPY api/tsconfig.json ./
COPY api/src ./src/

RUN npm run build
RUN npx prisma generate

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
COPY api/prisma ./prisma/

RUN npm ci --only=production
RUN npx prisma generate

COPY --from=builder /app/dist ./dist

EXPOSE 8080

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
