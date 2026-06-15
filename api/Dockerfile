FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    autoconf \
    automake \
    libtool \
    libcurl4-openssl-dev \
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

# AWS Lambda Runtime Interface Client. The GeoPDF render runs as a
# container-image Lambda reusing THIS image (entry_point overridden to run the
# RIC directly, command = dist/worker/geoPdfLambda.handler — see
# infra/terraform/envs/prod/lambda.tf). aws-lambda-ric is a native addon (its
# preinstall builds libcurl via autotools + cmake — hence those in the builder
# apt set), so it's built here in the builder stage and copied into the
# production stage below; same node:20-slim base, so the binary is
# ABI-compatible. EB and ECS ignore it. The Lambda invokes the RIC by its real
# entry path (node node_modules/aws-lambda-ric/bin/index.mjs) — NOT the
# node_modules/.bin shim, whose relative ESM imports resolve from the wrong base
# (verified: the shim breaks with ERR_MODULE_NOT_FOUND, the direct path works).
RUN npm install --no-save aws-lambda-ric \
  && mkdir -p /tmp/ric \
  && cp -r node_modules/aws-lambda-ric /tmp/ric/aws-lambda-ric

FROM node:20-slim AS production

RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    libcurl4 \
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

# Lambda Runtime Interface Client (built in the builder stage). Placed AFTER
# `npm ci --only=production` so it isn't pruned. Invoked by its real entry path
# in lambda.tf (node node_modules/aws-lambda-ric/bin/index.mjs); no .bin shim.
COPY --from=builder /tmp/ric/aws-lambda-ric ./node_modules/aws-lambda-ric

# Static assets read at runtime (e.g. topo point-feature icons for GeoPDF).
COPY api/assets ./assets/

# RDS CA bundle for verified TLS to Postgres. node-postgres (Prisma 7 driver
# adapter) does not negotiate TLS by default; services/prisma.ts enables
# verified TLS whenever this file exists. Covers all AWS regions.
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/rds-ca.pem

EXPOSE 8080

CMD ["node", "dist/boot.js"]
